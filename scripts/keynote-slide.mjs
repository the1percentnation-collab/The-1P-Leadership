// Closing slide for a keynote: a QR code to the Team Alignment Assessment,
// tagged with the host organization so every result from that room lands in
// the CRM as "Campaign: keynote-<org>".
//
//   cd scripts && npm install
//   node keynote-slide.mjs --org "Acme Corp" [--out ./slides]
//
// Writes keynote-slide-<org>.html (open in Chrome to present or print) and,
// when Playwright can be found, a 1920x1080 PNG to drop into Keynote,
// PowerPoint, Google Slides or Canva. Without --org it makes the generic
// slide (campaign "keynote"). The QR goes straight to the assessment; the
// spoken short link, the1pnation.com/myteam, is a hosting redirect.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode');

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };
const org = (arg('org') || '').trim();
const out = path.resolve(arg('out') || '.');
const slug = org ? org.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
const campaign = slug ? `keynote-${slug}` : 'keynote';
const url = `https://the1pnation.com/assessments/team-alignment?utm_source=keynote&utm_medium=qr&utm_campaign=${campaign}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const logo = 'data:image/jpeg;base64,' + fs.readFileSync(new URL('../public/assets/favicon.jpg', import.meta.url)).toString('base64');
// Medium error correction: enough to survive glare and a soft projector,
// while keeping the modules large enough to scan from the back of a room.
const qr = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#080808', light: '#ffffff' } });

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Keynote slide${org ? ' | ' + esc(org) : ''}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  html,body{background:#080808}
  .slide{width:1920px;height:1080px;position:relative;overflow:hidden;background:radial-gradient(1200px 700px at 78% 45%,rgba(230,3,6,.13),transparent 60%),#080808;color:#fff;font-family:Outfit,system-ui,sans-serif;display:grid;grid-template-columns:1fr 560px;grid-template-rows:1fr auto;column-gap:120px;align-items:center;padding:90px 150px 56px}
  .slide::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:120px 120px;mask-image:linear-gradient(90deg,transparent,#000 30%,#000 70%,transparent)}
  .copy,.qr{position:relative}
  .eyebrow{font-family:'Space Mono',monospace;font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:#ff5a5c}
  h1{font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:140px;line-height:.92;letter-spacing:.005em;margin:24px 0 30px}
  h1 span{color:#E60306}
  p{font-size:36px;line-height:1.4;color:#B4B4B4;max-width:21em}
  .url{margin-top:44px;display:inline-flex;align-items:baseline;gap:18px;font-family:'Space Mono',monospace;font-size:44px;font-weight:700;color:#fff;border-bottom:3px solid #E60306;padding-bottom:10px}
  .url small{font-family:Outfit,sans-serif;font-size:26px;font-weight:500;color:#7A7A7A}
  .qr{background:#fff;border-radius:32px;padding:48px;box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 2px rgba(230,3,6,.5)}
  .qr svg{display:block;width:100%;height:auto}
  .qr-cap{position:absolute;left:0;right:0;bottom:-74px;text-align:center;font-family:'Space Mono',monospace;font-size:24px;letter-spacing:.18em;text-transform:uppercase;color:#A0A0A0}
  .foot{grid-column:1 / -1;padding-top:40px;display:flex;justify-content:space-between;align-items:center;font-size:22px;color:#7A7A7A}
  .brand{display:flex;align-items:center;gap:16px;color:#fff;font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:20px}
  .brand img{width:52px;height:52px;border-radius:8px}
  @media print{@page{size:1920px 1080px;margin:0}}
</style></head>
<body><div class="slide">
  <div class="copy">
    <div class="eyebrow">Free &middot; 5 minutes &middot; Your score and a plan</div>
    <h1>Is your team actually moving <span>together?</span></h1>
    <p>Take the Team Alignment Assessment. Leave with your score and one clear next step you can run on Monday.</p>
    <div class="url">the1pnation.com/myteam <small>or scan</small></div>
  </div>
  <div class="qr">${qr}<div class="qr-cap">Scan to start</div></div>
  <div class="foot">
    <div class="brand"><img src="${logo}" alt="">The One Percent Nation</div>
    <div>${org ? 'Prepared for ' + esc(org) + ' &middot; ' : ''}Redefining Success. Realigning Purpose. Releasing Potential.</div>
  </div>
</div></body></html>`;

fs.mkdirSync(out, { recursive: true });
const base = path.join(out, `keynote-slide${slug ? '-' + slug : ''}`);
fs.writeFileSync(base + '.html', html);
console.log('QR links to', url);
console.log('wrote', base + '.html');

let playwright = null;
try { playwright = require('playwright'); } catch (e) { /* optional */ }
if (!playwright) {
  console.log('Playwright not found, so no PNG. Open the HTML in Chrome, or run with NODE_PATH pointing at a Playwright install.');
} else {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file://' + base + '.html');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: base + '.png' });
  await browser.close();
  console.log('wrote', base + '.png');
}
