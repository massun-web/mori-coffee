// Browser checks using Node.js 22+ and the locally installed Microsoft Edge.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'mori-preview-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timeout = setTimeout(() => reject(new Error('Browser startup timed out')), 20000);
    let output = '';
    edge.on('error', reject);
    edge.stderr.on('data', data => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolveEndpoint(match[1]); }
    });
  });
  const pages = await (await fetch(endpoint.replace('ws:', 'http:').replace(/\/devtools\/.*/, '/json/list'))).json();
  ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolveOpen => ws.addEventListener('open', resolveOpen, { once: true }));
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      const { resolveResult, reject, timer } = pending.get(message.id);
      clearTimeout(timer); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolveResult(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolveResult, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolveResult, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const pause = ms => new Promise(done => setTimeout(done, ms));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(resolve('index.html')).href });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate('document.readyState === "complete"')) break;
    await pause(250);
  }
  await evaluate('Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 5000))]).then(() => true)');
  await evaluate('Promise.all([...document.images].map(img => {img.loading="eager"; return img.decode()})).then(() => true)');
  const anchors = await evaluate(`[...document.querySelectorAll('a[href^="#"]')].every(a => document.querySelector(a.getAttribute('href')))`);
  assert(anchors, 'All anchor targets exist');
  assert.equal(await evaluate('document.querySelectorAll("h1").length'), 1);
  assert(await evaluate('[...document.images].every(i => i.naturalWidth > 0 && i.alt.length > 0)'));
  await mkdir('preview', { recursive: true });
  for (const width of [1440, 1024, 768, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await pause(200);
    const dimensions = await evaluate('({width:innerWidth, scroll:document.documentElement.scrollWidth})');
    assert(dimensions.scroll <= width, `No horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`);
    if (width === 1440 || width === 390) {
      // Scroll naturally to exercise reveal behavior before capturing the complete page.
      await evaluate('(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){window.scrollTo({top:y,behavior:"instant"});await new Promise(r=>setTimeout(r,60))}window.scrollTo({top:0,behavior:"instant"})})()');
      await pause(900);
      assert.equal(await evaluate('document.querySelectorAll(".is-pending").length'), 0);
      const height = await evaluate('document.documentElement.scrollHeight');
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      await writeFile(`preview/${width === 1440 ? 'desktop' : 'mobile'}.png`, Buffer.from(shot.data, 'base64'));
    }
    console.log(`PASS: ${width}px, no horizontal overflow`);
  }
  await evaluate('document.querySelector(".menu-toggle").click()');
  assert(await evaluate('document.querySelector(".menu-toggle").getAttribute("aria-expanded")==="true" && getComputedStyle(document.querySelector(".main-nav")).display!=="none"'));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert(await evaluate('document.querySelector(".menu-toggle").getAttribute("aria-expanded")==="false"'));
  await evaluate('document.querySelector(".menu-toggle").click();document.querySelector(".main-nav a").click()');
  assert(await evaluate('!document.body.classList.contains("menu-open") && document.activeElement.id === "concept"'));
  console.log('PASS: mobile menu open, Escape close, anchor navigation and focus');
  await evaluate('document.querySelector("[data-instagram]").click()');
  assert(await evaluate('document.querySelector("dialog").open'));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await pause(100);
  assert(await evaluate('!document.querySelector("dialog").open'));
  console.log('PASS: Instagram dialog open and Escape close');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert(await evaluate('getComputedStyle(document.documentElement).scrollBehavior === "auto"'));
  console.log('PASS: reduced motion; loaded images; internal links; unique h1');
  assert.deepEqual(errors, []);
  console.log('PASS: no JavaScript runtime errors');
} finally {
  if (ws) ws.close();
  edge.kill();
}
