// Protocol checks with raw websocket bots: limits, late join, rejoin mid-race, event sounds data.
process.env.PORT = '3112';
const WebSocket = require('ws');
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
(async () => {
  const host = bot('host'); await host.open; host.send({ t: 'create', name: 'Host' }); await sleep(150);
  const code = host.code; ok(/^[A-Z]{4}$/.test(code), 'room code is 4 letters: ' + code);
  const bots = [host];
  for (let i = 1; i < 8; i++) { const b = bot('P' + i); await b.open; b.send({ t: 'join', code, name: 'P' + i }); bots.push(b); }
  await sleep(300);
  ok(host.last('room').players.length === 8, '8 players in lobby');
  const voices = new Set(host.last('room').players.map((p) => p.voice)); ok(voices.size === 8, 'every player has a distinct sound voice');
  const ninth = bot('P9'); await ninth.open; ninth.send({ t: 'join', code, name: 'Nope' }); await sleep(150);
  ok(ninth.last('error') && /full/.test(ninth.last('error').msg), 'ninth player rejected (full)');
  const bad = bot('bad'); await bad.open; bad.send({ t: 'join', code: 'ZZZZ', name: 'x' }); await sleep(100);
  ok(bad.last('error') && /No game/.test(bad.last('error').msg), 'unknown code rejected');
  bots[1].send({ t: 'start' }); await sleep(100); ok(!bots[1].last('start'), 'non-host cannot start');
  host.send({ t: 'start' }); await sleep(200);
  const st = host.last('start'); ok(st && st.game.levels.length === 5, 'start sends 5 levels');
  ok(!JSON.stringify(st).includes('solution'), 'solutions are NOT sent to clients');
  ok(bots.every((b) => JSON.stringify(b.last('start').game) === JSON.stringify(st.game)), 'all 8 players got identical puzzles');
  const late = bot('late'); await late.open; late.send({ t: 'join', code, name: 'Late' }); await sleep(100);
  ok(late.last('error') && /started/.test(late.last('error').msg), 'cannot join after start');
  await sleep(4100);
  const room = rooms.get(code), L = room.game.levels;
  const solve = async (b, lvl) => { for (const a of L[lvl].solution) b.send({ t: 'tap', level: lvl, cell: a }); await sleep(60); };
  // taps before the race is over / out of order are ignored, solving advances
  await solve(bots[1], 0); await solve(bots[1], 1);
  const p1 = room.players.get(bots[1].pid); ok(p1.level === 2, 'server verified 2 levels by replaying taps (level=' + p1.level + ')');
  ok(host.msgs.some((m) => m.t === 'ev' && m.kind === 'levelDone' && m.pid === bots[1].pid && m.place === 1), 'levelDone event broadcast with place=1');
  await solve(bots[2], 0); await sleep(50);
  const ev = host.msgs.filter((m) => m.t === 'ev' && m.pid === bots[2].pid && m.kind === 'levelDone')[0];
  ok(ev && ev.place === 2, 'second finisher gets place=2');
  // restart event
  bots[3].send({ t: 'tap', level: 0, cell: 0 }); bots[3].send({ t: 'restart' }); await sleep(80);
  ok(host.msgs.some((m) => m.t === 'ev' && m.kind === 'restart' && m.pid === bots[3].pid), 'restart event broadcast');
  // overtake: bot 4 (level 0, was ahead of nobody) completes level 0 after bot 5 did? bot5 first, then bot4 passes nobody.
  await solve(bots[5], 0); await sleep(50);
  await solve(bots[4], 0); await sleep(50);
  const passEv = host.msgs.filter((m) => m.t === 'ev' && m.pid === bots[1].pid && m.kind === 'levelDone');
  // bot 6 finishes level 0 AFTER bot1.. bot6 passes players still on level 0 that were ahead? check with bot3 (restarted, still L0)
  // rejoin mid-race
  bots[2].ws.terminate(); await sleep(150);
  ok(host.last('room').players.find((p) => p.id === bots[2].pid).connected === false, 'disconnect flagged');
  const re = bot('re'); await re.open; re.send({ t: 'rejoin', code, token: bots[2].token }); await sleep(200);
  ok(re.last('welcome') && re.last('welcome').pid === bots[2].pid, 'rejoin restores same player');
  ok(re.last('start') && re.last('resync') && re.last('resync').level === 1, 'rejoin gets puzzles + resync to level 2');
  const bogus = bot('bogus'); await bogus.open; bogus.send({ t: 'rejoin', code, token: 'nope' }); await sleep(100);
  ok(bogus.last('error') && bogus.last('error').fatal, 'bad token refused');
  // finish everyone -> results
  for (const b of [bots[2], bots[1]]) {}
  const everyone = [[re, bots[2].pid, 1], [bots[1], null, 2]];
  for (let lvl = 1; lvl < 5; lvl++) await solve(re, lvl);
  for (let lvl = 2; lvl < 5; lvl++) await solve(bots[1], lvl);
  ok(room.players.get(bots[2].pid).finishMs != null, 'finisher gets finishMs');
  ok(host.msgs.some((m) => m.t === 'ev' && m.kind === 'finish' && m.pid === bots[1].pid && m.place === 2), 'finish events carry finishing place');
  host.send({ t: 'end' }); await sleep(100);
  ok(room.state === 'results', 'host can end the race');
  host.send({ t: 'again' }); await sleep(100);
  ok(room.state === 'lobby' && host.last('room').state === 'lobby', 'host can return everyone to the lobby');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
