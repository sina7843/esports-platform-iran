// Quick DOM probe (manual): prints the visible text length and fonts for a route. Same CDP approach as lab-check.mjs.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [webBase, devCode, route, shot] = process.argv.slice(2);
const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(exe, ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'esp-probe-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let v;
for (let i = 0; i < 50 && !v; i++) { try { v = await (await fetch('http://127.0.0.1:9334/json/version')).json(); } catch { await sleep(200); } }
const page = await (await fetch('http://127.0.0.1:9334/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Page.bringToFront');
await send('Page.navigate', { url: `${webBase}/` }); await sleep(2000);
await ev(`fetch('/api/v1/auth/dev-session',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'fetch'},body:JSON.stringify({principalId:'usr_seed_admin',devCode:${JSON.stringify(devCode)}})}).then(r=>r.status)`);
if (process.env.PROBE_MOBILE) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${webBase}${route}` }); await sleep(3500);
if (process.env.PROBE_JS) { const js = process.env.PROBE_JS.endsWith('.js') ? (await import('node:fs')).readFileSync(process.env.PROBE_JS, 'utf8') : process.env.PROBE_JS; const r = await ev(js); if (r) console.log(r); await sleep(1200); }
if (process.env.PROBE_FONTS) { await ev(`document.body.innerHTML='<div dir=rtl style="font-size:28px;padding:16px;background:#fff;color:#000"><p style="font-family:Vazirmatn">Vazirmatn: داشبورد عملیات رویداد ۱۲۳</p><p style="font-family:Tahoma">Tahoma: داشبورد عملیات رویداد ۱۲۳</p><p style="font-family:Segoe UI">Segoe: داشبورد عملیات رویداد ۱۲۳</p><p style="font-family:serif">serif: داشبورد عملیات رویداد ۱۲۳</p></div>'`); await sleep(1500); }
console.log(JSON.stringify(await ev(`(()=>{
  const cs=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const c=getComputedStyle(e);return {t:e.textContent.trim().slice(0,20),ls:c.letterSpacing,ff:c.fontFamily.slice(0,40),fw:c.fontWeight,fs:c.fontSize,fk:c.fontKerning,ffs:c.fontFeatureSettings,fvs:c.fontVariationSettings,tr:c.textRendering,ws:c.wordSpacing}};
  return {nav:cs('nav a'),h1:cs('h1'),brand:cs('.brand span'),html:cs('html')};
})()`)));
console.log(JSON.stringify(await ev(`({ url: location.pathname, mainText: (document.querySelector('main')||document.body).innerText.slice(0,300), bodyFont: getComputedStyle(document.body).fontFamily, lang: document.documentElement.lang, dir: document.documentElement.dir, fonts: [...document.fonts].map(f=>f.family+':'+f.status) })`), null, 1));
if (shot) { const s = await send('Page.captureScreenshot', { format: 'png' }); (await import('node:fs')).writeFileSync(shot, Buffer.from(s.result.data, 'base64')); }
ws.close(); chrome.kill(); process.exit(0);
