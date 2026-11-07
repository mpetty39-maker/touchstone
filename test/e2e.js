// Real browsers (host + guest, phone-sized) against a real server.
//   node test/e2e.js <outdir>               full race: first to clear all five wins
//   E2E_MODE=timeup DURATION_MS=14000 node test/e2e.js <outdir>   time runs out with partial progress
process.env.PORT = process.env.PORT || '3111';
const MODE = process.env.E2E_MODE || 'finish';
const { rooms } = require('../server.js');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

// Tap a gem to select it, tap it again to place the shape.
async function place(page, a) { await page.click(`.cell[data-i="${a}"]`); await page.click(`.cell[data-i="${a}"]`); }
async function solveLevel(page, code, level, opts = {}) {
  const lv = rooms.get(code).game.levels[level];
  if (opts.fumble) { await place(page, 0); await sleep(200); await page.click('#restartBtn'); await sleep(300); }
  for (const a of lv.solution) { await place(page, a); await sleep(opts.pace || 120); }
}
const waitLevel = (page, n) => page.waitForFunction((n) => document.getElementById('lvlNum').textContent.startsWith('Level ' + n), n, { timeout: 9000 });

(async () => {
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await page.goto('http://localhost:' + process.env.PORT + '/');
    return page;
  };
  const A = await mk('A'), B = await mk('B');
  await A.fill('#nameIn', 'Mike'); await A.click('#createBtn');
  await A.waitForSelector('#lobby:not(.hidden)');
  const code = (await A.textContent('#lobbyCode')).trim();
  await B.fill('#nameIn', 'Sam'); await B.fill('#codeIn', code); await B.click('#joinBtn');
  await B.waitForSelector('#lobby:not(.hidden)');
  await A.click('.seg-b[data-m="5"]'); await sleep(300);
  console.log('guest sees length buttons disabled:', await B.$$eval('.seg-b', (bs) => bs.every((b) => b.disabled)), '| guest sees 5 selected:', await B.$eval('.seg-b.on', (b) => b.textContent));
  await A.screenshot({ path: OUT + '/u1-lobby.png' });

  await A.click('#startBtn');
  await A.waitForSelector('#countdown:not(.hidden)');
  await sleep(4300);
  console.log('clock at start shows', await A.textContent('#clock'));
  const lv0 = rooms.get(code).game.levels[0];
  await B.click(`.cell[data-i="${lv0.solution[0]}"]`); await sleep(250);          // select only: shows preview
  console.log('hint after first tap:', await B.textContent('#hint'));
  const litBefore = await B.$$eval('.cell.on', (c) => c.length);
  await B.screenshot({ path: OUT + '/u2-preview.png' });
  await B.click(`.cell[data-i="${lv0.solution[0]}"]`); await sleep(300);            // second tap places it
  const litAfter = await B.$$eval('.cell.on', (c) => c.length);
  console.log('lit before/after confirm tap:', litBefore, litAfter, '| active shape moved on:', await B.$eval('.shape.active .ord', (e) => e.textContent));
  await B.click('#restartBtn'); await sleep(300);

  if (MODE === 'finish') {
    const play = async (page, who, opts) => {
      for (let l = 0; l < 5; l++) {
        await waitLevel(page, l + 1);
        if (l === 3 && who === 'A') await page.screenshot({ path: OUT + '/u3-level4-5x5.png' });
        await solveLevel(page, code, l, opts(l));
        await sleep(l === 4 ? 100 : 1500);
      }
    };
    await Promise.all([
      play(A, 'A', (l) => ({ pace: 70, fumble: l === 1 })),
      play(B, 'B', () => ({ pace: 400 })).catch(() => {})       // B is still mid-race when A wins
    ]);
    await sleep(500); await B.screenshot({ path: OUT + '/u4-endbanner-B.png' });
    await sleep(2200);
  } else {
    // Both make partial progress, then time runs out.
    await solveLevel(A, code, 0); await waitLevel(A, 2);
    await solveLevel(B, code, 0); await waitLevel(B, 2);
    const lv1 = rooms.get(code).game.levels[1];
    await place(A, lv1.solution[0]); await place(A, lv1.solution[1]);
    await sleep(500); await A.screenshot({ path: OUT + '/u5-low-clock.png' });
    await A.waitForSelector('#banner:not(.hidden)', { timeout: 20000 });
    await sleep(300); await A.screenshot({ path: OUT + '/u6-timeup-banner.png' });
    await sleep(2200);
  }
  await A.waitForSelector('#results:not(.hidden)');
  console.log('A title:', await A.textContent('#resTitle'), '|', await A.textContent('#resSub'));
  console.log('B title:', await B.textContent('#resTitle'), '|', await B.textContent('#resSub'));
  console.log('host sees Play again:', await A.isVisible('#againBtn'), '| guest sees Play again:', await B.isVisible('#againBtn'));
  await A.screenshot({ path: OUT + `/u7-results-${MODE}-A.png` });
  await B.screenshot({ path: OUT + `/u8-results-${MODE}-B.png` });
  const room = rooms.get(code);
  console.log('final:', room.final.reason, JSON.stringify(room.final.standings.map((r) => ({ rank: r.rank, done: r.done, lit: r.lit + '/' + r.cells, fin: r.finishMs }))));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
