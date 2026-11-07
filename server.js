/* Touchstone Race server: static files + WebSocket lobby/race rooms. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const S = require('./public/shared.js');
const { generateGame } = require('./puzzle');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_PLAYERS = 8;
const COUNTDOWN_MS = 4000;
const NUM_LEVELS = S.LEVELS.length;
const MINUTES = [2, 5, 10, 15];
const DURATION_OVERRIDE = +process.env.DURATION_MS || 0;   // tests only
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// ---------- static file server ----------
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let file = path.normalize(path.join(PUBLIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- rooms ----------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.\-!]/gu, '').trim().slice(0, 12) || 'Player';

function freeVoice(room) {
  const used = new Set([...room.players.values()].map((p) => p.voice));
  for (let v = 0; v < MAX_PLAYERS; v++) if (!used.has(v)) return v;
  return 0;
}
function addPlayer(room, name, ws) {
  const p = { id: crypto.randomBytes(4).toString('hex'), token: crypto.randomBytes(12).toString('hex'),
    name, voice: freeVoice(room), ws, connected: true,
    level: 0, board: null, phase: 0, lastDone: 0, levelStart: 0, levelMs: [], restarts: 0, finishMs: null };
  room.players.set(p.id, p);
  return p;
}
function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, voice: p.voice, connected: p.connected, host: p.id === room.hostId,
    done: p.level, finishMs: p.finishMs, levelMs: p.levelMs, restarts: p.restarts
  }));
}
function broadcast(room, msg) { for (const p of room.players.values()) send(p.ws, msg); }
function sendRoom(room) {
  broadcast(room, { t: 'room', code: room.code, state: room.state, hostId: room.hostId, minutes: room.minutes, endAt: room.endAt, final: room.final, players: publicPlayers(room) });
}
function resetPlayerForLevel(room, p) {
  const lv = room.game.levels[p.level];
  p.board = lv.start.slice();
  p.phase = 0;
}

function startRace(room) {
  room.game = generateGame(crypto.randomInt(1, 2 ** 31));
  // Players get the puzzles but never the solutions.
  room.clientGame = { levels: room.game.levels.map(({ n, shapes, start, par }) => ({ n, shapes, start, par })) };
  room.state = 'racing';
  room.startAt = Date.now() + COUNTDOWN_MS;
  room.endAt = room.startAt + (DURATION_OVERRIDE || room.minutes * 60000);
  room.final = null;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => endRace(room, 'time'), room.endAt - Date.now());
  for (const p of room.players.values()) {
    Object.assign(p, { level: 0, lastDone: room.startAt, levelStart: room.startAt, levelMs: [], restarts: 0, finishMs: null });
    resetPlayerForLevel(room, p);
  }
  broadcast(room, { t: 'start', game: room.clientGame, startAt: room.startAt, endAt: room.endAt, serverNow: Date.now() });
  sendRoom(room);
}
// Final standings: farthest wins. Order by levels cleared, then by how many gems are lit
// on the level in progress (as it stands when the race ends). Equal = shared rank (a tie).
function endRace(room, reason, winnerId) {
  if (room.state !== 'racing') return;
  clearTimeout(room.timer);
  const rows = [...room.players.values()].map((p) => ({
    id: p.id, done: p.level, finishMs: p.finishMs,
    lit: p.level >= NUM_LEVELS ? 0 : (p.board || []).reduce((a, b) => a + b, 0),
    cells: p.level >= NUM_LEVELS ? 0 : (p.board || []).length
  }));
  rows.sort((a, b) => (a.finishMs != null) !== (b.finishMs != null) ? (a.finishMs != null ? -1 : 1)
    : (a.finishMs != null ? a.finishMs - b.finishMs : b.done - a.done || b.lit - a.lit));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const same = prev && r.finishMs == null && prev.finishMs == null && prev.done === r.done && prev.lit === r.lit;
    r.rank = same ? prev.rank : i + 1;
  });
  room.final = { reason, standings: rows, winners: rows.filter((r) => r.rank === 1).map((r) => r.id) };
  room.state = 'results';
  sendRoom(room);
  broadcast(room, { t: 'results', reason, winners: room.final.winners });
}
function dropRoom(r) { clearTimeout(r.timer); rooms.delete(r.code); }

function handleTap(room, p, msg) {
  if (room.state !== 'racing' || Date.now() < room.startAt || p.level >= NUM_LEVELS) return;
  if (msg.level !== p.level) return resync(room, p);
  const lv = room.game.levels[p.level];
  const cell = msg.cell | 0;
  if (cell < 0 || cell >= lv.n * lv.n) return;
  S.applyMove(p.board, lv.n, lv.shapes[p.phase], cell);
  p.phase = (p.phase + 1) % lv.shapes.length;
  if (!S.isSolved(p.board)) return;

  // Level solved.
  const now = Date.now();
  const old = p.level;
  const oldLastDone = p.lastDone;
  p.levelMs.push(now - p.levelStart);
  p.level++;
  p.lastDone = now;
  p.levelStart = now;
  // Players who were ahead of this player before, and are now behind them.
  const passed = [];
  for (const q of room.players.values()) {
    if (q.id !== p.id && q.level === old && q.lastDone < oldLastDone) passed.push(q.id);
  }
  const place = [...room.players.values()].filter((q) => q.id !== p.id && q.level > old).length + 1;
  if (p.level >= NUM_LEVELS) {
    p.finishMs = now - room.startAt;
    const finishPlace = [...room.players.values()].filter((q) => q.finishMs !== null).length;
    broadcast(room, { t: 'ev', kind: 'finish', pid: p.id, level: old, ms: p.levelMs[old], place: finishPlace, passed });
    return endRace(room, 'finish', p.id);          // first to clear all five wins
  } else {
    resetPlayerForLevel(room, p);
    broadcast(room, { t: 'ev', kind: 'levelDone', pid: p.id, level: old, ms: p.levelMs[old], place, passed });
  }
  sendRoom(room);
}
function handleRestart(room, p) {
  if (room.state !== 'racing' || Date.now() < room.startAt || p.level >= NUM_LEVELS) return;
  resetPlayerForLevel(room, p);
  p.restarts++;
  broadcast(room, { t: 'ev', kind: 'restart', pid: p.id, level: p.level });
}
function resync(room, p) {
  send(p.ws, { t: 'resync', level: p.level, board: p.board, phase: p.phase, levelStart: p.levelStart });
}

// ---------- websocket ----------
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null, player = null;

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    switch (msg.t) {
      case 'ping': return send(ws, { t: 'pong', serverNow: Date.now(), c: msg.c });
      case 'create': {
        if (room) return;
        const code = newCode();
        room = { code, state: 'lobby', players: new Map(), hostId: null, game: null, startAt: 0, endAt: 0, minutes: 10, timer: null, final: null, lastActive: Date.now() };
        rooms.set(code, room);
        player = addPlayer(room, cleanName(msg.name), ws);
        room.hostId = player.id;
        send(ws, { t: 'welcome', pid: player.id, token: player.token, code });
        return sendRoom(room);
      }
      case 'join': {
        if (room) return;
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) return send(ws, { t: 'error', msg: 'No game with that code.' });
        if (r.state !== 'lobby') return send(ws, { t: 'error', msg: 'That race has already started.' });
        if (r.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'That game is full.' });
        room = r;
        player = addPlayer(room, cleanName(msg.name), ws);
        send(ws, { t: 'welcome', pid: player.id, token: player.token, code: room.code });
        return sendRoom(room);
      }
      case 'rejoin': {
        const r = rooms.get(String(msg.code || '').toUpperCase());
        const p = r && [...r.players.values()].find((q) => q.token === msg.token);
        if (!p) return send(ws, { t: 'error', msg: 'Could not rejoin that game.', fatal: true });
        room = r; player = p; p.ws = ws; p.connected = true;
        send(ws, { t: 'welcome', pid: p.id, token: p.token, code: r.code, rejoined: true });
        sendRoom(room);
        if (r.state === 'racing') {
          send(ws, { t: 'start', game: r.clientGame, startAt: r.startAt, endAt: r.endAt, serverNow: Date.now(), rejoin: true });
          resync(room, p);
        } else if (r.state === 'results') send(ws, { t: 'results' });
        return;
      }
      case 'start':
        if (!room || player.id !== room.hostId || room.state !== 'lobby') return;
        return startRace(room);
      case 'config':
        if (!room || player.id !== room.hostId || room.state !== 'lobby') return;
        if (MINUTES.includes(msg.minutes)) room.minutes = msg.minutes;
        return sendRoom(room);
      case 'tap': return room && handleTap(room, player, msg);
      case 'restart': return room && handleRestart(room, player);
      case 'end':
        if (!room || player.id !== room.hostId || room.state !== 'racing') return;
        return endRace(room, 'ended');
      case 'again':
        if (!room || player.id !== room.hostId || room.state !== 'results') return;
        room.state = 'lobby'; room.game = null; room.final = null; room.endAt = 0;
        for (const p of [...room.players.values()]) if (!p.connected) room.players.delete(p.id);
        return sendRoom(room);
      case 'leave':
        return leave();
    }
  });

  function leave() {
    if (!room) return;
    const r = room; const p = player;
    room = null; player = null;
    r.players.delete(p.id);
    if (r.players.size === 0) return void dropRoom(r);
    if (r.hostId === p.id) r.hostId = [...r.players.values()].find((q) => q.connected)?.id || [...r.players.keys()][0];
    sendRoom(r);
  }
  ws.on('close', () => {
    if (!room) return;
    player.connected = false;
    room.lastActive = Date.now();
    // In the lobby, a dropped player just disappears after a grace period.
    if (room.state === 'lobby') {
      const r = room, p = player;
      setTimeout(() => {
        if (!p.connected && r.players.has(p.id) && r.state === 'lobby') {
          r.players.delete(p.id);
          if (r.players.size === 0) return void dropRoom(r);
          if (r.hostId === p.id) r.hostId = [...r.players.keys()][0];
          sendRoom(r);
        }
      }, 20000);
    }
    sendRoom(room);
  });
});

// Drop dead sockets; clean up idle rooms.
setInterval(() => {
  wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyConnected = [...r.players.values()].some((p) => p.connected);
    if (anyConnected) r.lastActive = now;
    else if (now - r.lastActive > 30 * 60 * 1000) dropRoom(r);
  }
}, 25000);

server.listen(PORT, () => console.log('Touchstone Race listening on ' + PORT));
module.exports = { server, rooms };
