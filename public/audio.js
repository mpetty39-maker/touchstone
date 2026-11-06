/* Synth sound engine. Every player gets their own "voice" (waveform + pitch),
 * so in a room full of phones you can hear WHO just did something. */
window.TSAudio = (function () {
  'use strict';
  var ctx = null, master = null, mode = 'all';           // all | mine | off
  try { mode = localStorage.getItem('ts_sound') || 'all'; } catch (e) {}

  // root = MIDI note. Spread across the range so neighbours sound different.
  var VOICES = [
    { w: 'sine',     root: 72 },
    { w: 'triangle', root: 64 },
    { w: 'square',   root: 67, lp: 1800 },
    { w: 'sawtooth', root: 62, lp: 1400 },
    { w: 'sine',     root: 69 },
    { w: 'triangle', root: 60 },
    { w: 'square',   root: 74, lp: 1500 },
    { w: 'sawtooth', root: 65, lp: 1200 }
  ];
  var mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };

  function init() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone(wave, midiOrHz, t0, dur, vol, lp, isHz) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = wave;
    o.frequency.value = isHz ? midiOrHz : mtof(midiOrHz);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    if (lp) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); f.connect(g); }
    else o.connect(g);
    g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function seq(voice, notes, step, dur, vol, tail) {
    var v = VOICES[voice % VOICES.length], t = ctx.currentTime + 0.02;
    notes.forEach(function (n, i) {
      tone(v.w, v.root + n, t + i * step, i === notes.length - 1 && tail ? tail : dur, vol, v.lp);
    });
  }

  // kind: levelDone | finish | restart | passed | overtake | select | apply | beep | go | test
  // own: true if this player caused it.
  function play(kind, voice, own, extra) {
    if (mode === 'off') return;
    if (!own && mode === 'mine' && kind !== 'passed') return;
    init(); if (!ctx) return;
    voice = voice || 0; extra = extra || 0;
    var v = VOICES[voice % VOICES.length], vol = own ? 0.2 : 0.13, t = ctx.currentTime + 0.02;
    switch (kind) {
      case 'levelDone':
      case 'test':
        seq(voice, extra === 1 ? [0, 4, 7, 12, 16] : [0, 4, 7, 12], 0.085, 0.22, vol, 0.45); break;
      case 'finish':
        seq(voice, [0, 4, 7, 12, 7, 12, 16, 19], 0.1, 0.3, vol * 1.1, 0.9); break;
      case 'restart':                       // a sagging two-note drop in that player's voice
        seq(voice, [5, -2], 0.13, 0.28, vol * 0.9, 0.4); break;
      case 'passed':                        // you were overtaken: low, a bit sour
        tone('sawtooth', 110, t, 0.22, 0.12, 700, true);
        tone('sawtooth', 82.4, t + 0.16, 0.4, 0.12, 600, true); break;
      case 'overtake':                      // you passed someone: quick upward sweep
        [0, 2, 4, 7, 11].forEach(function (n, i) { tone(v.w, v.root + 12 + n, t + 0.5 + i * 0.045, 0.14, 0.1, v.lp); }); break;
      case 'select':
        tone('sine', 88 + (extra % 5), t, 0.07, 0.07); break;
      case 'apply':
        tone('triangle', 55 + extra * 3, t, 0.16, 0.12); tone('sine', 67 + extra * 3, t + 0.03, 0.12, 0.07); break;
      case 'beep':
        tone('sine', 660, t, 0.18, 0.18, 0, true); break;
      case 'go':
        tone('sine', 990, t, 0.5, 0.2, 0, true); break;
    }
  }

  return {
    init: init, play: play,
    getMode: function () { return mode; },
    cycleMode: function () {
      mode = mode === 'all' ? 'mine' : mode === 'mine' ? 'off' : 'all';
      try { localStorage.setItem('ts_sound', mode); } catch (e) {}
      return mode;
    }
  };
})();
