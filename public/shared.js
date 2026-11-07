/* Shared game rules: used by the browser AND the server (so both agree). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Base polyominoes as [x, y] cells. Rotations are generated below.
  var BASES = {
    I3: [[0,0],[1,0],[2,0]],
    L3: [[0,0],[1,0],[0,1]],
    I4: [[0,0],[1,0],[2,0],[3,0]],
    O4: [[0,0],[1,0],[0,1],[1,1]],
    T4: [[0,0],[1,0],[2,0],[1,1]],
    S4: [[1,0],[2,0],[0,1],[1,1]],
    Z4: [[0,0],[1,0],[1,1],[2,1]],
    L4: [[0,0],[0,1],[0,2],[1,2]],
    J4: [[1,0],[1,1],[1,2],[0,2]],
    P5: [[0,0],[1,0],[0,1],[1,1],[0,2]],
    X5: [[1,0],[0,1],[1,1],[2,1],[1,2]],
    T5: [[0,0],[1,0],[2,0],[1,1],[1,2]],
    U5: [[0,0],[2,0],[0,1],[1,1],[2,1]],
    W5: [[0,0],[0,1],[1,1],[1,2],[2,2]],
    L5: [[0,0],[0,1],[0,2],[0,3],[1,3]]
  };

  // Five levels: three 4x4 boards, then two 5x5. "par" = fewest taps that can solve it.
  var LEVELS = [
    { n: 4, k: 3, minSize: 3, maxSize: 4, parMin: 3, parMax: 4 },
    { n: 4, k: 3, minSize: 3, maxSize: 4, parMin: 4, parMax: 5 },
    { n: 4, k: 3, minSize: 3, maxSize: 5, parMin: 5, parMax: 6 },
    { n: 5, k: 4, minSize: 3, maxSize: 5, parMin: 5, parMax: 6 },
    { n: 5, k: 4, minSize: 3, maxSize: 5, parMin: 6, parMax: 7 }
  ];

  function norm(cells) {
    var mx = Infinity, my = Infinity;
    cells.forEach(function (c) { mx = Math.min(mx, c[0]); my = Math.min(my, c[1]); });
    return cells.map(function (c) { return [c[0] - mx, c[1] - my]; })
      .sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
  }
  function rotations(cells) {
    var out = [], seen = {}, cur = cells;
    for (var i = 0; i < 4; i++) {
      cur = norm(cur.map(function (c) { return [-c[1], c[0]]; }));
      var key = JSON.stringify(cur);
      if (!seen[key]) { seen[key] = 1; out.push(cur); }
    }
    return out;
  }
  // Every (orientation, touchstone cell) combination, keyed by name.
  function buildPool() {
    var pool = [];
    Object.keys(BASES).forEach(function (name) {
      rotations(BASES[name]).forEach(function (cells, ri) {
        cells.forEach(function (t, ti) {
          pool.push({
            id: name + '.' + ri + '.' + ti,
            size: cells.length,
            cells: cells.map(function (c) { return [c[0] - t[0], c[1] - t[1]]; })
          });
        });
      });
    });
    return pool;
  }

  // Cells (as indices) toggled when `shape` is applied with its touchstone on `anchor`.
  // Cells that fall off the board are ignored.
  function patternCells(n, shape, anchor) {
    var ax = anchor % n, ay = (anchor / n) | 0, out = [];
    for (var i = 0; i < shape.cells.length; i++) {
      var x = ax + shape.cells[i][0], y = ay + shape.cells[i][1];
      if (x >= 0 && x < n && y >= 0 && y < n) out.push(y * n + x);
    }
    return out;
  }
  function applyMove(board, n, shape, anchor) {
    patternCells(n, shape, anchor).forEach(function (i) { board[i] ^= 1; });
    return board;
  }
  function isSolved(board) {
    for (var i = 0; i < board.length; i++) if (!board[i]) return false;
    return true;
  }

  return { BASES: BASES, LEVELS: LEVELS, buildPool: buildPool, patternCells: patternCells,
           applyMove: applyMove, isSolved: isSolved };
});
