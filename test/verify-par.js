// Independent brute-force check of the par solver on 4x4 levels, plus "stuck" analysis.
const S = require('../public/shared.js');
const { generateLevel, mulberry32 } = require('../puzzle');
const cfgs = [S.LEVELS[0], S.LEVELS[1]];
let checked = 0, mismatches = 0, stuckStates = 0, reachableStates = 0, levelsWithStuck = 0;
for (let seed = 1; seed <= 40; seed++) {
  const rng = mulberry32(seed);
  const cfg = cfgs[seed % 2];
  const lv = generateLevel(cfg, rng);
  const n = lv.n, k = lv.shapes.length, cells = n * n;
  const toInt = (b) => b.reduce((a, v, i) => a | (v << i), 0);
  const startI = toInt(lv.start), full = (1 << cells) - 1;
  const mv = lv.shapes.map(s => Array.from({ length: cells }, (_, a) => S.patternCells(n, s, a).reduce((m, i) => m | (1 << i), 0)));
  // BFS forward from start over (board, phase)
  const dist = new Map(); const key = (b, p) => b * 8 + p;
  let frontier = [[startI, 0]]; dist.set(key(startI, 0), 0);
  let best = -1;
  if (startI === full) best = 0;
  const reach = [];
  while (frontier.length) {
    const next = [];
    for (const [b, p] of frontier) {
      reach.push([b, p]);
      const d = dist.get(key(b, p));
      for (let a = 0; a < cells; a++) {
        const nb = b ^ mv[p][a], np = (p + 1) % k, kk = key(nb, np);
        if (!dist.has(kk)) { dist.set(kk, d + 1); if (nb === full && best < 0) best = d + 1; next.push([nb, np]); }
      }
    }
    frontier = next;
  }
  checked++; if (best !== lv.par) { mismatches++; console.log('MISMATCH seed', seed, 'bfs', best, 'solver', lv.par); }
  // stuck analysis: reverse reachability to "solved" among reachable states
  const canSolve = new Set();
  for (let p = 0; p < k; p++) canSolve.add(key(full, p));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [b, p] of reach) {
      const kk = key(b, p); if (canSolve.has(kk)) continue;
      for (let a = 0; a < cells; a++) {
        if (canSolve.has(key(b ^ mv[p][a], (p + 1) % k))) { canSolve.add(kk); changed = true; break; }
      }
    }
  }
  const stuck = reach.filter(([b, p]) => !canSolve.has(key(b, p))).length;
  reachableStates += reach.length; stuckStates += stuck; if (stuck) levelsWithStuck++;
}
console.log({ checked, mismatches, reachableStates, stuckStates, levelsWithStuck });
