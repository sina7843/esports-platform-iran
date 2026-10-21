/**
 * Lab check (manual, local only): drives headless Chrome/Edge through the Chrome DevTools Protocol against a running
 * web dev/preview server (with its API proxy) and an API with dev login. For each route × profile it records
 *   - lab web vitals (FCP, LCP, CLS, total blocking time from long tasks) — LAB data, not field data,
 *   - axe-core WCAG 2.0/2.1/2.2 A+AA violations (axe is loaded from AXE_PATH, outside the repo),
 *   - horizontal overflow, document lang/dir, console errors, keyboard focus reachability.
 * Usage: node scripts/lab-check.mjs <webBase> <devCode> <outFile> [browserExe] [principalId]
 * It cannot replace a manual screen-reader pass or real-device testing; the report says so.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const [webBase = 'http://127.0.0.1:5173', devCode = '', outFile = 'lab-report.json', exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe', principal = 'usr_seed_admin'] = process.argv.slice(2);
const AXE = readFileSync(process.env.AXE_PATH ?? 'node_modules/axe-core/axe.min.js', 'utf8');
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'esp-lab-'));
const chrome = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 50 && !version; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  } catch {
    await sleep(200);
  }
}
if (!version) throw new Error('browser did not start');
const page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const handlers = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(msg.error.message));
    else res(msg.result);
  } else handlers.forEach((h) => h(msg));
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.value;
};
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.bringToFront'); // a background tab defers paint, which corrupts LCP
await send('Emulation.setFocusEmulationEnabled', { enabled: true });

let consoleErrors = [];
let currentPrincipal = principal;
handlers.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(`${m.params.entry.source}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
});
async function go(url) {
  const loaded = new Promise((res) => {
    const h = (m) => { if (m.method === 'Page.loadEventFired') { handlers.splice(handlers.indexOf(h), 1); res(); } };
    handlers.push(h);
  });
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20000)]);
  await sleep(1500);
}

// sign in with the development login (local test environment only)
await go(`${webBase}/`);
const login = await evaluate(`fetch('/api/v1/auth/dev-session',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'fetch'},body:JSON.stringify({principalId:${JSON.stringify(principal)},devCode:${JSON.stringify(devCode)}})}).then(r=>r.status)`);
if (login !== 200) throw new Error(`dev login failed: ${login}`);

const ROUTES = process.env.LAB_ROUTES ? process.env.LAB_ROUTES.split(",") : [
  '/', '/events', '/events/evt_seed_a', '/events/evt_seed_a/live', '/news', '/rankings', '/rules', '/games', '/search', '/login', '/account', '/account/settings', '/account/privacy', '/legal/terms', '/support',
  '/admin/users', '/admin/tasks', '/admin/tickets', '/admin/settings', '/admin/privacy', '/admin/integrations', '/admin/reports', '/admin/ops', '/organizer', '/organizer/events/evt_seed_a/ops',
];
const ALL_PROFILES = [
  { name: 'mobile-slow4g', width: 390, height: 844, mobile: true, dpr: 2, cpu: 4, net: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 } },
  { name: 'desktop', width: 1366, height: 768, mobile: false, dpr: 1, cpu: 1, net: null },
];
const PROFILES = process.env.LAB_PROFILE ? ALL_PROFILES.filter((p) => p.name === process.env.LAB_PROFILE) : ALL_PROFILES;
const VITALS = `new Promise((resolve)=>{
  const out={fcp:null,lcp:null,cls:0,tbt:0};
  const po=(type,fn)=>{try{new PerformanceObserver(l=>l.getEntries().forEach(fn)).observe({type,buffered:true});}catch{}};
  po('paint',e=>{if(e.name==='first-contentful-paint')out.fcp=Math.round(e.startTime)});
  po('largest-contentful-paint',e=>{out.lcp=Math.round(e.startTime)});
  po('layout-shift',e=>{if(!e.hadRecentInput){out.cls+=e.value;if(e.value>0.02)(out.shifts=out.shifts||[]).push({v:Math.round(e.value*1000)/1000,at:Math.round(e.startTime),src:(e.sources||[]).slice(0,2).map(s=>s.node?(s.node.nodeName+'.'+String(s.node.className).slice(0,30)+' '+Math.round(s.previousRect.y)+'->'+Math.round(s.currentRect.y)):'?')})}});
  po('longtask',e=>{out.tbt+=Math.max(0,e.duration-50)});
  setTimeout(()=>{out.cls=Math.round(out.cls*1000)/1000;out.tbt=Math.round(out.tbt);resolve(out)},400);
})`;
const results = [];
for (const p of PROFILES) {
  await send('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.height, deviceScaleFactor: p.dpr, mobile: p.mobile });
  await send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  await send('Network.emulateNetworkConditions', p.net ? { offline: false, latency: p.net.latency, downloadThroughput: p.net.down, uploadThroughput: p.net.up } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  for (const r of ROUTES) {
    consoleErrors = [];
    // each route is opened by a principal that is allowed to see it, so a 403/login redirect cannot pass as a result
    const who = r.startsWith('/organizer') ? 'usr_seed_organizer' : principal;
    if (who !== currentPrincipal) {
      const st = await evaluate(`fetch('/api/v1/auth/dev-session',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'fetch'},body:JSON.stringify({principalId:${JSON.stringify(who)},devCode:${JSON.stringify(devCode)}})}).then(r=>r.status)`);
      if (st !== 200) throw new Error(`login as ${who} failed: ${st}`);
      currentPrincipal = who;
    }
    const samples = [];
    for (let rep = 0; rep < 3; rep++) {
      await go(`${webBase}${r}`);
      samples.push(await evaluate(VITALS));
    }
    const med = (k) => {
      const v = samples.map((x) => x[k]).filter((x) => x !== null).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    };
    const vitals = { shifts: samples.flatMap((x) => x.shifts ?? []).slice(0, 4), fcp: med('fcp'), lcp: med('lcp'), cls: Math.max(...samples.map((x) => x.cls)), tbt: Math.max(...samples.map((x) => x.tbt)), runs: samples.length };
    // wait until the SPA route has settled and the main region shows content (redirects and empty shells are recorded)
    for (let i = 0; i < 40; i++) {
      const ok = await evaluate(`(document.querySelector('main')?.innerText.trim().length ?? 0) > 40`);
      if (ok) break;
      await sleep(250);
    }
    const settled = await evaluate(`({ finalPath: location.pathname, contentChars: (document.querySelector('main')?.innerText.trim().length ?? 0) })`);
    const facts = await evaluate(`({ lang: document.documentElement.lang, dir: document.documentElement.dir, overflow: document.documentElement.scrollWidth > window.innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, title: document.title, hasMain: !!document.querySelector('main, [role=main]'), path: location.pathname })`);
    await evaluate(`${JSON.stringify(AXE)}.length`).catch(() => 0);
    await send('Runtime.evaluate', { expression: AXE });
    const axe = await evaluate(`axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.length,sample:v.nodes[0].target.join(' ').slice(0,120)})))`);
    // keyboard: Tab through the page and make sure every stop has a visible focus indicator and nothing is zero-sized
    const keyboard = await (async () => {
      await evaluate('document.activeElement && document.activeElement.blur(); window.scrollTo(0,0)');
      const stops = [];
      for (let i = 0; i < 25; i++) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        stops.push(await evaluate(`(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const r=e.getBoundingClientRect();const s=getComputedStyle(e);return{tag:e.tagName,label:((e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,30)+' | '+String(e.className).slice(0,40)),w:Math.round(r.width),h:Math.round(r.height),outline:s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0,shadow:s.boxShadow!=='none'}})()`));
      }
      const real = stops.filter(Boolean);
      return { stops: real.length, noIndicator: real.filter((s) => !s.outline && !s.shadow).length, tiny: real.filter((s) => s.w < 24 || s.h < 24).length, offenders: real.filter((s) => (!s.outline && !s.shadow) || s.w < 24 || s.h < 24).map((s) => `${s.tag} ${s.label} ${s.w}x${s.h}`).slice(0, 4) };
    })();
    results.push({ profile: p.name, route: r, ...facts, ...settled, redirected: settled.finalPath !== r.split('?')[0], vitals, axe, keyboard, consoleErrors: consoleErrors.slice(0, 5) });
    process.stdout.write(`${p.name} ${r} axe=${axe.length} overflow=${facts.overflow} lcp=${vitals.lcp} cls=${vitals.cls}\n`);
  }
  if (p.name === 'mobile-slow4g') {
    mkdirSync(dirname(outFile), { recursive: true });
  }
}
const screenshotDir = join(dirname(outFile), 'screens');
mkdirSync(screenshotDir, { recursive: true });
await send('Emulation.setCPUThrottlingRate', { rate: 1 });
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
for (const [name, route, w, h, mobile] of [['home-mobile', '/', 390, 844, true], ['ops-mobile', '/organizer/events/evt_seed_a/ops', 390, 844, true], ['integrations-desktop', '/admin/integrations', 1366, 768, false], ['privacy-mobile', '/account/privacy', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  const who = route.startsWith('/organizer') ? 'usr_seed_organizer' : principal;
  if (who !== currentPrincipal) {
    await evaluate(`fetch('/api/v1/auth/dev-session',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'fetch'},body:JSON.stringify({principalId:${JSON.stringify(who)},devCode:${JSON.stringify(devCode)}})}).then(r=>r.status)`);
    currentPrincipal = who;
  }
  await go(`${webBase}${route}`);
  await sleep(2500); // let data load so the evidence shows the real page
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(screenshotDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
}
const summary = {
  at: new Date().toISOString(),
  browser: version.Browser,
  note: 'LAB data from a local headless browser with throttling emulation; no field (real-user) data exists. Automated axe rules cover only part of WCAG; manual screen-reader and real-device checks are separate.',
  totals: {
    pages: results.length,
    axeViolations: results.reduce((n, r) => n + r.axe.length, 0),
    pagesWithOverflow: results.filter((r) => r.overflow).length,
    pagesRedirected: results.filter((r) => r.redirected).length,
    pagesEmpty: results.filter((r) => r.contentChars <= 40).length,
    pagesNotRtl: results.filter((r) => r.dir !== 'rtl' && r.lang === 'fa').length,
    pagesWithConsoleErrors: results.filter((r) => r.consoleErrors.length).length,
  },
  results,
};
writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.totals));
ws.close();
chrome.kill();
process.exit(0);
