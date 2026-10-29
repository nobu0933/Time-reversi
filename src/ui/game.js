(() => {
  'use strict';
  const R = window.Reversi;
  const Replay = window.ReplayTimeline;
  const grid = document.querySelector('#cells');
  const log = document.querySelector('#log');
  const thinking = document.querySelector('#cpu-thinking');
  const dialog = document.querySelector('#new-game');
  const recordDialog = document.querySelector('#record-dialog');
  const recordText = document.querySelector('#record-text');
  const copyRecord = document.querySelector('#copy-record');
  const recordImport = document.querySelector('#record-import');
  const replayImport = document.querySelector('#replay-import');
  const recordImportError = document.querySelector('#record-import-error');
  const passOverlay = document.querySelector('#pass-overlay');
  const bgm = document.querySelector('#bgm');
  const replay = document.querySelector('#replay');
  const timeClock = document.querySelector('#time-clock');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const corners = new Set([0, R.SIZE - 1, R.SIZE * (R.SIZE - 1), R.SIZE * R.SIZE - 1]);
  let game = R.createGame();
  let replayFrames = [Replay.snapshot(game)], moveHistory = [], shownRecord = '', epoch = 0, replaying = false;
  let replayPaused = false, replayFrame = 0, replayFinalGame = null, replayToken = 0;
  let importedRecord = false, replayLocked = false, awaitingBoardClick = false;
  const cpu = { '1': 'OFF', '-1': 'EZY' };
  let bgmOn = true;
  const bgmNames = ['komorebi_orgel', 'tsukikage_orgel'];
  const bgmSuffixes = ['', '_150x_reverse', '_150x', '_200x_reverse', '_200x'];
  let bgmTrack = 0, bgmReversals = 0;
  const bgmAudio = new Audio(`assets/sounds/${bgmNames[0]}.mp3`);
  bgmAudio.preload = 'auto';
  function startBgm() {
    if (!bgmOn || !bgmAudio.paused) return;
    try { bgmAudio.play()?.catch(() => {}); }
    catch (_) { /* Browsers may require a user gesture before audio can start. */ }
  }
  function selectBgm() {
    bgmAudio.pause();
    bgmAudio.src = `assets/sounds/${bgmNames[bgmTrack]}${bgmSuffixes[Math.min(bgmReversals, 4)]}.mp3`;
    bgmAudio.currentTime = 0;
    startBgm();
  }
  function resetBgm(reversals = 0) {
    bgmTrack = 0;
    bgmReversals = reversals;
    selectBgm();
  }
  bgmAudio.addEventListener('ended', () => {
    bgmTrack = (bgmTrack + 1) % bgmNames.length;
    selectBgm();
  });
  const putSound = new Audio('assets/sounds/put.mp3');
  const switchSound = new Audio('assets/sounds/switch.mp3');
  const passSound = new Audio('assets/sounds/pass.mp3');
  const reversePutSound = new Audio('assets/sounds/put-reverse.wav');
  const timeReversalSound = new Audio('assets/sounds/time-reversal.wav');
  putSound.preload = switchSound.preload = passSound.preload
    = reversePutSound.preload = timeReversalSound.preload = 'auto';
  function playSound(sound) {
    try {
      sound.currentTime = 0;
      sound.play()?.catch(() => {});
    } catch (_) { /* Audio may be unavailable before user interaction. */ }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (button && button !== bgm && !button.classList.contains('cell')) playSound(switchSound);
    if (button !== bgm) startBgm();
  }, true);
  const cancelled = Symbol('cancelled');
  let { board, player, ended } = game;
  let busy = false, hover = -1, turnTimer, logTimer, aiRequest;
  let pointer = null, target = -1, suppressMouseUntil = 0;
  const cursor = piece(player, 'cursor-piece');
  cursor.hidden = true;
  document.body.append(cursor);
  const name = value => value === R.BLACK ? 'Black' : 'White';
  const modalOpen = () => dialog.open || recordDialog.open;
  const moveRecord = () => moveHistory.map(index => index === null ? 'ps'
    : `${String.fromCharCode(97 + index % R.SIZE)}${Math.floor(index / R.SIZE) + 1}`).join('');
  function updateRecordDisplay() {
    shownRecord = moveRecord();
    recordText.textContent = shownRecord || 'No moves yet';
    copyRecord.textContent = 'Copy';
  }
  function parseMoveRecord(text) {
    const record = text.replace(/\s+/g, '').toLowerCase();
    if (!record) throw new Error('Paste a move record.');
    if (record.length > 4096 || record.length % 2) throw new Error('Use two characters per move, such as c2 or ps.');
    const actions = [], frames = [], initial = R.createGame();
    let state = initial;
    frames.push(Replay.snapshot(initial));
    for (let offset = 0; offset < record.length; offset += 2) {
      const token = record.slice(offset, offset + 2);
      if (token !== 'ps' && !/^[a-f][1-6]$/.test(token))
        throw new Error(`Invalid move ${offset / 2 + 1}: ${token}`);
      const index = token === 'ps' ? null : (Number(token[1]) - 1) * R.SIZE + token.charCodeAt(0) - 97;
      const move = R.advance(state, index);
      if (!move) throw new Error(`Illegal move ${offset / 2 + 1}: ${token}`);
      actions.push(index);
      frames.push(...Replay.framesForAdvance(state, move));
      state = move.state;
    }
    return { state, actions, frames };
  }
  const cells = board.map((_, index) => {
    const cell = document.createElement('button');
    cell.type = 'button'; cell.className = 'cell';
    cell.addEventListener('focus', () => { if (Date.now() < suppressMouseUntil) return; hover = index; preview(); });
    cell.addEventListener('blur', () => { hover = -1; preview(); });
    cell.addEventListener('click', event => {
      resumeAfterReplayOnBoardClick();
      const fromTouch = event.pointerType === 'touch' || Date.now() < suppressMouseUntil;
      if (event.detail === 0 || fromTouch) {
        if (fromTouch) { hover = -1; clearPointer(); }
        event.stopPropagation(); place(index);
      }
    });
    cell.addEventListener('keydown', event => {
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 }[event.key];
      if (delta) { event.preventDefault(); cells[(index + delta + 36) % 36].focus(); }
    });
    grid.append(cell); return cell;
  });
  function resumeAfterReplayOnBoardClick() {
    if (!awaitingBoardClick || replaying || modalOpen()) return;
    awaitingBoardClick = false;
    scheduleTurn();
  }
  grid.addEventListener('click', resumeAfterReplayOnBoardClick);
  function piece(color, extra = '') {
    const element = document.createElement('span');
    element.className = `piece ${color === R.WHITE ? 'white' : 'black'} ${extra}`;
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = '<span class="body"></span>';
    return element;
  }
  function preview() {
    grid.querySelectorAll('.landing-shadow').forEach(element => element.remove());
    target = -1;
    const overControls = pointer && document.elementFromPoint(pointer.x, pointer.y)?.closest('.control');
    cursor.hidden = !pointer || busy || ended || cpu[player] !== 'OFF' || modalOpen() || Boolean(overControls);
    document.body.classList.toggle('piece-pointer', Boolean(pointer) && !busy && !ended && cpu[player] === 'OFF' && !modalOpen());
    if (busy || ended || cpu[player] !== 'OFF' || modalOpen()) return;
    const legal = R.moves(board, player);
    if (pointer) {
      cursor.classList.toggle('white', player === R.WHITE);
      const sample = cells[0];
      cursor.style.width = `${sample.clientWidth * .73}px`;
      cursor.style.height = `${sample.clientHeight * .73}px`;
      cursor.style.left = `${pointer.x}px`;
      cursor.style.top = `${pointer.y}px`;
      let nearest = Infinity;
      for (const index of legal) {
        const rect = cells[index].getBoundingClientRect();
        const distance = Math.hypot(pointer.x - rect.x - rect.width / 2, pointer.y - rect.y - rect.height / 2);
        if (distance <= Math.min(rect.width, rect.height) * .8 && distance < nearest) {
          nearest = distance; target = index;
        }
      }
    } else if (legal.includes(hover)) target = hover;
    if (target >= 0) {
      const shadow = document.createElement('span');
      shadow.className = 'piece landing-shadow';
      shadow.setAttribute('aria-hidden', 'true');
      cells[target].append(shadow);
    }
  }
  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents || Date.now() < suppressMouseUntil) return;
    pointer = { x: event.clientX, y: event.clientY }; preview();
  });
  document.addEventListener('click', event => {
    if (event.button !== 0 || event.detail === 0 || event.target.closest('.control')) return;
    if (event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents || Date.now() < suppressMouseUntil) return;
    pointer = { x: event.clientX, y: event.clientY }; preview();
    if (target >= 0) place(target);
  });
  function clearPointer() { pointer = null; preview(); }
  document.documentElement.addEventListener('pointerleave', clearPointer);
  window.addEventListener('blur', clearPointer);
  window.addEventListener('resize', preview);
  document.addEventListener('keydown', event => {
    if (['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      suppressMouseUntil = 0; clearPointer();
    }
  });
  function markTouch() {
    suppressMouseUntil = Date.now() + 750;
    hover = -1;
    clearPointer();
  }
  for (const type of ['pointerdown', 'pointerup', 'pointercancel'])
    document.addEventListener(type, event => { if (event.pointerType === 'touch') markTouch(); });
  for (const type of ['touchstart', 'touchend']) document.addEventListener(type, markTouch);
  document.addEventListener('touchmove', event => event.preventDefault(), { passive: false });
  for (const type of ['gesturestart', 'gesturechange'])
    document.addEventListener(type, event => event.preventDefault(), { passive: false });
  document.addEventListener('selectstart', event => {
    if (!['copy-fallback', 'record-import'].includes(event.target?.id)) event.preventDefault();
  });
  document.addEventListener('dragstart', event => event.preventDefault());
  function updateTimeShades(history = game.history) {
    cells.forEach(cell => {
      cell.style.removeProperty('--time-strength');
      cell.classList.remove('nearest-time', 'second-time');
    });
    for (const direction of [1, -1]) {
      const turns = history[direction];
      // Each pending pass consumes a turn even though it has no visible stone.
      for (let turn = 0; turn < turns.length; turn++) {
        const index = turns[turn];
        if (index === null) continue;
        const distance = turns.length - 1 - turn;
        cells[index].classList.toggle('nearest-time', distance === 0);
        cells[index].classList.toggle('second-time', distance === 1);
        const strength = 100 / (1 + distance * .24);
        cells[index].style.setProperty('--time-strength', `${strength.toFixed(3)}%`);
      }
    }
  }
  function render() {
    document.body.classList.toggle('reverse-time', game.direction === -1);
    const clock = R.clockReading(game);
    timeClock.style.setProperty('--clock-start', `${clock.start * 11.25}deg`);
    timeClock.style.setProperty('--orange-end', `${clock.forward * 11.25}deg`);
    timeClock.style.setProperty('--blue-end', `${(clock.forward + clock.reverse) * 11.25}deg`);
    timeClock.style.setProperty('--hand-angle', `${clock.needle * 11.25}deg`);
    timeClock.setAttribute('aria-label', `${game.direction === 1 ? 'Forward' : 'Reverse'} time. ${clock.forward} forward stones, ${clock.reverse} reverse stones`);
    const legal = busy || ended ? [] : R.moves(board, player);
    cells.forEach((cell, index) => {
      cell.replaceChildren();
      cell.classList.toggle('legal', legal.includes(index));
      const activeCorner = corners.has(index) && !game.usedCorners.includes(index) && !board[index];
      cell.classList.toggle('inversion-corner', activeCorner);
      cell.classList.toggle('forward-stone', game.origins[index] === 1);
      cell.classList.toggle('reverse-stone', game.origins[index] === -1);
      cell.setAttribute('aria-disabled', String(!legal.includes(index)));
      cell.setAttribute('aria-label', `Row ${Math.floor(index / 6) + 1}, column ${index % 6 + 1}: ${board[index] ? name(board[index]) : 'empty'}${activeCorner ? ', Time reversal corner' : ''}`);
      if (board[index]) cell.append(piece(board[index]));
      if (activeCorner) {
        const icon = document.createElement('img');
        icon.className = 'corner-icon';
        icon.src = game.direction === 1 ? 'assets/icon/time-inversion-forward.svg' : 'assets/icon/time-inversion-reverse.svg';
        icon.alt = '';
        icon.setAttribute('aria-hidden', 'true');
        cell.append(icon);
      }
    });
    updateTimeShades();
    preview();

  }
  function setLog(text) { log.textContent = text; }
  function updateLog() {
    if (replaying) return;
    const blackCount = document.querySelector('#black-count');
    const whiteCount = document.querySelector('#white-count');
    blackCount.hidden = whiteCount.hidden = !ended;
    if (!ended) { setLog(`${name(player)}'s turn`); return; }
    const black = board.filter(value => value === R.BLACK).length;
    const white = board.filter(value => value === R.WHITE).length;
    blackCount.textContent = String(black);
    whiteCount.textContent = String(white);
    blackCount.setAttribute('aria-label', `Black: ${black} stones`);
    whiteCount.setAttribute('aria-label', `White: ${white} stones`);
    setLog(black === white ? 'Draw!' : `${name(black > white ? R.BLACK : R.WHITE)} wins!`);
  }
  function scheduleTurn() {
    clearTimeout(turnTimer);
    aiRequest?.abort(); aiRequest = null;
    thinking.hidden = true;
    if (busy || ended || modalOpen() || replaying || awaitingBoardClick) return;
    const legal = R.moves(board, player);
    if (!legal.length) turnTimer = setTimeout(() => place(null, 'auto'), 350);
    else if (cpu[player] === 'EZY') {
      thinking.hidden = false;
      turnTimer = setTimeout(() => {
        const moves = R.moves(board, player);
        if (cpu[player] === 'EZY' && moves.length) place(moves[Math.floor(Math.random() * moves.length)], 'auto');
      }, 650);
    }
    else if (cpu[player] === 'MID' || cpu[player] === 'PRO') {
      thinking.hidden = false;
      const mode = cpu[player];
      turnTimer = setTimeout(() => requestAIMove(mode), 350);
    }
  }
  async function requestAIMove(mode) {
    if (cpu[player] !== mode) return;
    const run = epoch, position = game, controller = new AbortController();
    aiRequest = controller;
    try {
      const result = await window.ProAI.choose(position, { signal: controller.signal, mode });
      if (run !== epoch || position !== game || cpu[player] !== mode || modalOpen() || replaying) return;
      const moves = R.moves(board, player);
      if (!Number.isInteger(result.action) || !moves.includes(result.action)) throw new Error(`${mode} returned an illegal move`);
      place(result.action, 'auto');
    } catch (error) {
      if (error.name !== 'AbortError' && run === epoch && position === game && cpu[player] === mode) {
        thinking.hidden = true;
        console.error(error);
        setLog(`${mode} unavailable — reload the page`);
      }
    } finally { if (aiRequest === controller) aiRequest = null; }
  }
  async function pause(ms, run, motion = false) {
    await new Promise(resolve => setTimeout(resolve, motion && reduced.matches ? 0 : ms));
    if (run !== epoch) throw cancelled;
  }
  async function pulse(run, replayRun = null) {
    document.body.classList.remove('time-pulse');
    void document.body.offsetWidth;
    document.body.classList.add('time-pulse');
    await pause(360, run, true);
    if (replayRun === null || replayRun === replayToken) document.body.classList.remove('time-pulse');
  }
  async function showPass(run) {
    const disc = piece(player, 'pass-disc');
    const label = document.createElement('span');
    label.className = 'pass-label'; label.textContent = 'PASS';
    disc.querySelector('.body').append(label);
    passOverlay.replaceChildren(disc); passOverlay.hidden = false;
    playSound(passSound);
    await pause(800, run);
    passOverlay.hidden = true;
  }
  async function place(index, source = 'human') {
    if (busy || ended || modalOpen() || (source === 'human' && cpu[player] !== 'OFF')) return;
    const run = epoch;
    const before = game;
    const move = R.advance(game, index);
    if (!move) return;
    thinking.hidden = true;
    if (importedRecord && index !== null) {
      replayLocked = true;
      replay.hidden = true;
    }
    const frames = Replay.framesForAdvance(before, move);
    const origin = source === 'human' && pointer && !cursor.hidden ? cursor.getBoundingClientRect() : null;
    busy = true;
    clearTimeout(turnTimer); clearTimeout(logTimer);
    grid.setAttribute('aria-busy', 'true');
    render();
    try {
      if (index === null) await showPass(run);
      else {
        const placed = piece(player, 'placing');
        cells[index].classList.add(move.placedDirection === 1 ? 'forward-stone' : 'reverse-stone');
        cells[index].append(placed);
        if (origin) {
          const destination = placed.getBoundingClientRect();
          placed.style.setProperty('--drop-x', `${origin.left - destination.left}px`);
          placed.style.setProperty('--drop-y', `${origin.top - destination.top}px`);
        }
        await pause(240, run, true);
        updateTimeShades({ ...game.history, [move.placedDirection]: [...game.history[move.placedDirection], index] });
      }
      for (const i of move.captured) {
        const disc = piece(player, 'turning');
        disc.style.setProperty('--old-face', player === R.BLACK ? 'var(--white)' : 'var(--black)');
        disc.style.setProperty('--old-side', player === R.BLACK ? 'var(--white-side)' : 'var(--black-side)');
        cells[i].replaceChildren(disc);
      }
      if (move.captured.length) {
        await pause(260, run, true);
        playSound(putSound);
      }
      await animateRemoval(move, run);
      if (move.cornerInversion) {
        game = { ...move.beforeInversion, direction: -move.placedDirection, ended: false };
        board = game.board;
        render(); setLog('Time reversal');
        playSound(timeReversalSound);
        bgmReversals++;
        selectBgm();
        await pulse(run);
        await animateRemoval(move.cornerInversion, run);
      }
      if (run !== epoch) return;
      game = move.state;
      replayFrames.push(...frames);
      moveHistory.push(index);
      if (recordDialog.open) updateRecordDisplay();
      ({ board, player, ended } = game);
      busy = false;
      grid.setAttribute('aria-busy', 'false');
      // An imported unfinished record hides Replay once normal play begins,
      // but a later terminal move must make the finished-game Replay button visible.
      replay.hidden = ended ? false : (!importedRecord || replayLocked);
      render();
      if (move.cornerInversion && !ended) {
        setLog('Time reversal');
        logTimer = setTimeout(() => { if (run === epoch) updateLog(); }, 500);
      } else updateLog();
      scheduleTurn();
    } catch (error) { if (error !== cancelled) throw error; }
  }
  async function animateRemoval(move, run) {
    if (move.removed !== null) {
      cells[move.removed].replaceChildren(piece(move.removedColor, 'vanishing'));
      if (game.direction === -1) playSound(reversePutSound);
      await pause(300, run, true);
      cells[move.removed].replaceChildren();
      cells[move.removed].classList.remove('forward-stone', 'reverse-stone');
    }
  }
  function updateReplayButton() {
    const label = replaying ? (replayPaused ? 'Resume replay' : 'Pause replay') : 'Replay game';
    replay.setAttribute('aria-label', label);
    replay.title = label;
    replay.querySelector('img').src = replaying && !replayPaused ? 'assets/icon/pause.svg' : 'assets/icon/replay.svg';
  }
  async function playReplay() {
    const run = epoch, token = ++replayToken;
    replayPaused = false;
    updateReplayButton();
    grid.setAttribute('aria-busy', 'true');
    try {
      while (replayFrame < replayFrames.length) {
        const frame = replayFrames[replayFrame++];
        const changed = game.direction !== frame.direction;
        game = frame;
        ({ board, player, ended } = game);
        render();
        if (changed) await pulse(run, token);
        if (token !== replayToken) return;
        await pause(145, run);
        if (token !== replayToken) return;
      }
      game = replayFinalGame;
      ({ board, player, ended } = game);
      busy = false; replaying = false; replayFinalGame = null; replayFrame = 0;
      awaitingBoardClick = importedRecord && !ended && cpu[player] !== 'OFF';
      updateReplayButton();
      grid.setAttribute('aria-busy', 'false'); render(); updateLog(); scheduleTurn();
    } catch (error) { if (error !== cancelled) throw error; }
  }
  replay.addEventListener('click', event => {
    event.stopPropagation();
    if (modalOpen()) return;
    if (replaying) {
      if (replayPaused) playReplay();
      else {
        replayPaused = true; replayToken++;
        document.body.classList.remove('time-pulse');
        grid.setAttribute('aria-busy', 'false');
        updateReplayButton();
      }
      return;
    }
    if (replay.hidden || busy) return;
    replayFinalGame = game; replayFrame = 0;
    busy = true; replaying = true;
    thinking.hidden = true;
    playReplay();
  });
  function newGame() {
    epoch++; replayToken++;
    aiRequest?.abort(); aiRequest = null;
    clearTimeout(turnTimer); clearTimeout(logTimer);
    game = R.createGame(); ({ board, player, ended } = game); hover = -1;
    resetBgm();
    replayFrames = [Replay.snapshot(game)]; moveHistory = []; shownRecord = '';
    importedRecord = false; replayLocked = false; awaitingBoardClick = false;
    busy = false; replaying = false; replayPaused = false; replayFinalGame = null; replayFrame = 0; replay.hidden = true;
    updateReplayButton();
    passOverlay.hidden = true;
    document.body.classList.remove('time-pulse');
    grid.setAttribute('aria-busy', 'false');
    render(); updateLog(); scheduleTurn();
  }
  function confirmNewGame() {
    clearTimeout(turnTimer);
    aiRequest?.abort(); aiRequest = null;
    thinking.hidden = true;
    dialog.returnValue = ''; dialog.showModal(); preview();
  }
  document.querySelector('#title').addEventListener('click', () => {
    clearTimeout(turnTimer);
    aiRequest?.abort(); aiRequest = null;
    thinking.hidden = true;
    updateRecordDisplay();
    recordDialog.showModal(); preview();
  });
  document.querySelector('#new-game-button').addEventListener('click', confirmNewGame);
  recordImport.addEventListener('input', () => { recordImportError.hidden = true; });
  replayImport.addEventListener('click', () => {
    let imported;
    try { imported = parseMoveRecord(recordImport.value); }
    catch (error) {
      recordImportError.textContent = error.message;
      recordImportError.hidden = false;
      return;
    }
    recordImportError.hidden = true;
    recordImport.value = '';
    epoch++; replayToken++;
    aiRequest?.abort(); aiRequest = null;
    clearTimeout(turnTimer); clearTimeout(logTimer);
    passOverlay.hidden = true;
    document.body.classList.remove('time-pulse');
    game = imported.state;
    resetBgm(game.ended ? 4 : game.usedCorners.length);
    ({ board, player, ended } = game);
    moveHistory = imported.actions;
    replayFrames = imported.frames;
    importedRecord = true; replayLocked = false; awaitingBoardClick = false;
    replayFinalGame = game; replayFrame = 0;
    busy = true; replaying = true; replayPaused = false; replay.hidden = false; hover = -1;
    grid.setAttribute('aria-busy', 'true');
    recordDialog.close();
    playReplay();
  });
  copyRecord.addEventListener('click', async () => {
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(shownRecord); copied = true; } catch (_) { /* Try the browser's copy command. */ }
      }
      if (!copied) {
        const input = document.createElement('textarea');
        input.id = 'copy-fallback'; input.value = shownRecord;
        input.style.position = 'fixed'; input.style.left = '-9999px';
        input.style.userSelect = input.style.webkitUserSelect = 'text';
        document.body.append(input);
        try { input.select(); copied = document.execCommand('copy'); }
        finally { input.remove(); }
        if (!copied) throw new Error('Clipboard unavailable');
      }
      copyRecord.textContent = 'Copied';
    } catch (error) {
      copyRecord.textContent = 'Copy failed';
    }
  });
  recordDialog.addEventListener('close', () => { preview(); scheduleTurn(); });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'yes') newGame();
    else { preview(); scheduleTurn(); }
  });
  bgm.addEventListener('click', () => {
    bgmOn = !bgmOn;
    bgm.setAttribute('aria-pressed', String(bgmOn));
    bgm.title = `BGM ${bgmOn ? 'on' : 'off'}`;
    bgm.querySelector('img').src = `assets/icon/bgm-${bgmOn ? 'on' : 'off'}.svg`;
    if (bgmOn) startBgm(); else bgmAudio.pause();
    playSound(switchSound);
  });
  for (const color of [R.BLACK, R.WHITE]) {
    const button = document.querySelector(`#cpu-${name(color).toLowerCase()}`);
    const label = document.querySelector(`#cpu-label-${name(color).toLowerCase()}`);
    button.addEventListener('click', () => {
      const modes = ['OFF', 'EZY', 'MID', 'PRO'];
      cpu[color] = modes[(modes.indexOf(cpu[color]) + 1) % modes.length];
      const human = cpu[color] === 'OFF';
      button.textContent = human ? 'PLY' : cpu[color];
      label.hidden = human;
      button.setAttribute('data-mode', cpu[color]);
      button.setAttribute('aria-pressed', String(!human));
      button.setAttribute('aria-label', human ? `${name(color)} player: PLY (human)` : `${name(color)} CPU: ${cpu[color]}`);
      button.title = human ? `${name(color)} player: human`
        : `${name(color)} CPU: ${{ EZY: 'random', MID: 'browser AI', PRO: 'browser AI' }[cpu[color]]}`;
      if (log.textContent.endsWith('unavailable — reload the page')) updateLog();
      preview(); scheduleTurn();
    });
  }
  render(); updateLog(); scheduleTurn(); startBgm();
})();
