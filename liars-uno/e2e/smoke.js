import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const serverDir = path.join(root, 'server');
const clientDir = path.join(root, 'client');

const SERVER_URL = 'http://localhost:3001';
const CLIENT_URL = 'http://localhost:4173';
const MOVES_CAP = 140;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function killTree(pid) {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
}

function spawnNode(cwd, args) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  child.on('exit', (code) => {
    if (code && code !== 0) console.log(`[e2e] ${args.join(' ')} exited with code ${code}`);
  });
  return child;
}

// ---------------------------------------------------------------------------
// UI turn-driver
// ---------------------------------------------------------------------------

async function isVisible(locator) {
  try {
    return await locator.isVisible({ timeout: 400 });
  } catch {
    return false;
  }
}

// Framer Motion hover/tap animations keep elements permanently "unstable" for
// Playwright's actionability checks, so fire the DOM click directly.
async function clickIt(locator) {
  await locator.waitFor({ state: 'attached', timeout: 5000 });
  await locator.dispatchEvent('click');
}

async function handleModal(page) {
  const modal = page.locator('.modal-card');
  if (!(await isVisible(modal))) return;
  await sleep(120);
  const wildMode = await isVisible(modal.getByText('Play Wild — choose color'));
  if (wildMode) {
    await clickIt(modal.locator('.choice-chip', { hasText: 'Red' }));
  } else {
    await clickIt(modal.locator('.choice-chip', { hasText: 'Red' }));
    await modal.getByText('Claimed value / action').waitFor({ timeout: 4000 });
    await clickIt(modal.locator('.choice-chip:not(.choice-disabled)').first());
  }
  await page.waitForSelector('.modal-card', { state: 'detached', timeout: 4000 }).catch(() => {});
}

async function findActionPage(pages) {
  for (const p of pages) {
    const playable = await p.locator('.card-playable').count();
    const handBtn = await isVisible(p.locator('.hand-dock button').first());
    if (playable > 0 || handBtn) return p;
  }
  return null;
}

async function driveGame(pages, log) {
  let challenges = 0;
  for (let move = 0; move < MOVES_CAP; move++) {
    for (const p of pages) {
      if (await isVisible(p.locator('.game-over-podium'))) {
        log('game over reached');
        return;
      }
    }

    // 1) catch-window (opponent report button)
    let handled = false;
    for (const p of pages) {
      const catchBtn = p.locator('.btn-catch', { hasText: 'Catch UNO!' });
      if (await isVisible(catchBtn)) {
        await clickIt(catchBtn);
        log(`move ${move}: catch UNO`);
        await sleep(150);
        handled = true;
        break;
      }
    }
    if (handled) continue;

    // 2) pending challenge — first one calls liar, rest accept
    for (const p of pages) {
      const callBtn = p.locator('.btn-liar:not([disabled])');
      if (await isVisible(callBtn)) {
        if (challenges === 0) {
          await clickIt(callBtn);
          log(`move ${move}: CALL LIAR`);
        } else {
          await clickIt(p.locator('.btn-accept:not([disabled])'));
          log(`move ${move}: ACCEPT`);
        }
        challenges++;
        await sleep(200);
        handled = true;
        break;
      }
    }
    if (handled) continue;

    // 3) active player's turn
    const active = await findActionPage(pages);
    if (!active) {
      await sleep(200);
      continue;
    }

    // 3a) UNO shout
    const unoBtn = active.locator('.uno-button');
    if (await isVisible(unoBtn)) {
      await clickIt(unoBtn);
      log(`move ${move}: UNO!`);
      await sleep(120);
    }

    // 3b) accept pending draw stack
    const acceptStack = active.locator('button.btn-accent', { hasText: 'Accept +' });
    if (await isVisible(acceptStack)) {
      await clickIt(acceptStack);
      log(`move ${move}: accept stack`);
      await sleep(200);
      continue;
    }

    // 3c) play a card (prefer a liar bluff)
    const liarPlay = active.locator('.card-playable:has(.liar-indicator-badge)').first();
    const anyPlay = active.locator('.card-playable').first();
    if (await isVisible(liarPlay)) {
      await clickIt(liarPlay);
      await handleModal(active);
      log(`move ${move}: bluff`);
      await sleep(150);
      continue;
    }
    if (await isVisible(anyPlay)) {
      await clickIt(anyPlay);
      await handleModal(active);
      log(`move ${move}: play`);
      await sleep(150);
      continue;
    }

    // 3d) draw
    const drawBtn = active.locator('button.btn-primary', { hasText: 'Draw' });
    if (await isVisible(drawBtn)) {
      await clickIt(drawBtn);
      log(`move ${move}: draw`);
      await sleep(150);
      continue;
    }

    // 3e) pass
    const passBtn = active.locator('button.btn-ghost, button.btn-primary', { hasText: 'Pass' });
    if (await isVisible(passBtn)) {
      await clickIt(passBtn);
      log(`move ${move}: pass`);
      await sleep(150);
      continue;
    }

    // nothing actionable — wait for state to settle
    await sleep(250);
  }
  throw new Error(`game did not finish within ${MOVES_CAP} moves`);
}

// ---------------------------------------------------------------------------

const server = spawnNode(serverDir, ['src/server.js']);
const preview = spawnNode(clientDir, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort']);

let browser;
let a, b;
try {
  await waitForHttp(`${SERVER_URL}/health`);
  await waitForHttp(CLIENT_URL);
  console.log('[e2e] server + client up');

  browser = await chromium.launch();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  a = await ctxA.newPage();
  b = await ctxB.newPage();
  const log = (m) => console.log(`  [e2e] ${m}`);
  for (const p of [a, b]) {
    p.on('pageerror', (e) => log(`PAGE ERROR: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error') log(`console.error: ${m.text()}`);
    });
  }

  // --- lobby: create + join ---
  await a.goto(CLIENT_URL);
  await a.locator('.input-dark').first().fill('Alice');
  // set starting hand size to 5 via the range slider
  await a.locator('.range-slider').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '5');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await a.locator('button.btn-primary', { hasText: 'Create room' }).click();
  await a.locator('h2.panel-title').waitFor({ timeout: 10000 });
  const code = (await a.locator('h2.panel-title').textContent()).match(/Room\s+(\w{6})/)[1];
  log(`room ${code}`);

  await b.goto(CLIENT_URL);
  await b.locator('.input-dark').first().fill('Bob');
  await b.locator('button.btn-ghost', { hasText: 'Join room' }).click();
  await b.locator('.input-dark').nth(1).fill(code);
  await b.locator('button.btn-primary', { hasText: 'Join room' }).click();
  await b.getByText('Players (2/7)').waitFor({ timeout: 10000 });

  const startBtn = a.locator('button', { hasText: 'Start game' });
  await startBtn.waitFor({ timeout: 10000 });
  await startBtn.click();
  log('start clicked');

  // --- game board on both ---
  for (const [name, p] of [['A', a], ['B', b]]) {
    await p.locator('.hand-dock').waitFor({ timeout: 10000 });
    await p.waitForFunction(
      () => document.querySelectorAll('.hand-scroll .card').length === 5,
      null,
      { timeout: 15000 }
    );
    log(`${name} hand rendered (5 cards)`);
  }

  await driveGame([a, b], log);

  // --- victory podium on both pages ---
  await a.locator('.game-over-podium').waitFor({ timeout: 10000 });
  await b.locator('.game-over-podium').waitFor({ timeout: 10000 });
  const title = (await a.locator('.modal-card h2').textContent()).trim();
  log(`podium: ${title}`);

  console.log('\nPASS — full 2-player game completed through the UI');
  await browser.close();
} catch (err) {
  console.error('\nFAIL —', err.message);
  if (a && b) {
    for (const [name, p] of [['A', a], ['B', b]]) {
      try {
        const body = await p.locator('body').innerText();
        console.log(`[${name}] body text:\n${body.slice(0, 900)}`);
        await p.screenshot({ path: path.join(__dirname, `fail-${name}.png`) });
      } catch {}
    }
  }
  if (browser) {
    try { await browser.close(); } catch {}
  }
  process.exitCode = 1;
} finally {
  await sleep(300);
  killTree(server.pid);
  killTree(preview.pid);
  await sleep(300);
}