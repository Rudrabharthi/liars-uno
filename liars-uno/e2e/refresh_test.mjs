import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const a = await ctxA.newPage();
const b = await ctxB.newPage();
const reqs = [];
const errs = [];
for (const [n, p] of [['A', a], ['B', b]]) {
  p.on('request', (r) => reqs.push(n + ' ' + r.method() + ' ' + r.url()));
  p.on('response', (r) => { if (r.status() >= 400) errs.push(n + ' ' + r.status() + ' ' + r.url()); });
  p.on('pageerror', (e) => errs.push(n + ' pageerror: ' + e.message));
}
const click = async (l) => { await l.waitFor({ state: 'attached', timeout: 60000 }); await l.dispatchEvent('click'); };

await a.goto('https://liars-uno.onrender.com/', { waitUntil: 'load', timeout: 120000 });
await a.locator('.input-dark').first().fill('Alice');
const createBtn = a.locator('button.btn-primary').last();
for (let i = 0; i < 90; i++) { if (!(await createBtn.isDisabled().catch(() => true))) break; await sleep(1000); }
await click(createBtn);
await a.locator('h2.panel-title').waitFor({ timeout: 30000 });
const code = (await a.locator('h2.panel-title').textContent()).match(/Room\s+(\w{6})/)[1];

// navigate A to the invite-link URL to simulate real usage
await a.goto(`https://liars-uno.onrender.com/#join=${code}`, { waitUntil: 'load', timeout: 120000 });

await b.goto('https://liars-uno.onrender.com/', { waitUntil: 'load', timeout: 120000 });
await b.locator('.input-dark').first().fill('Bob');
const joinBtn = b.locator('button.btn-primary').last();
for (let i = 0; i < 90; i++) { if (!(await joinBtn.isDisabled().catch(() => true))) break; await sleep(1000); }
await click(b.locator('button.btn-ghost', { hasText: 'Join room' }));
await b.locator('.input-dark').nth(1).fill(code);
await click(b.locator('button.btn-primary', { hasText: 'Join room' }).last());
await b.getByText('Players (2/7)').waitFor({ timeout: 30000 });

await click(a.locator('button', { hasText: 'Start game' }));
await a.locator('.hand-dock').waitFor({ timeout: 30000 });
await b.locator('.hand-dock').waitFor({ timeout: 30000 });
console.log('GAME STARTED. Hard-reloading A (cache bypass) mid-game...');

await ctxA.clearCookies();
await a.reload({ waitUntil: 'load', timeout: 120000 });
await sleep(5000);
console.log('A URL:', a.url());
console.log('A BODY:', JSON.stringify((await a.locator('body').innerText()).slice(0, 150)));
console.log('ERRORS:', JSON.stringify(errs));
console.log('REQ COUNT:', reqs.length);
await browser.close();