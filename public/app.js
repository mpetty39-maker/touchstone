(function () {
  'use strict';
  var S = window.Shared, A = window.TSAudio;
  var $ = function (id) { return document.getElementById(id); };
  var GLYPHS = ['●', '▲', '■', '◆', '★', '✚', '⬢', '♥'];
  var COLORS = ['#ff6b8b', '#ffb347', '#ffe066', '#6ee7a0', '#4dd8ff', '#8aa2ff', '#c78bff', '#ff8fe0'];
  var NUM_LEVELS = S.LEVELS.length;

  var ws = null, wsReady = false, queue = [], retry = 0;
  var me = null;            // my player id
  var room = null;          // last 'room' message
  var session = load('ts_session');
  var offset = 0;           // serverTime - Date.now()
  var G = null;             // local game state
  var screenName = 'home';

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function clear(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function serverNow() { return Date.now() + offset; }
  function fmt(ms) {
    if (ms == null) return '–';
    var s = Math.max(0, ms) / 1000, m = Math.floor(s / 60);
    return m + ':' + (s - m * 60 < 10 ? '0' : '') + (s - m * 60).toFixed(1);
  }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function player(id) { return room && room.players.filter(function (p) { return p.id === id; })[0]; }
  function mine() { return player(me); }

  // ---------- socket ----------
  function connect() {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host);
    ws.onopen = function () {
      wsReady = true; retry = 0; $('conn').classList.add('hidden');
      syncClock();
      if (session && !me) send({ t: 'rejoin', code: session.code, token: session.token });
      else if (session && me) send({ t: 'rejoin', code: session.code, token: session.token });
      while (queue.length) ws.send(JSON.stringify(queue.shift()));
    };
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    ws.onclose = function () {
      wsReady = false;
      if (session || screenName !== 'home') $('conn').classList.remove('hidden');
      setTimeout(connect, Math.min(4000, 600 + retry++ * 500));
    };
  }
  function send(m) { if (wsReady) ws.send(JSON.stringify(m)); else queue.push(m); }
  var pings = [];
  function syncClock() {
    pings = [];
    for (var i = 0; i < 4; i++) setTimeout(function (i) { return function () { if (wsReady) ws.send(JSON.stringify({ t: 'ping', c: Date.now() })); }; }(i), i * 150);
  }

  function onMsg(m) {
    switch (m.t) {
      case 'pong': {
        var now = Date.now(), rtt = now - m.c;
        pings.push({ rtt: rtt, off: m.serverNow + rtt / 2 - now });
        pings.sort(function (a, b) { return a.rtt - b.rtt; });
        offset = pings[0].off; break;
      }
      case 'welcome':
        me = m.pid; session = { code: m.code, token: m.token }; save('ts_session', session); break;
      case 'error':
        if (m.fatal) { session = null; me = null; clear('ts_session'); show('home'); }
        $('homeErr').textContent = m.msg; break;
      case 'room': onRoom(m); break;
      case 'start': onStart(m); break;
      case 'resync': onResync(m); break;
      case 'ev': onEvent(m); break;
      case 'results': onResultsMsg(m); break;
    }
  }

  // ---------- screens ----------
  function show(name) {
    screenName = name;
    ['home', 'lobby', 'game', 'results'].forEach(function (s) { $(s).classList.toggle('hidden', s !== name); });
    window.scrollTo(0, 0);
  }

  function onRoom(m) {
    room = m;
    if (m.state === 'lobby') {
      G = null; $('countdown').classList.add('hidden');
      show('lobby'); renderLobby();
    } else if (m.state === 'results') {
      if (screenName !== 'game') showResults();         // joined late or reconnected; otherwise onResultsMsg plays the ending
    } else if (m.state === 'racing') {
      renderStrip();
    }
  }
  // Race over: say why, let a level celebration finish, then show the standings.
  function onResultsMsg(m) {
    if (screenName !== 'game' || !G) return;
    G.over = true; G.running = false; G.selected = null;
    var w = m.reason === 'finish' && m.winners[0] ? player(m.winners[0]) : null;
    if (m.reason !== 'finish') A.play('timeup', 0, true);      // a full clear already played its fanfare
    if (m.reason === 'finish') banner((w && w.id === me ? 'You' : (w ? w.name : 'Someone')) + ' cleared all five!', '');
    else banner(m.reason === 'time' ? "Time's up!" : 'Race ended', 'Counting up the progress');
    setTimeout(function () { if (screenName === 'game') showResults(); }, G.locked ? 1500 : 1700);
  }

  function dotHtml(v) { return '<span class="dot c' + v + '" aria-hidden="true">' + GLYPHS[v] + '</span>'; }

  // ---------- lobby ----------
  function renderLobby() {
    $('lobbyCode').textContent = room.code;
    $('pCount').textContent = room.players.length + '/8';
    $('lobbyList').innerHTML = room.players.map(function (p) {
      return '<li class="' + (p.connected ? '' : 'off') + '">' + dotHtml(p.voice) + esc(p.name) +
        (p.id === me ? ' (you)' : '') + (p.host ? '<span class="tagpill">Host</span>' : '') + '</li>';
    }).join('');
    var host = room.hostId === me;
    renderLength(host);
    $('startBtn').classList.toggle('hidden', !host);
    $('waitHost').classList.toggle('hidden', host);
  }

  var LENGTHS = [2, 5, 10, 15];
  function renderLength(host) {
    $('lenPick').innerHTML = LENGTHS.map(function (m) {
      return '<button class="seg-b' + (m === room.minutes ? ' on' : '') + '" data-m="' + m + '"' + (host ? '' : ' disabled') + '>' + m + ' min</button>';
    }).join('');
    $('lenNote').textContent = host ? 'First to clear all five levels wins. If time runs out, the farthest along wins.' : 'The host picks the race length.';
  }

  // ---------- game ----------
  function onStart(m) {
    if (!pings.length) offset = m.serverNow - Date.now();   // otherwise keep the ping-based estimate
    G = { game: m.game, level: 0, board: null, phase: 0, selected: null, startAt: m.startAt, endAt: m.endAt, warned: false,
      running: false, locked: false, finished: false, taps: 0, cdShown: null, levelStart: m.startAt, rejoin: !!m.rejoin };
    initLevel();
    show('game');
    $('soundBtn').textContent = soundIcon();
    requestAnimationFrame(loop);
  }
  function onResync(m) {
    if (!G) return;
    G.level = m.level; G.phase = m.phase; G.selected = null; G.locked = false;
    if (m.level >= NUM_LEVELS) { G.finished = true; showResults(); return; }
    G.board = m.board.slice(); buildBoard(); renderShapes(); updateBoard();
  }
  function initLevel() {
    var lv = G.game.levels[G.level];
    G.board = lv.start.slice(); G.phase = 0; G.selected = null; G.taps = 0; G.locked = false;
    G.levelStart = Math.max(serverNow(), G.startAt);
    $('lvlNum').textContent = 'Level ' + (G.level + 1) + ' of ' + NUM_LEVELS;
    $('lvlSize').textContent = lv.n + '×' + lv.n + ' grid';
    buildBoard(); renderShapes(); updateBoard(); renderStrip();
    setHint('Tap a gem to preview, tap it again to place the shape.');
  }
  function buildBoard() {
    var lv = G.game.levels[G.level], b = $('board');
    b.className = 'board'; b.style.setProperty('--n', lv.n);
    var h = '';
    for (var i = 0; i < lv.n * lv.n; i++) h += '<button class="cell" data-i="' + i + '" style="--d:' + (i % lv.n + ((i / lv.n) | 0)) + '" aria-label="Gem ' + (i + 1) + '"><span class="gem"></span></button>';
    b.innerHTML = h;
  }
  function updateBoard(flipped) {
    var lv = G.game.levels[G.level], cells = $('board').children;
    var pv = {};
    if (G.selected != null && !G.locked) S.patternCells(lv.n, lv.shapes[G.phase], G.selected).forEach(function (i) { pv[i] = 1; });
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i].classList;
      c.toggle('on', !!G.board[i]); c.toggle('sel', G.selected === i); c.toggle('pv', !!pv[i]);
      if (flipped && flipped.indexOf(i) >= 0) { c.remove('flip'); void cells[i].offsetWidth; c.add('flip'); }
    }
  }
  function shapeSvg(shape) {
    var xs = shape.cells.map(function (c) { return c[0]; }), ys = shape.cells.map(function (c) { return c[1]; });
    var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys), w = Math.max.apply(null, xs) - x0 + 1, h = Math.max.apply(null, ys) - y0 + 1;
    var u = 14, g = 3, pad = 2, out = '<svg viewBox="0 0 ' + (w * u + pad * 2) + ' ' + (h * u + pad * 2) + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';
    shape.cells.forEach(function (c) {
      var x = (c[0] - x0) * u + pad, y = (c[1] - y0) * u + pad, t = c[0] === 0 && c[1] === 0;
      out += '<rect x="' + (x + g / 2) + '" y="' + (y + g / 2) + '" width="' + (u - g) + '" height="' + (u - g) + '" rx="2.5" fill="' + (t ? '#f2c14e' : '#9aa3c7') + '"/>';
      if (t) out += '<circle cx="' + (x + u / 2) + '" cy="' + (y + u / 2) + '" r="3.2" fill="none" stroke="#1a2260" stroke-width="1.6"/>';
    });
    return out + '</svg>';
  }
  function renderShapes() {
    var lv = G.game.levels[G.level];
    $('shapes').innerHTML = lv.shapes.map(function (s, i) {
      return '<div class="shape' + (i === G.phase ? ' active' : '') + '" role="img" aria-label="Shape ' + (i + 1) + (i === G.phase ? ' (next)' : '') + '"><span class="ord">' + (i + 1) + '</span>' + shapeSvg(s) + '</div>';
    }).join('');
  }
  var hintTimer;
  function setHint(t, flash) { $('hint').textContent = t; if (flash) { clearTimeout(hintTimer); hintTimer = setTimeout(function () { setHint(G && G.selected != null ? 'Tap it again to place the shape.' : 'Tap a gem to preview, tap it again to place the shape.'); }, 1800); } }

  function inPlay() { return G && G.running && !G.locked && !G.finished && serverNow() < G.endAt; }
  function onCell(i) {
    if (!inPlay()) return;
    if (G.selected === i) return place(i);              // second tap on the same gem places the shape
    G.selected = i;
    A.play('select', 0, true, i);
    setHint('Tap it again to place the shape.');
    updateBoard();
  }
  function place(cell) {
    var lv = G.game.levels[G.level], shape = lv.shapes[G.phase];
    var cells = S.patternCells(lv.n, shape, cell);
    S.applyMove(G.board, lv.n, shape, cell);
    send({ t: 'tap', level: G.level, cell: cell });
    G.taps++; A.play('apply', 0, true, G.phase);
    G.phase = (G.phase + 1) % lv.shapes.length; G.selected = null;
    renderShapes(); updateBoard(cells);
    if (S.isSolved(G.board)) onSolved(); else setHint('Tap a gem to preview, tap it again to place the shape.');
  }
  function onSolved() {
    G.locked = true;
    var lv = G.game.levels[G.level], last = G.level === NUM_LEVELS - 1, ms = serverNow() - G.levelStart;
    var p = mine(), v = p ? p.voice : 0;
    $('board').classList.add('win');
    A.play(last ? 'finish' : 'levelDone', v, true);
    banner(last ? 'All clear!' : 'Level ' + (G.level + 1) + ' clear', fmt(ms) + ' · ' + G.taps + ' taps (best possible ' + lv.par + ')');
    setTimeout(function () {
      if (!G) return;
      if (last) { G.finished = true; }                      // the server ends the race and sends results
      else { G.level++; initLevel(); }
    }, 1250);
  }
  function banner(t, sub) {
    var b = $('banner'); b.classList.add('hidden'); void b.offsetWidth;
    b.innerHTML = esc(t) + '<small>' + esc(sub || '') + '</small>'; b.classList.remove('hidden');
    clearTimeout(banner.t); banner.t = setTimeout(function () { b.classList.add('hidden'); }, 1150);
  }

  // ---------- clock / countdown ----------
  function fmtRem(ms) { var s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60); return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function loop() {
    if (!G || screenName === 'lobby' || screenName === 'home' || screenName === 'results') return;
    var d = G.startAt - serverNow(), cd = $('countdown'), clock = $('clock');
    if (d > 0) {
      var n = Math.ceil(d / 1000);
      cd.classList.remove('hidden');
      if (G.cdShown !== n) { G.cdShown = n; cd.innerHTML = '<span>' + n + '</span>'; A.play('beep', 0, true); }
      clock.textContent = fmtRem(G.endAt - G.startAt); clock.classList.remove('low');
    } else {
      if (!G.running && !G.over) {
        G.running = true; G.cdShown = 0; cd.innerHTML = '<span>Go!</span>'; A.play('go', 0, true);
        setTimeout(function () { cd.classList.add('hidden'); }, 550);
      }
      var rem = G.endAt - serverNow();
      clock.textContent = fmtRem(rem);
      clock.classList.toggle('low', rem <= 30000);
      if (rem <= 10000 && rem > 0 && !G.warned) { G.warned = true; toast('10 seconds left'); }
    }
    requestAnimationFrame(loop);
  }

  // ---------- standings ----------
  function totalMs(p) { return p.levelMs.reduce(function (a, b) { return a + b; }, 0); }
  function ranked() {
    return room.players.slice().sort(function (a, b) {
      var fa = a.finishMs != null, fb = b.finishMs != null;
      if (fa && fb) return a.finishMs - b.finishMs;
      if (fa !== fb) return fa ? -1 : 1;
      return b.done - a.done || totalMs(a) - totalMs(b);
    });
  }
  function renderStrip() {
    if (!room) return;
    $('strip').innerHTML = ranked().map(function (p) {
      var pips = ''; for (var i = 0; i < NUM_LEVELS; i++) pips += '<b class="' + (i < p.done ? 'f' : '') + '"></b>';
      return '<div class="chip' + (p.id === me ? ' me' : '') + (p.connected ? '' : ' off') + '" data-p="' + p.id + '">' + dotHtml(p.voice) +
        '<span class="nm">' + esc(p.name) + '</span><span class="pips">' + pips + '</span></div>';
    }).join('');
  }
  function chipFx(pid, cls) {
    var el = document.querySelector('.chip[data-p="' + pid + '"]'); if (!el) return;
    el.classList.remove('pulse', 'slip'); void el.offsetWidth; el.classList.add(cls);
  }
  function toast(text, voice) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    if (voice != null) t.style.setProperty('--c', COLORS[voice % 8]);
    var inGame = screenName === 'game', box = inGame ? $('ticker') : $('toasts');
    if (inGame) box.innerHTML = '';              // one line at a time, under the top bar
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 350); }, 2300);
  }

  // ---------- events from the server ----------
  function onEvent(m) {
    var p = player(m.pid), name = p ? p.name : 'Someone', v = p ? p.voice : 0, self = m.pid === me;
    if (m.kind === 'levelDone') {
      if (!self) { A.play('levelDone', v, false, m.place === 1 ? 1 : 0); toast(name + ' cleared level ' + (m.level + 1) + (m.place === 1 ? ' first!' : ''), v); }
      else if (m.passed.length) setTimeout(function () { A.play('overtake', v, true); }, 0);
      chipFx(m.pid, 'pulse');
    } else if (m.kind === 'finish') {
      if (!self) { A.play('finish', v, false); toast(name + ' finished ' + ord(m.place) + '!', v); }
      chipFx(m.pid, 'pulse');
    } else if (m.kind === 'restart') {
      if (!self) { A.play('restart', v, false); toast(name + ' restarted', v); }
      chipFx(m.pid, 'slip');
    }
    if (!self && m.passed && m.passed.indexOf(me) >= 0) {
      setTimeout(function () { A.play('passed', 0, true); toast(name + ' passed you', v); }, 500);
    }
  }

  // ---------- results ----------
  function showResults() {
    show('results'); $('countdown').classList.add('hidden'); renderResults();
  }
  function renderResults() {
    if (!room || !room.final) return;
    var f = room.final, st = f.standings;
    var winners = f.winners.map(player).filter(Boolean), names = winners.map(function (p) { return p.name; });
    var iWon = f.winners.indexOf(me) >= 0;
    if (f.reason === 'finish') {
      $('resTitle').textContent = iWon ? 'You win!' : names[0] + ' wins!';
      $('resSub').textContent = 'Cleared all five levels in ' + fmt(st[0].finishMs) + '.';
    } else if (winners.length > 1) {
      $('resTitle').textContent = iWon ? 'You tied for first!' : 'A tie for first';
      $('resSub').textContent = names.join(' and ') + ' are level.';
    } else {
      $('resTitle').textContent = iWon ? 'You win!' : names[0] + ' wins!';
      $('resSub').textContent = f.reason === 'time' ? 'Time ran out. Farthest along wins.' : 'The host ended the race.';
    }
    var head = '<tr><th></th><th></th>'; for (var i = 1; i <= NUM_LEVELS; i++) head += '<th>L' + i + '</th>'; head += '<th>Result</th></tr>';
    var best = []; for (var l = 0; l < NUM_LEVELS; l++) { var vals = room.players.map(function (p) { return p.levelMs[l]; }).filter(function (x) { return x != null; }); best[l] = vals.length ? Math.min.apply(null, vals) : null; }
    var rows = st.map(function (r) {
      var p = player(r.id); if (!p) return '';
      var tied = st.filter(function (o) { return o.rank === r.rank; }).length > 1;
      var td = ''; for (var i = 0; i < NUM_LEVELS; i++) { var x = p.levelMs[i]; td += '<td class="' + (x != null && x === best[i] ? 'best' : '') + '">' + (x != null ? (x / 1000).toFixed(1) : '–') + '</td>'; }
      var res = r.finishMs != null ? fmt(r.finishMs) : r.done + ' cleared<small>' + r.lit + '/' + r.cells + ' lit</small>';
      return '<tr class="' + (r.id === me ? 'me' : '') + '"><td>' + r.rank + (tied ? '=' : '') + '</td><td><div class="who">' + dotHtml(p.voice) + '<span class="nm2">' + esc(p.name) + '</span></div></td>' + td + '<td class="tot">' + res + '</td></tr>';
    }).join('');
    $('resTable').innerHTML = head + rows;
    var host = room.hostId === me;
    $('againBtn').classList.toggle('hidden', !host);
    $('endBtn').classList.add('hidden');
    $('resWait').classList.toggle('hidden', host);
    $('resWait').textContent = 'Waiting for the host to start another race…';
  }

  // ---------- wiring ----------
  function name() {
    var n = $('nameIn').value.trim(); if (!n) { $('homeErr').textContent = 'Enter your name first.'; $('nameIn').focus(); return null; }
    try { localStorage.setItem('ts_name', n); } catch (e) {} return n;
  }
  $('createBtn').onclick = function () { A.init(); var n = name(); if (!n) return; $('homeErr').textContent = ''; send({ t: 'create', name: n }); };
  $('joinBtn').onclick = function () {
    A.init(); var n = name(); if (!n) return;
    var c = $('codeIn').value.trim().toUpperCase();
    if (c.length !== 4) { $('homeErr').textContent = 'Codes have 4 letters.'; $('codeIn').focus(); return; }
    $('homeErr').textContent = ''; send({ t: 'join', code: c, name: n });
  };
  $('codeIn').oninput = function () { this.value = this.value.toUpperCase().replace(/[^A-Z]/g, ''); };
  $('codeIn').onkeydown = function (e) { if (e.key === 'Enter') $('joinBtn').click(); };
  $('nameIn').onkeydown = function (e) { if (e.key === 'Enter') ($('codeIn').value ? $('joinBtn') : $('createBtn')).click(); };
  $('startBtn').onclick = function () { A.init(); send({ t: 'start' }); };
  $('testSnd').onclick = function () { A.init(); var p = mine(); A.play('test', p ? p.voice : 0, true); };
  $('shareBtn').onclick = function () {
    var url = location.origin + '/?code=' + room.code, b = $('shareBtn');
    if (navigator.share) { navigator.share({ title: 'Touchstone Race', text: 'Join my Touchstone race', url: url }).catch(function () {}); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { b.textContent = 'Copied!'; }, function () { b.textContent = url; });
    setTimeout(function () { b.textContent = 'Copy invite link'; }, 2000);
  };
  function leave() { send({ t: 'leave' }); session = null; me = null; room = null; G = null; clear('ts_session'); show('home'); }
  $('leaveLobby').onclick = leave; $('leaveRes').onclick = leave;
  $('againBtn').onclick = function () { send({ t: 'again' }); };
  $('endBtn').onclick = function () { if (confirm('End the race for everyone?')) send({ t: 'end' }); };
  $('restartBtn').onclick = function () {
    if (!G || !G.running || G.locked || G.finished) return;
    send({ t: 'restart' }); var p = mine();
    A.play('restart', p ? p.voice : 0, true);
    var lv = G.game.levels[G.level]; G.board = lv.start.slice(); G.phase = 0; G.selected = null; G.taps = 0;
    renderShapes(); updateBoard(); setHint('Level restarted. The clock keeps running.', true);
  };
  function soundIcon() { return { all: '🔊', mine: '🔉', off: '🔇' }[A.getMode()]; }
  var soundLabel = { all: 'Sound: everyone', mine: 'Sound: just mine', off: 'Sound: off' };
  $('soundBtn').onclick = function () { A.init(); var m = A.cycleMode(); this.textContent = soundIcon(); toast(soundLabel[m]); };
  $('board').addEventListener('pointerdown', function (e) {
    var c = e.target.closest('.cell'); if (c) { e.preventDefault(); onCell(+c.dataset.i); }
  });
  $('lenPick').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-b'); if (b && !b.disabled) send({ t: 'config', minutes: +b.dataset.m });
  });

  // prefill from storage / invite link
  var qs = new URLSearchParams(location.search);
  $('nameIn').value = (function () { try { return localStorage.getItem('ts_name') || ''; } catch (e) { return ''; } })();
  if (qs.get('code')) { $('codeIn').value = qs.get('code').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); if (!$('nameIn').value) $('nameIn').focus(); }
  window.__ts = { get G() { return G; }, get room() { return room; }, onCell: onCell };
  connect();
})();
