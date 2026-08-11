/**
 * Rig de captura y medición sobre Chrome headless por CDP crudo.
 *
 * Sin puppeteer a propósito: el WebSocket nativo de Node basta y así el harness
 * no arrastra una dependencia de 300 MB para tomar capturas.
 *
 * Uso:
 *   node shoot.mjs <sonda> <salida> [rutas] [viewports]
 *   node shoot.mjs probe-a11y.js ./out overview,dashboard desktop,mobile
 *
 * La sonda es un archivo .js del mismo directorio que evalúa a un objeto. Se
 * inyecta con String.raw, así que NO puede contener backticks.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROBE_BASE || 'http://localhost:8822';

const PROBE_FILE = process.argv[2] || 'probe-a11y.js';
const OUT = process.argv[3] || './out';
const ROUTES = (process.argv[4]
  || 'overview,dashboard,mentions,sentiment,topics,narrative,geography,alerts').split(',');
const VPS = (process.argv[5] || 'desktop,mobile').split(',');
const SHOTS = process.env.PROBE_SHOTS !== '0';

const VP = {
  desktop: [1440, 900, 2, false],
  laptop: [1280, 800, 2, false],
  tablet: [768, 1024, 2, true],
  mobile: [390, 844, 3, true],
};

const probeSrc = fs.readFileSync(path.join(HERE, PROBE_FILE), 'utf8').trim();
if (probeSrc.includes('`')) throw new Error(`${PROBE_FILE} contiene un backtick: rompe String.raw`);
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => {
  const s = net.createServer();
  s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); });
});

const port = await freePort();
const prof = path.join(OUT, '.prof');
fs.rmSync(prof, { recursive: true, force: true });
const ch = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
  '--headless=new', '--hide-scrollbars', '--no-first-run',
  '--force-color-profile=srgb', '--font-render-hinting=none', 'about:blank',
], { stdio: 'ignore' });

let wsu = null;
for (let i = 0; i < 120 && !wsu; i++) {
  try {
    const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    wsu = j.webSocketDebuggerUrl;
  } catch { /* Chrome todavía no abrió el puerto */ }
  if (!wsu) await sleep(100);
}
if (!wsu) { ch.kill(); throw new Error('Chrome no expuso CDP'); }

const sock = new WebSocket(wsu);
await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
let id = 0;
const pend = new Map();
const evs = [];
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method) evs.push(m);
};
const send = (me, pa = {}, sid, to = 60000) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  sock.send(JSON.stringify({ id: i, method: me, params: pa, ...(sid ? { sessionId: sid } : {}) }));
  setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + me)); } }, to);
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p, t) => send(m, p, sessionId, t);
await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');

const rep = [];
for (const vn of VPS) {
  const [w, h, dsf, mob] = VP[vn];
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: mob });
  // maxTouchPoints siempre 5: con 0 el comando es rechazado por CDP.
  await S('Emulation.setTouchEmulationEnabled', { enabled: mob, maxTouchPoints: 5 });
  for (const r of ROUTES) {
    evs.length = 0;
    await S('Runtime.evaluate', { expression: 'try{localStorage.clear()}catch(e){}' });
    await S('Page.navigate', { url: BASE + '/' + r });
    await sleep(1400);
    // Esperar a que la pantalla esté ASENTADA, no sólo cargada: sin esto se mide
    // el esqueleto y las cifras salen a cero.
    for (let i = 0; i < 40; i++) {
      const q = await S('Runtime.evaluate', {
        expression: `(()=>{const m=document.querySelector('main');const sk=document.querySelectorAll('.skeleton').length;return JSON.stringify({len:((m&&m.innerText)||'').length,sk,ld:/Cargando/.test((m&&m.innerText)||'')});})()`,
        returnByValue: true,
      });
      const st = JSON.parse(q.result.value || '{}');
      if (st.len > 200 && st.sk === 0 && !st.ld) break;
      await sleep(300);
    }
    await sleep(700);

    let pr = {};
    try {
      const x = await S('Runtime.evaluate', { expression: `JSON.stringify(${probeSrc})`, returnByValue: true });
      pr = JSON.parse(x.result.value);
    } catch (e) { pr = { err: String(e.message) }; }

    const cerr = evs.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
      .map((e) => e.params.entry.text.slice(0, 200));
    const rerr = evs.filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => (e.params.exceptionDetails.exception?.description || '').slice(0, 200));

    if (SHOTS) {
      const met = await S('Page.getLayoutMetrics');
      const raw = Math.ceil(met.cssContentSize.height);
      // Alto y escala acotados: una página muy larga a dsf alto revienta el
      // límite de captura de CDP y se pierde el pantallazo entero.
      const full = Math.min(raw, 9000);
      const sd = full * dsf > 8000 ? Math.max(1, Math.floor((8000 / full) * 10) / 10) : dsf;
      try {
        await S('Emulation.setDeviceMetricsOverride', { width: w, height: full, deviceScaleFactor: sd, mobile: mob });
        await sleep(500);
        const sh = await S('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, `${r}-${vn}.png`), Buffer.from(sh.data, 'base64'));
      } catch { /* una captura perdida no debe abortar el barrido */ }
      try {
        await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: mob });
        await sleep(300);
        const fo = await S('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, `${r}-${vn}-fold.png`), Buffer.from(fo.data, 'base64'));
      } catch { /* idem */ }
    }

    rep.push({ route: r, vp: vn, probe: pr, consoleErrors: cerr, runtimeErrors: rerr });
    fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(rep, null, 1));
    const line = Object.entries(pr)
      .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
      .map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`[${r}-${vn}] ${line} err=${cerr.length + rerr.length}`);
  }
}
console.log(`\n${rep.length} mediciones -> ${OUT}`);
sock.close(); ch.kill(); process.exit(0);
