// Two real browsers (host + guest) race through all 5 levels against a real server.
process.env.PORT = process.env.PORT || '3111';
const { rooms } = require('../server.js');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function solveLevel(page, code, level, opts = {}) {
  const lv = rooms.get(code).game.levels[level];
  if (opts.fumble) {                            // make a wrong move, then restart (loses time)
    await page.click('.cell[data-i="0"]'); await page.click('.shape.active');
    await sleep(200); await page.click('#restartBtn'); await sleep(300);
  }
  for (const a of lv.solution) {
    await page.click(`.cell[data-i="${a}"]`);
    await page.click('.shape.active');
    await sleep(opts.pace || 120);
  }
}
async function waitLevel(page, n) {
  await page.waitForFunction((n) => document.getElementById('lvlNum').textContent.startsWith('Level ' + n), n, { timeout: 8000 });
}

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
  await A.screenshot({ path: OUT + '/01-home.png' });

  await A.fill('#nameIn', 'Mike'); await A.click('#createBtn');
  await A.waitForSelector('#lobby:not(.hidden)');
  const code = (await A.textContent('#lobbyCode')).trim();
  console.log('room code', code);
  await B.fill('#nameIn', 'Sam'); await B.fill('#codeIn', code); await B.click('#joinBtn');
  await B.waitForSelector('#lobby:not(.hidden)');
  await sleep(300);
  await A.screenshot({ path: OUT + '/02-lobby.png' });

  await A.click('#startBtn');
  await A.waitForSelector('#countdown:not(.hidden)');
  await sleep(500); await B.screenshot({ path: OUT + '/03-countdown.png' });
  await sleep(4000);

  // L1: both select; screenshot a preview state on B
  const lv0 = rooms.get(code).game.levels[0];
  await B.click(`.cell[data-i="${lv0.solution[0]}"]`); await sleep(200);
  await B.screenshot({ path: OUT + '/04-level1-selected.png' });
  await B.click(`.cell[data-i="${lv0.solution[0]}"]`); // deselect

  const play = async (page, who, opts) => {
    for (let l = 0; l < 5; l++) {
      await waitLevel(page, l + 1);
      if (l === 4 && who === 'A') await page.screenshot({ path: OUT + '/05-level5-6x6.png' });
      await solveLevel(page, code, l, opts(l));
      await sleep(l === 4 ? 300 : 1500);
      if (who === 'A' && l === 1) await page.screenshot({ path: OUT + '/06-level3-5x5.png' });
    }
  };
  await Promise.all([
    play(A, 'A', (l) => ({ pace: 80, fumble: l === 1 })),
    play(B, 'B', (l) => ({ pace: 160 }))
  ]);
  await sleep(1500);
  await B.screenshot({ path: OUT + '/07-results-B.png' });
  await A.screenshot({ path: OUT + '/08-results-A.png' });
  const room = rooms.get(code);
  console.log('server state', room.state, [...room.players.values()].map((p) => ({ n: p.name, level: p.level, fin: p.finishMs, restarts: p.restarts, splits: p.levelMs })));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
