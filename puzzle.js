/* Server-side puzzle generator. Every board is built by scrambling a solved
 * board, so it is always solvable. A meet-in-the-middle search then finds the
 * true "par" (fewest taps) so difficulty can be controlled per level. */
'use strict';
const S = require('./public/shared.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = S.buildPool();
const TWO32 = 4294967296;

// Board masks are up to 36 bits, kept as a (hi, lo) pair of 32-bit ints.
function maskOf(n, shape, anchor) {
  let hi = 0, lo = 0;
  for (const i of S.patternCells(n, shape, anchor)) {
    if (i < 32) lo |= (1 << i); else hi |= (1 << (i - 32));
  }
  return [hi >>> 0, lo >>> 0];
}

// Fewest taps (cycling through shapes 0,1,2,...) to turn `start` into all-lit.
// Returns 0 if not solvable within maxL.
function solvePar(n, shapes, start, maxL) {
  const k = shapes.length, cells = n * n;
  let dHi = 0, dLo = 0;                       // cells that must be flipped
  for (let i = 0; i < cells; i++) if (!start[i]) { if (i < 32) dLo |= (1 << i); else dHi |= (1 << (i - 32)); }
  dHi >>>= 0; dLo >>>= 0;
  if (!dHi && !dLo) return 0;
  const pat = shapes.map((s) => { const a = []; for (let c = 0; c < cells; c++) a.push(maskOf(n, s, c)); return a; });
  const leftCache = new Map();
  function leftSet(h) {                       // all XORs of the first h moves
    if (leftCache.has(h)) return leftCache.get(h);
    let cur = new Set([0]);                   // key = hi*2^32 + lo
    for (let m = 0; m < h; m++) {
      const nxt = new Set();
      for (const key of cur) {
        const hi = Math.floor(key / TWO32), lo = key % TWO32;
        for (let c = 0; c < cells; c++) {
          const p = pat[m % k][c];
          nxt.add(((hi ^ p[0]) >>> 0) * TWO32 + ((lo ^ p[1]) >>> 0));
        }
      }
      cur = nxt;
    }
    leftCache.set(h, cur);
    return cur;
  }
  for (let L = 1; L <= maxL; L++) {
    const h = Math.floor(L / 2), left = leftSet(h);
    let found = false;
    const rec = (m, hi, lo) => {                // enumerate the remaining L-h moves
      if (found) return;
      if (m === L) { if (left.has(((hi ^ dHi) >>> 0) * TWO32 + ((lo ^ dLo) >>> 0))) found = true; return; }
      const arr = pat[m % k];
      for (let c = 0; c < cells && !found; c++) rec(m + 1, hi ^ arr[c][0], lo ^ arr[c][1]);
    };
    rec(h, 0, 0);
    if (found) return L;
  }
  return 0;
}

function generateLevel(cfg, rng, tries = 400) {
  const { n, k } = cfg, cells = n * n;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const sizeOk = POOL.filter((s) => s.size >= cfg.minSize && s.size <= cfg.maxSize);
  for (let t = 0; t < tries; t++) {
    // k shapes, no two identical in footprint+touchstone, and no two with the same base+orientation
    const shapes = [];
    while (shapes.length < k) {
      const s = pick(sizeOk);
      const base = s.id.split('.').slice(0, 2).join('.');
      if (shapes.some((x) => x.id.split('.').slice(0, 2).join('.') === base)) continue;
      shapes.push(s);
    }
    const L = cfg.parMin + Math.floor(rng() * (cfg.parMax - cfg.parMin + 1));
    const board = new Array(cells).fill(1);
    const solution = [];
    for (let m = 0; m < L; m++) { const a = Math.floor(rng() * cells); solution.push(a); S.applyMove(board, n, shapes[m % k], a); }
    const lit = board.reduce((a, b) => a + b, 0);
    if (lit < Math.ceil(cells * 0.15) || lit > cells - 3) continue;
    const par = solvePar(n, shapes, board, L);
    if (par < cfg.parMin || par > cfg.parMax) continue;
    return { n, shapes: shapes.map((s) => ({ id: s.id, cells: s.cells })), start: board, par, solution /* server/test only */ };
  }
  throw new Error('could not generate level ' + JSON.stringify(cfg));
}

function generateGame(seed) {
  const rng = mulberry32(seed >>> 0);
  return { seed, levels: S.LEVELS.map((cfg) => generateLevel(cfg, rng)) };
}

module.exports = { generateGame, generateLevel, solvePar, mulberry32, POOL };
