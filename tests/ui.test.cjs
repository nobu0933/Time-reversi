const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const R = require('../src/game/rules.js');
const Replay = require('../src/game/replay.js');

// A small DOM and virtual clock exercise UI scheduling without a browser or network.
function app(initial = R.createGame(), chooseMove = () => Promise.reject(new Error('No PRO test model'))) {
  class Element {
    constructor() {
      this.children = []; this.attrs = {}; this.events = {}; this.hidden = false;
      const properties = new Map();
      this.style = { setProperty(key, value) { properties.set(key, value); }, removeProperty(key) { properties.delete(key); },
        getPropertyValue(key) { return properties.get(key) || ''; } };
      const classes = new Set();
      this.classList = { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)),
        toggle: (v, enabled) => enabled ? classes.add(v) : classes.delete(v),
        contains: v => classes.has(v) || Boolean(this.className?.split(/\s+/).includes(v)) };
    }
    set innerHTML(value) { this.children = [new Element()]; this.children[0].className = 'body'; }
    setAttribute(key, value) { this.attrs[key] = value; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) { return this.children.find(x => x.className === selector.slice(1)) || this.children[0]; }
    querySelectorAll() { return []; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    emit(type, event = {}) { return (this.events[type] || []).map(fn => fn({ detail: 0, stopPropagation() {}, ...event })); }
    showModal() { this.open = true; }
    close(value) { this.returnValue = value; this.open = false; this.emit('close'); }
  }
  const ids = Object.fromEntries(['cells','log','cpu-thinking','new-game','new-game-button','record-dialog','record-text','copy-record','record-import','replay-import','record-import-error','pass-overlay','bgm','replay','time-clock','title','cpu-white','cpu-black','cpu-label-white','cpu-label-black','white-count','black-count'].map(id => [id, new Element()]));
  ids.bgm.append(new Element()); ids.replay.append(new Element()); ids['pass-overlay'].hidden = true; ids.replay.hidden = true; ids['record-import-error'].hidden = true; ids['cpu-thinking'].hidden = true; ids['cpu-label-black'].hidden = true;
  const documentEvents = {};
  const document = { querySelector: selector => ids[selector.slice(1)], createElement: () => new Element(), body: new Element(), documentElement: new Element(),
    elementFromPoint: () => null,
    addEventListener(type, fn) { (documentEvents[type] ||= []).push(fn); },
    emit(type, event = {}) { for (const fn of documentEvents[type] || []) fn({ preventDefault() {}, ...event }); } };
  let now = 0, next = 0; const timers = new Map();
  let copied;
  const sounds = [];
  const music = [];
  let bgmAudio;
  class Audio {
    constructor(src) { this.src = src; this.paused = true; this.events = {}; if (src.includes('_orgel')) bgmAudio = this; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    emit(type) { for (const fn of this.events[type] || []) fn(); }
    play() { this.paused = false; (this === bgmAudio ? music : sounds).push(this.src); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const context = { window: { Reversi: { ...R, createGame: () => Replay.snapshot(initial) }, ReplayTimeline: Replay, ProAI: { choose: chooseMove }, addEventListener() {} }, document,
    navigator: { clipboard: { async writeText(text) { copied = text; } } },
    matchMedia: () => ({ matches: false }), setTimeout: (fn, ms) => { timers.set(++next, { fn, at: now + ms }); return next; }, clearTimeout: id => timers.delete(id), console,
    AbortController, Audio };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/ui/game.js'), 'utf8'), context);
  async function tick(ms) {
    const end = now + ms;
    for (let steps = 0; steps < 1000; steps++) {
      const entry = [...timers].sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
      for (let i = 0; i < 15; i++) await Promise.resolve();
    }
    now = end;
  }
  function buttonClick(element) {
    document.emit('click', { button: 0, detail: 0, target: { closest: selector => selector === 'button' ? element : null } });
    return element.emit('click');
  }
  return { ids, document, tick, sounds, music, bgmAudio, copied: () => copied, click: id => buttonClick(ids[id]), move: index => buttonClick(ids.cells.children[index]) };
}

test('controls click, placement stays silent, and flipped landing plays put', async () => {
  const ui = app();
  ui.click('title');
  assert.deepEqual(ui.sounds, ['assets/sounds/switch.mp3']);
  ui.ids['record-dialog'].close();
  ui.move(8);
  assert.deepEqual(ui.sounds, ['assets/sounds/switch.mp3']);
  await ui.tick(239);
  assert.deepEqual(ui.sounds, ['assets/sounds/switch.mp3']);
  await ui.tick(1);
  assert.deepEqual(ui.sounds, ['assets/sounds/switch.mp3']);
  await ui.tick(259);
  assert.equal(ui.sounds.length, 1);
  await ui.tick(1);
  assert.deepEqual(ui.sounds, ['assets/sounds/switch.mp3', 'assets/sounds/put.mp3']);
  ui.click('bgm');
  const count = ui.sounds.length;
  ui.click('title'); ui.ids['record-dialog'].close();
  await ui.tick(1200);
  assert.deepEqual(ui.sounds.slice(count), ['assets/sounds/switch.mp3', 'assets/sounds/put.mp3']);
  ui.click('bgm');
  assert.equal(ui.sounds.at(-1), 'assets/sounds/switch.mp3');
});

test('white CPU plays after black; BGM switches its supplied icon', async () => {
  const ui = app();
  assert.equal(ui.ids.log.textContent, "Black's turn");
  assert.equal(ui.ids['cpu-thinking'].hidden, true);
  ui.click('bgm'); assert.equal(ui.ids.bgm.children[0].src, 'assets/icon/bgm-off.svg');
  ui.click('bgm'); assert.equal(ui.ids.bgm.children[0].src, 'assets/icon/bgm-on.svg');
  ui.move(8); await ui.tick(500);
  assert.equal(ui.ids.log.textContent, "White's turn");
  assert.equal(ui.ids['cpu-thinking'].hidden, false);
  await ui.tick(1150);
  assert.equal(ui.ids.log.textContent, "Black's turn");
  assert.equal(ui.ids['cpu-thinking'].hidden, true);
});

test('CPU thinking pauses for the move record dialog and resumes on close', async () => {
  const ui = app();
  ui.move(8); await ui.tick(500);
  assert.equal(ui.ids['cpu-thinking'].hidden, false);
  ui.click('title');
  assert.equal(ui.ids['cpu-thinking'].hidden, true);
  ui.ids['record-dialog'].close();
  assert.equal(ui.ids['cpu-thinking'].hidden, false);
});

test('touch placement does not leave the next player cursor at the tapped position', async () => {
  const ui = app();
  ui.click('cpu-white'); ui.click('cpu-white'); ui.click('cpu-white');
  ui.document.emit('pointerdown', { pointerType: 'touch' });
  ui.ids.cells.children[8].emit('focus');
  ui.ids.cells.children[8].emit('click', { detail: 1, pointerType: 'touch' });
  await ui.tick(500);
  assert.equal(ui.ids.log.textContent, "White's turn");
  ui.document.emit('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 100 });
  assert.equal(ui.document.body.children[0].hidden, true);
});

test('both time directions shade stones by pending turns including passes', () => {
  const state = R.createGame();
  for (const [index, color, direction] of [[0, R.BLACK, 1], [1, R.WHITE, 1], [5, R.WHITE, -1]]) {
    state.board[index] = color; state.origins[index] = direction;
  }
  state.history[1] = [0, null, 1, null];
  state.history[-1] = [5, null, null];
  const ui = app(state);
  const cells = ui.ids.cells.children;
  assert.equal(cells.filter(cell => cell.classList.contains('nearest-time')).length, 0);
  assert.equal(cells[1].classList.contains('second-time'), true);
  assert.equal(cells[1].style.getPropertyValue('--time-strength'), '80.645%');
  assert.equal(cells[0].classList.contains('second-time'), false);
  assert.equal(cells[0].style.getPropertyValue('--time-strength'), '58.140%');
  assert.equal(cells[5].style.getPropertyValue('--time-strength'), '67.568%');

  const afterPass = R.invert(state).state;
  const afterUi = app(afterPass);
  assert.equal(afterUi.ids.cells.children[1].classList.contains('nearest-time'), true);
});

test('CPU cycles PLY, EZY, MID, PRO; MID uses the browser model', async () => {
  const requests = [];
  const ui = app(R.createGame(), (state, options) => {
    requests.push({ state, options });
    return Promise.resolve({ action: 8 });
  });
  assert.equal(ui.ids['cpu-label-black'].hidden, true);
  ui.click('cpu-black'); assert.equal(ui.ids['cpu-black'].textContent, 'EZY');
  assert.equal(ui.ids['cpu-label-black'].hidden, false);
  ui.click('cpu-black'); assert.equal(ui.ids['cpu-black'].textContent, 'MID');
  await ui.tick(350);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].state.player, R.BLACK);
  assert.equal(requests[0].options.mode, 'MID');
  await ui.tick(500);
  assert.match(ui.ids.cells.children[8].attrs['aria-label'], /Black/);
  ui.click('cpu-black'); assert.equal(ui.ids['cpu-black'].textContent, 'PRO');
  ui.click('cpu-black'); assert.equal(ui.ids['cpu-black'].textContent, 'PLY');
  assert.equal(ui.ids['cpu-label-black'].hidden, true);
});

test('PRO requests the trained browser model and plays a legal move', async () => {
  const requests = [];
  const ui = app(R.createGame(), (state, options) => {
    requests.push({ state, options });
    return Promise.resolve({ action: 8 });
  });
  ui.click('cpu-black'); ui.click('cpu-black'); ui.click('cpu-black');
  assert.equal(ui.ids['cpu-black'].textContent, 'PRO');
  await ui.tick(350);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.mode, 'PRO');
  await ui.tick(500);
  assert.match(ui.ids.cells.children[8].attrs['aria-label'], /Black/);
});

test('a MID response is discarded after changing CPU mode', async () => {
  let resolveRequest;
  const ui = app(R.createGame(), () => new Promise(resolve => { resolveRequest = resolve; }));
  ui.click('cpu-black'); ui.click('cpu-black');
  await ui.tick(350);
  assert.equal(ui.ids['cpu-thinking'].hidden, false);
  ui.click('cpu-black');
  assert.equal(ui.ids['cpu-thinking'].hidden, false);
  ui.click('cpu-black');
  assert.equal(ui.ids['cpu-thinking'].hidden, true);
  resolveRequest({ action: 8 });
  await ui.tick(500);
  assert.match(ui.ids.cells.children[8].attrs['aria-label'], /empty/);
});

test('new game during an animation cancels stale work and confirmation pauses CPU', async () => {
  const ui = app();
  ui.move(8); ui.click('new-game-button'); ui.ids['new-game'].close('yes');
  await ui.tick(2000);
  assert.equal(ui.ids.log.textContent, "Black's turn");
  assert.match(ui.ids.cells.children[8].attrs['aria-label'], /empty/);
  ui.click('cpu-black'); ui.click('new-game-button'); await ui.tick(2000);
  assert.match(ui.ids.cells.children[8].attrs['aria-label'], /empty/);
  ui.ids['new-game'].close('no'); await ui.tick(1150);
  assert.equal(ui.ids.log.textContent, "White's turn");
});

test('new game icon opens the same confirmation and resets only after Yes', async () => {
  const ui = app();
  ui.click('new-game-button');
  assert.equal(ui.ids['new-game'].open, true);
  ui.ids['new-game'].close('no');
  ui.move(8); await ui.tick(500);
  assert.match(ui.ids.cells.children[8].attrs['aria-label'], /Black/);
  ui.click('new-game-button');
  assert.equal(ui.ids['new-game'].open, true);
  ui.ids['new-game'].close('yes');
  await ui.tick(1000);
  assert.match(ui.ids.cells.children[8].attrs['aria-label'], /empty/);
  assert.equal(ui.ids.log.textContent, "Black's turn");
});

test('title shows coordinate notation and copies the full move record', async () => {
  const ui = app();
  ui.click('title');
  assert.equal(ui.ids['record-dialog'].open, true);
  assert.equal(ui.ids['new-game'].open, undefined);
  assert.equal(ui.ids['record-text'].textContent, 'No moves yet');
  ui.ids['record-dialog'].close();

  ui.click('cpu-white'); ui.click('cpu-white'); ui.click('cpu-white');
  ui.move(8); ui.click('title');
  assert.equal(ui.ids['record-text'].textContent, 'No moves yet');
  await ui.tick(500);
  assert.equal(ui.ids['record-text'].textContent, 'c2');
  ui.ids['record-dialog'].close();
  ui.move(7); await ui.tick(500);
  ui.click('title');
  assert.equal(ui.ids['record-text'].textContent, 'c2b2');
  await Promise.all(ui.click('copy-record'));
  assert.equal(ui.copied(), 'c2b2');
  assert.equal(ui.ids['copy-record'].textContent, 'Copied');
  ui.ids['record-dialog'].close();

  ui.click('new-game-button'); ui.ids['new-game'].close('yes');
  ui.click('title');
  assert.equal(ui.ids['record-text'].textContent, 'No moves yet');
});

test('automatic pass is written as ps in the move record', async () => {
  const state = R.createGame(); state.player = R.WHITE;
  state.board = Array(36).fill(R.BLACK);
  state.board[0] = state.board[30] = 0; state.board[1] = state.board[31] = R.WHITE;
  const ui = app(state);
  await ui.tick(1150);
  ui.click('title');
  assert.equal(ui.ids['record-text'].textContent, 'ps');
  await Promise.all(ui.click('copy-record'));
  assert.equal(ui.copied(), 'ps');
});

test('pasted record replays legal moves and rejects invalid input without changing the game', async () => {
  const ui = app();
  ui.click('cpu-white'); ui.click('cpu-white'); ui.click('cpu-white');
  ui.move(8); await ui.tick(500);
  ui.click('title');
  ui.ids['record-import'].value = 'pa';
  ui.click('replay-import');
  assert.equal(ui.ids['record-import-error'].hidden, false);
  assert.equal(ui.ids['record-import'].value, 'pa');
  assert.match(ui.ids['record-import-error'].textContent, /Invalid move 1/);
  assert.equal(ui.ids['record-dialog'].open, true);
  assert.match(ui.ids.cells.children[8].attrs['aria-label'], /Black/);
  ui.ids['record-import'].value = 'C2 B2';
  ui.ids['record-import'].emit('input');
  ui.click('replay-import');
  assert.equal(ui.ids['record-dialog'].open, false);
  assert.equal(ui.ids['record-import-error'].hidden, true);
  assert.equal(ui.ids['record-import'].value, '');
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Pause replay');
  await ui.tick(1500);
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Replay game');
  ui.click('title');
  assert.equal(ui.ids['record-text'].textContent, 'c2b2');
});

test('an unfinished imported replay resumes play and hides replay after a new stone', async () => {
  const ui = app();
  ui.click('cpu-white'); ui.click('cpu-white'); ui.click('cpu-white');
  ui.click('title');
  ui.ids['record-import'].value = 'c2b2';
  ui.click('replay-import');
  await ui.tick(1500);
  assert.equal(ui.ids.log.textContent, "Black's turn");
  assert.equal(ui.ids.replay.hidden, false);
  const state = R.advance(R.advance(R.createGame(), 8).state, 7).state;
  const next = R.moves(state.board, state.player)[0];
  ui.move(next);
  assert.equal(ui.ids.replay.hidden, true);
  await ui.tick(500);
  assert.equal(ui.ids.replay.hidden, true);
  ui.click('title');
  assert.equal(ui.ids['record-text'].textContent, `c2b2${String.fromCharCode(97 + next % 6)}${Math.floor(next / 6) + 1}`);
});

test('CPU waits for a board click after an unfinished imported replay', async () => {
  const ui = app();
  ui.click('title');
  ui.ids['record-import'].value = 'c2';
  ui.click('replay-import');
  await ui.tick(600);
  assert.equal(ui.ids.log.textContent, "White's turn");
  assert.equal(ui.ids.replay.hidden, false);
  await ui.tick(3000);
  assert.equal(ui.ids.log.textContent, "White's turn");
  assert.equal(ui.ids.replay.hidden, false);
  ui.move(0);
  await ui.tick(1200);
  assert.equal(ui.ids.log.textContent, "Black's turn");
  assert.equal(ui.ids.replay.hidden, true);
});

test('unfinished imported replay shows Replay again when resumed play ends the game', async () => {
  const path = [13,7,8,9,0,18,2,27,12,7,24];
  const record = path.slice(0, -1).map(index => `${String.fromCharCode(97 + index % 6)}${Math.floor(index / 6) + 1}`).join('');
  const ui = app();
  ui.click('title');
  ui.ids['record-import'].value = record;
  ui.click('replay-import');
  await ui.tick(10000);
  assert.equal(ui.ids.replay.hidden, false);
  ui.move(path.at(-1));
  await ui.tick(1200);
  assert.equal(ui.ids.log.textContent.includes('wins!'), true);
  assert.equal(ui.ids.replay.hidden, false);
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Replay game');
});

test('pasted record accepts a legal ps turn', async () => {
  const record = 'c2b2a2a1b3d2c1b2b1a1c2d1e1f1a2a3e2d1c2b1b2a1a4c1e4f1d2e1b3e3f2f3ps';
  const ui = app();
  ui.click('cpu-white'); ui.click('cpu-white'); ui.click('cpu-white');
  ui.click('title');
  ui.ids['record-import'].value = record;
  ui.click('replay-import');
  assert.equal(ui.ids['record-import-error'].hidden, true);
  await ui.tick(20000);
  ui.click('title');
  assert.equal(ui.ids['record-text'].textContent, record);
});

test('pass disc stays for 800 ms and disappears before the next turn', async () => {
  const state = R.createGame(); state.player = R.WHITE;
  state.board = Array(36).fill(R.BLACK);
  state.board[0] = state.board[30] = 0; state.board[1] = state.board[31] = R.WHITE;
  const ui = app(state);
  await ui.tick(349); assert.equal(ui.sounds.length, 0);
  await ui.tick(1); assert.equal(ui.ids['pass-overlay'].hidden, false);
  assert.deepEqual(ui.sounds, ['assets/sounds/pass.mp3']);
  await ui.tick(799); assert.equal(ui.ids['pass-overlay'].hidden, false);
  await ui.tick(1); assert.equal(ui.ids['pass-overlay'].hidden, true);
  assert.equal(ui.ids.log.textContent, "Black's turn");
});

test('corner inversion switches tint, pulses once, and announces inversion', async () => {
  const state = R.createGame(); state.board.fill(0);
  state.board[2] = state.board[14] = R.BLACK;
  state.board[1] = state.board[7] = R.WHITE;
  const ui = app(state); ui.move(0); await ui.tick(499);
  assert.deepEqual(ui.sounds, []);
  await ui.tick(1);
  assert.equal(ui.document.body.classList.contains('reverse-time'), true);
  assert.equal(ui.document.body.classList.contains('time-pulse'), true);
  assert.equal(ui.ids.log.textContent, 'Time reversal');
  assert.deepEqual(ui.sounds, ['assets/sounds/put.mp3', 'assets/sounds/time-reversal.wav']);
  await ui.tick(360); assert.equal(ui.document.body.classList.contains('time-pulse'), false);
  assert.equal(ui.sounds.at(-1), 'assets/sounds/put-reverse.wav');
});

test('BGM off leaves time reversal and disappearing stone effects enabled', async () => {
  const state = R.createGame(); state.board.fill(0);
  state.board[2] = state.board[14] = R.BLACK;
  state.board[1] = state.board[7] = R.WHITE;
  const ui = app(state);
  ui.click('bgm'); ui.move(0); await ui.tick(1000);
  assert.deepEqual(ui.sounds, ['assets/sounds/switch.mp3', 'assets/sounds/put.mp3',
    'assets/sounds/time-reversal.wav', 'assets/sounds/put-reverse.wav']);
});

test('finished replay preserves the final English result and can run again', async () => {
  const state = R.createGame(); state.board.fill(R.BLACK);
  state.board[0] = 0; state.board[1] = R.WHITE; state.usedCorners = [0,5,30,35];
  const ui = app(state); ui.move(0); await ui.tick(500);
  assert.equal(ui.ids.replay.hidden, false);
  assert.equal(ui.ids.log.textContent, 'Black wins!');
  assert.equal(ui.ids['black-count'].textContent, '36');
  assert.equal(ui.ids['white-count'].textContent, '0');
  assert.equal(ui.ids['black-count'].hidden, false);
  ui.click('replay');
  assert.equal(ui.ids.replay.disabled, undefined);
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Pause replay');
  assert.equal(ui.ids.replay.children[0].src, 'assets/icon/pause.svg');
  await ui.tick(500);
  assert.equal(ui.ids.log.textContent, 'Black wins!');
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Replay game');
  assert.equal(ui.ids.replay.children[0].src, 'assets/icon/replay.svg');
  ui.click('replay'); await ui.tick(500);
  assert.equal(ui.ids.log.textContent, 'Black wins!');
  assert.equal(ui.ids['black-count'].textContent, '36');
  ui.click('new-game-button'); ui.ids['new-game'].close('yes');
  assert.equal(ui.ids['black-count'].hidden, true);
  assert.equal(ui.ids['white-count'].hidden, true);
});

test('replay pauses on the current frame and resumes from there', async () => {
  const state = R.createGame(); state.board.fill(R.BLACK);
  state.board[0] = 0; state.board[1] = R.WHITE; state.usedCorners = [0,5,30,35];
  const ui = app(state); ui.move(0); await ui.tick(500);
  ui.click('replay');
  assert.match(ui.ids.cells.children[0].attrs['aria-label'], /empty/);
  await ui.tick(70);
  ui.click('replay');
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Resume replay');
  assert.equal(ui.ids.replay.children[0].src, 'assets/icon/replay.svg');
  await ui.tick(500);
  assert.match(ui.ids.cells.children[0].attrs['aria-label'], /empty/);
  assert.equal(ui.ids.log.textContent, 'Black wins!');
  ui.click('replay');
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Pause replay');
  await ui.tick(500);
  assert.match(ui.ids.cells.children[0].attrs['aria-label'], /Black/);
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Replay game');
  assert.equal(ui.ids.log.textContent, 'Black wins!');
});

test('new game during a paused replay clears the replay state', async () => {
  const state = R.createGame(); state.board.fill(R.BLACK);
  state.board[0] = 0; state.board[1] = R.WHITE; state.usedCorners = [0,5,30,35];
  const ui = app(state); ui.move(0); await ui.tick(500);
  ui.click('replay'); ui.click('replay');
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Resume replay');
  ui.click('new-game-button'); ui.ids['new-game'].close('yes');
  await ui.tick(500);
  assert.equal(ui.ids.replay.hidden, true);
  assert.equal(ui.ids.replay.attrs['aria-label'], 'Replay game');
  assert.equal(ui.ids.log.textContent, "Black's turn");
  assert.match(ui.ids.cells.children[0].attrs['aria-label'], /empty/);
});

test('BGM alternates songs, pauses with its button, and restarts normally on new game', async () => {
  const ui = app();
  assert.equal(ui.bgmAudio.src, 'assets/sounds/komorebi_orgel.mp3');
  ui.bgmAudio.emit('ended');
  assert.equal(ui.bgmAudio.src, 'assets/sounds/tsukikage_orgel.mp3');
  ui.bgmAudio.emit('ended');
  assert.equal(ui.bgmAudio.src, 'assets/sounds/komorebi_orgel.mp3');
  ui.click('bgm');
  assert.equal(ui.bgmAudio.paused, true);
  ui.click('bgm');
  assert.equal(ui.bgmAudio.paused, false);
  ui.bgmAudio.emit('ended');
  ui.click('new-game-button'); ui.ids['new-game'].close('yes');
  assert.equal(ui.bgmAudio.src, 'assets/sounds/komorebi_orgel.mp3');
});

test('four real corner reversals select the requested BGM stages', async () => {
  const path = [27,26,31,34,28,22,13,8,29,35,9,6,23,17,19,13,11,18,33,4,7,10,24,8,0,1,16,27,28,25,26,29,10,22,31,19,24,23,33,4,13,18,5,5,9,34,35,13,18,4,6,12,11,23,3,0,17,24,8,16,19,26,29,25,31,32,22,2,1,28,30];
  const suffix = ['', '_150x_reverse', '_150x', '_200x_reverse', '_200x'];
  const ui = app();
  for (let i = 0; i < 3; i++) ui.click('cpu-white');
  let state = R.createGame(), reversals = 0;
  for (const index of path) {
    const result = R.advance(state, index);
    assert.ok(result);
    ui.move(index);
    await ui.tick(2000);
    state = result.state;
    if (result.cornerInversion) {
      reversals++;
      assert.equal(ui.bgmAudio.src, `assets/sounds/komorebi_orgel${suffix[reversals]}.mp3`);
    }
  }
  assert.equal(reversals, 4);
  ui.bgmAudio.emit('ended');
  assert.equal(ui.bgmAudio.src, 'assets/sounds/tsukikage_orgel_200x.mp3');
});

test('pasted replay starts the BGM selected by its final reversal count', async () => {
  const path = [27,26,31,34,28,22,13,8,29,35,9,6,23,17,19,13,11,18,33,4,7,10,24,8,0,1,16,27,28,25,26,29,10,22,31,19,24,23,33,4,13,18,5,5,9,34,35,13,18,4,6,12,11,23,3,0,17,24,8,16,19,26,29,25,31,32,22,2,1,28,30];
  const cases = [[1, ''], [10, '_150x_reverse'], [25, '_150x'], [43, '_200x_reverse'], [71, '_200x']];
  const record = actions => actions.map(index => index === null ? 'pa'
    : `${String.fromCharCode(97 + index % 6)}${Math.floor(index / 6) + 1}`).join('');
  for (const [length, suffix] of cases) {
    const ui = app();
    ui.click('title'); ui.ids['record-import'].value = record(path.slice(0, length));
    ui.click('replay-import');
    assert.equal(ui.bgmAudio.src, `assets/sounds/komorebi_orgel${suffix}.mp3`);
    await ui.tick(30000);
    assert.equal(ui.bgmAudio.src, `assets/sounds/komorebi_orgel${suffix}.mp3`);
  }
});

test('a pasted record that ends the game uses 2x forward BGM even after one reversal', async () => {
  const terminal = [13,7,8,9,0,18,2,27,12,7,24];
  let state = R.createGame();
  for (const index of terminal) state = R.advance(state, index).state;
  assert.equal(state.ended, true);
  assert.equal(state.usedCorners.length, 1);
  const ui = app();
  ui.click('title');
  ui.ids['record-import'].value = terminal.map(index => `${String.fromCharCode(97 + index % 6)}${Math.floor(index / 6) + 1}`).join('');
  ui.click('replay-import');
  assert.equal(ui.bgmAudio.src, 'assets/sounds/komorebi_orgel_200x.mp3');
  await ui.tick(30000);
  assert.equal(ui.ids.log.textContent.includes('wins!'), true);
  assert.equal(ui.bgmAudio.src, 'assets/sounds/komorebi_orgel_200x.mp3');
});
