'use strict';
// Throwaway proof of concept: does a live Chromium page survive a Maritime sleep/wake?
// Fake data only. No Teamio code, no secrets.
const http = require('http');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT || 8080);
const BOOT_ID = Math.random().toString(36).slice(2, 10);
const BOOT_AT = Date.now();

// Local page: an input (stands in for an OTP box) plus a counter living in page memory.
const PAGE = `<!doctype html><title>poc</title>
<input id="otp" placeholder="otp">
<div id="n">0</div>
<script>
  window.pageId = Math.random().toString(36).slice(2, 10);
  window.ticks = 0;
  setInterval(() => { window.ticks++; document.getElementById('n').textContent = window.ticks; }, 1000);
</script>`;

let page = null;
let browserReady = null;

async function startBrowser() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/page`);
}

async function snapshot() {
  const inPage = await page.evaluate(() => ({
    pageId: window.pageId,
    ticks: window.ticks,
    otpValue: document.getElementById('otp').value,
  }));
  return { bootId: BOOT_ID, serverUptimeMs: Date.now() - BOOT_AT, wallClock: new Date().toISOString(), ...inPage };
}

async function handleChat(message) {
  await browserReady;
  const text = String(message || '').trim();
  if (text.startsWith('type ')) {
    await page.focus('#otp');
    await page.keyboard.type(text.slice(5));
  }
  return snapshot();
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  if (req.method === 'GET' && req.url === '/page') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    return;
  }
  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const out = await handleChat(parsed.message);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ response: JSON.stringify(out) }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ response: `error: ${e.message}` }));
      }
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`poc listening on ${PORT}, bootId=${BOOT_ID}`);
  browserReady = startBrowser().catch((e) => { console.error('browser failed', e); process.exit(1); });
});
