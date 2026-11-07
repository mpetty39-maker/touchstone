// Protocol + rules checks with raw websocket bots. Uses a short race (DURATION_MS) so time-up is testable.
process.env.PORT = '3112'; process.env.DURATION_MS = '5000';
const WebSocket = require('ws');
const S = require('../public/shared.js');
const { rooms } = require('../server.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function bot(name) {
  const ws = new WebSocket('ws://localhost:3112'); const b = { ws, msgs: [], name };
  ws.on('message', (d) => { const m = JSON.parse(d); b.msgs.push(m); if (m.t === 'welcome') { b.pid = m.pid; b.token = m.token; b.code = m.code; } });
  b.send = (m) => ws.send(JSON.stringify(m));
  b.open = new Promise((r) => ws.on('open', r));
  b.last = (t) => [...b.msgs].reverse().find((m) => m.t === t);
  return b;
}
// Independent scoring, written separately from the server: levels cleared, then lit gems, equal = tie.
function expectedRanks(rows) {
  const sorted = rows.slice().sort((a, b) => b.done - a.done || b.lit - a.lit);
  const rank = {}; sorted.forEach((r, i) => { rank[r.id] = i && sorted[i - 1].done === r.done && sorted[i - 1].lit === r.lit ? rank[sorted[i - 1].id] : i + 1; });
  return rank;
}
(async () => {
  const host = bot('host'); await host.open; host.send({ t: 'create', name: 'Host' }); await sleep(150);
  const code = host.code; ok(/^[A-Z]{4}$/.test(code), 'room code is 4 letters: ' + code);
  const bots = [host];
  for (let i = 1; i < 8; i++) { const b = bot('P' + i); await b.open; b.send({ t: 'join', code, name: 'P' + i }); bots.push(b); }
  await sleep(300);
  ok(host.last('room').players.length === 8, '8 players in lobby');
  ok(new Set(host.last('room').players.map((p) => p.voice)).size === 8, 'every player has a distinct sound voice');
  const ninth = bot('P9'); await ninth.open; ninth.send({ t: 'join', code, name: 'Nope' }); await sleep(120);
  ok(ninth.last('error') && /full/.test(ninth.last('error').msg), 'ninth player rejected (full)');

  // race length
  ok(host.last('room').minutes === 10, 'default race length is 10 minutes');
  bots[1].send({ t: 'config', minutes: 2 }); await sleep(80);
  ok(host.last('room').minutes === 10, 'non-host cannot change race length');
  host.send({ t: 'config', minutes: 7 }); await sleep(80);
  ok(host.last('room').minutes === 10, 'invalid race length ignored');
  for (const m of [2, 5, 15]) { host.send({ t: 'config', minutes: m }); await sleep(60); ok(bots[3].last('room').minutes === m, 'host sets ' + m + ' minutes, everyone sees it'); }
  host.send({ t: 'config', minutes: 5 }); await sleep(60);

  // ---------- race 1: ends on time ----------
  bots[1].send({ t: 'start' }); await sleep(80); ok(!bots[1].last('start'), 'non-host cannot start');
  host.send({ t: 'start' }); await sleep(200);
  const st = host.last('start'); ok(st && st.game.levels.length === 5, 'start sends 5 levels');
  ok(st.game.levels.map((l) => l.n).join() === '4,4,4,5,5', 'levels are 4x4, 4x4, 4x4, 5x5, 5x5');
  ok(!JSON.stringify(st).includes('solution'), 'solutions are NOT sent to clients');
  ok(bots.every((b) => JSON.stringify(b.last('start').game) === JSON.stringify(st.game)), 'all 8 players got identical puzzles');
  ok(st.endAt - st.startAt === 5000, 'race has an end time (startAt + length)');
  const late = bot('late'); await late.open; late.send({ t: 'join', code, name: 'Late' }); await sleep(100);
  ok(late.last('error') && /started/.test(late.last('error').msg), 'cannot join after start');
  await sleep(4100);
  const room = rooms.get(code), L = room.game.levels;
  const tapSeq = async (b, lvl, anchors) => { for (const a of anchors) b.send({ t: 'tap', level: lvl, cell: a }); await sleep(40); };
  const solveFull = async (b, lvl) => tapSeq(b, lvl, L[lvl].solution);
  // known progress, tracked independently:
  const prog = bots.map((b) => ({ id: b.pid, done: 0, lit: null }));
  const litAfter = (lvl, taps) => { const lv = L[lvl], bd = lv.start.slice(); taps.forEach((a, i) => S.applyMove(bd, lv.n, lv.shapes[i % lv.shapes.length], a)); return bd.reduce((x, y) => x + y, 0); };
  // bot1: clears level 1 and 2.  bots 2,3: clear level 1, then the same two partial taps on level 2 (tie).  bot4: partial taps on level 1 only.  rest: untouched.
  await solveFull(bots[1], 0); await solveFull(bots[1], 1); prog[1].done = 2; prog[1].lit = litAfter(2, []);
  const part = L[1].solution.slice(0, 2);
  for (const i of [2, 3]) { await solveFull(bots[i], 0); await tapSeq(bots[i], 1, part); prog[i].done = 1; prog[i].lit = litAfter(1, part); }
  const part4 = L[0].solution.slice(0, 2); await tapSeq(bots[4], 0, part4); prog[4].done = 0; prog[4].lit = litAfter(0, part4);
  for (const i of [0, 5, 6, 7]) { prog[i].done = 0; prog[i].lit = litAfter(0, []); }
  ok(host.msgs.some((m) => m.t === 'ev' && m.kind === 'levelDone' && m.pid === bots[1].pid && m.place === 1), 'levelDone event broadcast with place=1');
  bots[5].send({ t: 'tap', level: 0, cell: 0 }); bots[5].send({ t: 'restart' }); await sleep(80);
  ok(host.msgs.some((m) => m.t === 'ev' && m.kind === 'restart' && m.pid === bots[5].pid), 'restart event broadcast');
  ok(room.state === 'racing', 'race still running before time is up');
  await sleep(Math.max(0, room.endAt - Date.now()) + 400);   // wait for the real end time
  ok(room.state === 'results' && room.final.reason === 'time', 'race ends when time runs out');
  const exp = expectedRanks(prog);
  const got = {}; room.final.standings.forEach((r) => { got[r.id] = r.rank; });
  ok(prog.every((p) => got[p.id] === exp[p.id]), 'final ranks = levels cleared, then lit gems, ties shared  ' + JSON.stringify(prog.map((p) => exp[p.id])));
  ok(got[bots[2].pid] === got[bots[3].pid] && got[bots[2].pid] === 2, 'identical progress ties (2=)');
  ok(room.final.winners.length === 1 && room.final.winners[0] === bots[1].pid, 'most levels cleared wins');
  const beforeTap = room.players.get(bots[4].pid).level;
  await tapSeq(bots[4], 0, L[0].solution); ok(room.players.get(bots[4].pid).level === beforeTap, 'taps after the end are ignored');
  ok(host.msgs.some((m) => m.t === 'results' && m.reason === 'time'), 'results message sent with reason');

  // ---------- race 2: a full clear ends it immediately ----------
  host.send({ t: 'again' }); await sleep(100); ok(room.state === 'lobby' && host.last('room').final === null, 'host returns everyone to the lobby');
  ok(host.last('room').minutes === 5, 'race length is remembered');
  host.send({ t: 'start' }); await sleep(4300);
  const L2 = room.game.levels;
  bots[2].send({ t: 'tap', level: 0, cell: L2[0].solution[0] }); await sleep(30);   // someone else has partial progress
  for (let l = 0; l < 5; l++) { L2[l].solution.forEach((a) => bots[1].send({ t: 'tap', level: l, cell: a })); await sleep(50); }
  await sleep(200);
  ok(room.state === 'results' && room.final.reason === 'finish', 'first to clear all five ends the race at once');
  ok(room.final.winners.length === 1 && room.final.winners[0] === bots[1].pid && room.final.standings[0].finishMs != null, 'full clear wins');
  ok(host.msgs.some((m) => m.t === 'ev' && m.kind === 'finish' && m.pid === bots[1].pid), 'finish event broadcast');
  ok(room.timer && true, 'timer object present'); 

  // ---------- rejoin ----------
  host.send({ t: 'again' }); await sleep(100); host.send({ t: 'start' }); await sleep(4300);
  const L3 = room.game.levels;
  L3[0].solution.forEach((a) => bots[2].send({ t: 'tap', level: 0, cell: a })); await sleep(60);
  bots[2].ws.terminate(); await sleep(150);
  ok(host.last('room').players.find((p) => p.id === bots[2].pid).connected === false, 'disconnect flagged');
  const re = bot('re'); await re.open; re.send({ t: 'rejoin', code, token: bots[2].token }); await sleep(200);
  ok(re.last('welcome') && re.last('welcome').pid === bots[2].pid, 'rejoin restores same player');
  ok(re.last('start') && re.last('start').endAt === room.endAt, 'rejoin gets puzzles and the same end time');
  ok(re.last('resync') && re.last('resync').level === 1, 'rejoin resyncs to level 2');
  const bogus = bot('bogus'); await bogus.open; bogus.send({ t: 'rejoin', code, token: 'nope' }); await sleep(100);
  ok(bogus.last('error') && bogus.last('error').fatal, 'bad token refused');
  await sleep(1500);
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
