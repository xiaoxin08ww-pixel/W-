"use strict";

const TOTAL_LEVELS = 100;
const STORAGE_KEY = "sudoku100.state.v1";
const RANK_KEY = "sudoku100.ranks.v1";
const boardEl = document.querySelector("#board");
const canvas = document.querySelector("#paintCanvas");
const ctx = canvas.getContext("2d");
const numberPad = document.querySelector("#numberPad");
const levelSelect = document.querySelector("#levelSelect");
const levelLabel = document.querySelector("#levelLabel");
const difficultyLabel = document.querySelector("#difficultyLabel");
const timerEl = document.querySelector("#timer");
const hintBtn = document.querySelector("#hintBtn");
const hintState = document.querySelector("#hintState");
const paintBtn = document.querySelector("#paintBtn");
const eraserBtn = document.querySelector("#eraserBtn");
const clearPaintBtn = document.querySelector("#clearPaintBtn");
const checkBtn = document.querySelector("#checkBtn");
const resetBtn = document.querySelector("#resetBtn");
const musicBtn = document.querySelector("#musicBtn");
const prevBtn = document.querySelector("#prevBtn");
const nextBtn = document.querySelector("#nextBtn");
const rankMode = document.querySelector("#rankMode");
const rankList = document.querySelector("#rankList");
const messageEl = document.querySelector("#message");
const progressLabel = document.querySelector("#progressLabel");
const progressBar = document.querySelector("#progressBar");
const completeDialog = document.querySelector("#completeDialog");
const completeTitle = document.querySelector("#completeTitle");
const completeText = document.querySelector("#completeText");
const rewardBadge = document.querySelector("#rewardBadge");
const playerName = document.querySelector("#playerName");
const saveRankBtn = document.querySelector("#saveRankBtn");
const nextLevelBtn = document.querySelector("#nextLevelBtn");

let cells = [];
let puzzles = [];
let state = loadState();
let ranks = loadRanks();
let selectedIndex = -1;
let timerId = 0;
let paintMode = false;
let eraserMode = false;
let isDrawing = false;
let pendingCompletion = null;
let audioCtx = null;
let musicTimer = 0;
let musicStep = 0;
let musicOn = false;
let masterGain = null;
let delayNode = null;

init();

function init() {
  puzzles = Array.from({ length: TOTAL_LEVELS }, (_, index) => makePuzzle(index + 1));
  buildLevelSelect();
  buildBoard();
  buildNumberPad();
  bindEvents();
  loadLevel(state.level || 1, false);
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { level: 1, completed: {} };
  } catch {
    return { level: 1, completed: {} };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadRanks() {
  try {
    return JSON.parse(localStorage.getItem(RANK_KEY)) || {};
  } catch {
    return {};
  }
}

function saveRanks() {
  localStorage.setItem(RANK_KEY, JSON.stringify(ranks));
}

function buildLevelSelect() {
  levelSelect.innerHTML = "";
  for (let i = 1; i <= TOTAL_LEVELS; i += 1) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `第 ${i} 关`;
    levelSelect.append(option);
  }
}

function buildBoard() {
  boardEl.innerHTML = "";
  cells = Array.from({ length: 81 }, (_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cell";
    button.dataset.index = String(index);
    button.setAttribute("aria-label", `第 ${Math.floor(index / 9) + 1} 行第 ${(index % 9) + 1} 列`);
    boardEl.append(button);
    return button;
  });
}

function buildNumberPad() {
  numberPad.innerHTML = "";
  for (let i = 1; i <= 9; i += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(i);
    button.dataset.value = String(i);
    numberPad.append(button);
  }
  const erase = document.createElement("button");
  erase.type = "button";
  erase.textContent = "清空";
  erase.dataset.value = "0";
  numberPad.append(erase);
}

function bindEvents() {
  boardEl.addEventListener("click", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || paintMode) return;
    selectedIndex = Number(cell.dataset.index);
    updateSelection();
  });

  numberPad.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    placeNumber(Number(button.dataset.value));
  });

  document.addEventListener("keydown", (event) => {
    if (completeDialog.open) return;
    if (/^[1-9]$/.test(event.key)) placeNumber(Number(event.key));
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") placeNumber(0);
    if (event.key.startsWith("Arrow")) moveSelection(event.key);
  });

  hintBtn.addEventListener("click", useHint);
  checkBtn.addEventListener("click", checkBoard);
  resetBtn.addEventListener("click", () => loadLevel(state.level, true));
  musicBtn.addEventListener("click", toggleMusic);
  prevBtn.addEventListener("click", () => loadLevel(Math.max(1, state.level - 1), true));
  nextBtn.addEventListener("click", () => loadLevel(Math.min(TOTAL_LEVELS, state.level + 1), true));
  levelSelect.addEventListener("change", () => loadLevel(Number(levelSelect.value), true));
  rankMode.addEventListener("change", renderRanks);
  paintBtn.addEventListener("click", () => setPaintMode(!paintMode, false));
  eraserBtn.addEventListener("click", () => setPaintMode(true, !eraserMode));
  clearPaintBtn.addEventListener("click", clearPaint);
  saveRankBtn.addEventListener("click", savePendingRank);
  nextLevelBtn.addEventListener("click", () => {
    savePendingRank();
    completeDialog.close();
    if (state.level >= TOTAL_LEVELS) return;
    loadLevel(Math.min(TOTAL_LEVELS, state.level + 1), true);
  });

  canvas.addEventListener("pointerdown", startStroke);
  canvas.addEventListener("pointermove", drawStroke);
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  window.addEventListener("resize", resizeCanvas);
}

function loadLevel(level, resetProgress) {
  const puzzle = puzzles[level - 1];
  state.level = level;
  state.current = resetProgress || !state.current || state.current.level !== level
    ? freshCurrent(level, puzzle)
    : state.current;
  selectedIndex = state.current.givens.findIndex((value) => !value);
  if (selectedIndex < 0) selectedIndex = 0;
  saveState();
  render();
  startTimer();
  clearPaint();
  resizeCanvas();
  setMessage(`第 ${level} 关开始。每关只有一次提示。`);
}

function freshCurrent(level, puzzle) {
  return {
    level,
    values: puzzle.givens.slice(),
    givens: puzzle.givens.map(Boolean),
    hintUsed: false,
    elapsed: 0,
    startedAt: Date.now(),
    solved: false
  };
}

function startTimer() {
  clearInterval(timerId);
  state.current.startedAt = Date.now();
  timerId = setInterval(() => {
    if (state.current.solved) return;
    renderTimer(currentElapsed());
  }, 1000);
  renderTimer(currentElapsed());
}

function currentElapsed() {
  return state.current.elapsed + Math.floor((Date.now() - state.current.startedAt) / 1000);
}

function persistElapsed() {
  if (!state.current.solved) {
    state.current.elapsed = currentElapsed();
    state.current.startedAt = Date.now();
  }
}

function render() {
  const level = state.level;
  const puzzle = puzzles[level - 1];
  levelSelect.value = String(level);
  levelLabel.textContent = `${level} / ${TOTAL_LEVELS}`;
  difficultyLabel.textContent = puzzle.difficulty;
  hintState.textContent = state.current.hintUsed ? "0" : "1";
  hintBtn.disabled = state.current.hintUsed || state.current.solved;
  prevBtn.disabled = level === 1;
  nextBtn.disabled = level === TOTAL_LEVELS;

  cells.forEach((cell, index) => {
    const value = state.current.values[index];
    cell.textContent = value ? String(value) : "";
    cell.className = "cell";
    if (state.current.givens[index]) cell.classList.add("given");
  });
  updateSelection();
  renderTimer(currentElapsed());
  renderRanks();
  renderProgress();
}

function updateSelection() {
  const selectedValue = state.current.values[selectedIndex];
  const row = Math.floor(selectedIndex / 9);
  const col = selectedIndex % 9;
  const matchingLines = new Set();

  if (selectedValue) {
    state.current.values.forEach((value, index) => {
      if (value !== selectedValue) return;
      const matchRow = Math.floor(index / 9);
      const matchCol = index % 9;
      for (let i = 0; i < 9; i += 1) {
        matchingLines.add(matchRow * 9 + i);
        matchingLines.add(i * 9 + matchCol);
      }
    });
  }

  cells.forEach((cell, index) => {
    const sameRow = Math.floor(index / 9) === row;
    const sameCol = index % 9 === col;
    const sameBox = Math.floor(index / 27) === Math.floor(selectedIndex / 27)
      && Math.floor((index % 9) / 3) === Math.floor(col / 3);
    cell.classList.toggle("number-line", matchingLines.has(index) && index !== selectedIndex);
    cell.classList.toggle("selected", index === selectedIndex);
    cell.classList.toggle("related", index !== selectedIndex && (sameRow || sameCol || sameBox));
    cell.classList.toggle("same", Boolean(selectedValue) && state.current.values[index] === selectedValue);
  });
}

function placeNumber(value) {
  if (selectedIndex < 0 || state.current.solved || state.current.givens[selectedIndex]) return;
  state.current.values[selectedIndex] = value;
  cells[selectedIndex].textContent = value ? String(value) : "";
  cells[selectedIndex].classList.remove("error");
  persistElapsed();
  saveState();
  updateSelection();
  if (isFilled()) judgeFilledBoard();
}

function moveSelection(key) {
  if (selectedIndex < 0) selectedIndex = 0;
  const row = Math.floor(selectedIndex / 9);
  const col = selectedIndex % 9;
  if (key === "ArrowUp") selectedIndex = ((row + 8) % 9) * 9 + col;
  if (key === "ArrowDown") selectedIndex = ((row + 1) % 9) * 9 + col;
  if (key === "ArrowLeft") selectedIndex = row * 9 + ((col + 8) % 9);
  if (key === "ArrowRight") selectedIndex = row * 9 + ((col + 1) % 9);
  updateSelection();
}

function useHint() {
  if (state.current.hintUsed || state.current.solved) return;
  const solution = puzzles[state.level - 1].solution;
  let index = state.current.values.findIndex((value, i) => !value || value !== solution[i]);
  if (index < 0) return;
  state.current.values[index] = solution[index];
  state.current.hintUsed = true;
  selectedIndex = index;
  persistElapsed();
  saveState();
  render();
  cells[index].classList.add("hint");
  setMessage("提示已使用，本关剩余提示 0 次。");
  if (isFilled()) judgeFilledBoard();
}

function checkBoard() {
  const errors = markErrors();
  setMessage(errors ? `发现 ${errors} 个不匹配的格子。` : "目前填写都正确。");
}

function isComplete() {
  const solution = puzzles[state.level - 1].solution;
  return state.current.values.every((value, index) => value === solution[index]);
}

function isFilled() {
  return state.current.values.every(Boolean);
}

function judgeFilledBoard() {
  if (isComplete()) {
    finishLevel();
    return;
  }
  const errors = markErrors();
  setMessage(`还差一点点：填满了，但有 ${errors} 个格子不正确，请修改后再试。`);
}

function markErrors() {
  const solution = puzzles[state.level - 1].solution;
  let errors = 0;
  cells.forEach((cell, index) => {
    const hasError = Boolean(state.current.values[index]) && state.current.values[index] !== solution[index];
    cell.classList.toggle("error", hasError);
    if (hasError) errors += 1;
  });
  return errors;
}

function finishLevel() {
  if (state.current.solved) return;
  persistElapsed();
  state.current.solved = true;
  state.completed[state.level] = Math.min(state.completed[state.level] || Infinity, state.current.elapsed);
  pendingCompletion = { level: state.level, seconds: state.current.elapsed };
  saveState();
  render();
  const isFinalLevel = state.level >= TOTAL_LEVELS;
  completeTitle.textContent = isFinalLevel ? "全部通关成功！" : `闯关成功！第 ${state.level} 关完成`;
  rewardBadge.textContent = isFinalLevel ? "★ 全部通关奖励 ★" : "★ WJK 奖励星光 ★";
  completeText.textContent = isFinalLevel
    ? `最终用时 ${formatTime(state.current.elapsed)}，可以保存到排行榜。`
    : `用时 ${formatTime(state.current.elapsed)}，保存成绩后可以进入第 ${state.level + 1} 关。`;
  nextLevelBtn.textContent = isFinalLevel ? "已全部通关" : `进入第 ${state.level + 1} 关`;
  nextLevelBtn.disabled = isFinalLevel;
  setMessage(isFinalLevel ? "恭喜全部通关！" : `闯关成功！可以进入第 ${state.level + 1} 关。`);
  if (!completeDialog.open) completeDialog.showModal();
}

function savePendingRank() {
  if (!pendingCompletion) return;
  const name = (playerName.value || "玩家").trim().slice(0, 16) || "玩家";
  const key = String(pendingCompletion.level);
  const list = ranks[key] || [];
  list.push({ name, seconds: pendingCompletion.seconds, at: new Date().toISOString() });
  ranks[key] = list.sort((a, b) => a.seconds - b.seconds).slice(0, 10);
  saveRanks();
  pendingCompletion = null;
  renderRanks();
}

function renderRanks() {
  const entries = rankMode.value === "level" ? levelRanks() : globalRanks();
  rankList.innerHTML = "";
  if (!entries.length) {
    const item = document.createElement("li");
    item.textContent = "还没有成绩。";
    rankList.append(item);
    return;
  }
  entries.slice(0, 10).forEach((entry) => {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${escapeHtml(entry.name)}</strong> ${formatTime(entry.seconds)} <span>${entry.label}</span>`;
    rankList.append(item);
  });
}

function levelRanks() {
  return (ranks[String(state.level)] || []).map((entry) => ({ ...entry, label: `第 ${state.level} 关` }));
}

function globalRanks() {
  return Object.entries(ranks)
    .flatMap(([level, list]) => list.map((entry) => ({ ...entry, label: `第 ${level} 关` })))
    .sort((a, b) => a.seconds - b.seconds);
}

function renderProgress() {
  const done = Object.keys(state.completed || {}).length;
  progressLabel.textContent = `${done} / ${TOTAL_LEVELS}`;
  progressBar.style.width = `${(done / TOTAL_LEVELS) * 100}%`;
}

function renderTimer(seconds) {
  timerEl.textContent = formatTime(seconds);
}

function setMessage(text) {
  messageEl.textContent = text;
}

function setPaintMode(enabled, eraser) {
  paintMode = enabled;
  eraserMode = Boolean(eraser);
  canvas.classList.toggle("enabled", paintMode);
  paintBtn.setAttribute("aria-pressed", String(paintMode && !eraserMode));
  eraserBtn.setAttribute("aria-pressed", String(paintMode && eraserMode));
  setMessage(paintMode ? (eraserMode ? "橡皮已开启，可擦除标注。" : "画笔已开启，可直接在棋盘上标注。") : "画笔已关闭。");
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const snapshot = document.createElement("canvas");
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  snapshot.getContext("2d").drawImage(canvas, 0, 0);
  canvas.width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio));
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  if (snapshot.width && snapshot.height) {
    ctx.drawImage(snapshot, 0, 0, rect.width, rect.height);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function startStroke(event) {
  if (!paintMode) return;
  isDrawing = true;
  canvas.setPointerCapture(event.pointerId);
  const point = pointerPoint(event);
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  drawStroke(event);
}

function drawStroke(event) {
  if (!isDrawing || !paintMode) return;
  event.preventDefault();
  const point = pointerPoint(event);
  ctx.globalCompositeOperation = eraserMode ? "destination-out" : "source-over";
  ctx.strokeStyle = "rgba(217, 79, 53, 0.78)";
  ctx.lineWidth = eraserMode ? 20 : 4;
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function endStroke(event) {
  if (!isDrawing) return;
  isDrawing = false;
  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch {
    /* Pointer capture may already be released by the browser. */
  }
}

function clearPaint() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function toggleMusic() {
  if (musicOn) {
    stopMusic();
    return;
  }
  startMusic();
}

function startMusic() {
  if (!audioCtx) setupAudio();
  audioCtx.resume();
  musicOn = true;
  musicBtn.setAttribute("aria-pressed", "true");
  musicBtn.textContent = "音乐开";
  musicStep = 0;
  playMusicStep();
  musicTimer = setInterval(playMusicStep, 230);
  setMessage("背景音乐已开启。");
}

function stopMusic() {
  musicOn = false;
  clearInterval(musicTimer);
  musicBtn.setAttribute("aria-pressed", "false");
  musicBtn.textContent = "音乐";
  setMessage("背景音乐已关闭。");
}

function setupAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  delayNode = audioCtx.createDelay();
  const feedback = audioCtx.createGain();
  const delayGain = audioCtx.createGain();

  masterGain.gain.value = 0.09;
  delayNode.delayTime.value = 0.18;
  feedback.gain.value = 0.22;
  delayGain.gain.value = 0.16;

  delayNode.connect(feedback);
  feedback.connect(delayNode);
  delayNode.connect(delayGain);
  masterGain.connect(audioCtx.destination);
  delayGain.connect(audioCtx.destination);
}

function playMusicStep() {
  if (!musicOn || !audioCtx) return;
  const melody = [
    523.25, 659.25, 783.99, 659.25,
    587.33, 698.46, 880.00, 783.99,
    659.25, 783.99, 987.77, 880.00,
    783.99, 659.25, 587.33, 523.25
  ];
  const bass = [261.63, 261.63, 349.23, 349.23, 392.00, 392.00, 329.63, 329.63];
  const note = melody[musicStep % melody.length];
  const bassNote = bass[Math.floor(musicStep / 2) % bass.length];

  playTone(note, 0.18, "triangle", 0.75);
  if (musicStep % 2 === 0) playTone(bassNote, 0.32, "sine", 0.42);
  if (musicStep % 4 === 3) playTone(note * 1.5, 0.12, "sine", 0.24);
  musicStep += 1;
}

function playTone(frequency, duration, type, gainScale) {
  const now = audioCtx.currentTime;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainScale, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  oscillator.connect(gain);
  gain.connect(masterGain);
  gain.connect(delayNode);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.03);
}

function makePuzzle(level) {
  const seed = 4919 + level * 7919;
  const rng = mulberry32(seed);
  const solution = makeSolvedGrid(rng);
  const givensTarget = givensForLevel(level);
  const givens = solution.slice();
  const pairs = shuffle(Array.from({ length: 41 }, (_, i) => i), rng);
  let filled = 81;

  for (const index of pairs) {
    if (filled <= givensTarget) break;
    const mirror = 80 - index;
    const removed = index === mirror ? 1 : 2;
    if (filled - removed < givensTarget) continue;
    const previousA = givens[index];
    const previousB = givens[mirror];
    givens[index] = 0;
    givens[mirror] = 0;
    if (!hasUniqueSolution(givens)) {
      givens[index] = previousA;
      givens[mirror] = previousB;
      continue;
    }
    filled -= removed;
  }

  return {
    level,
    solution,
    givens,
    difficulty: difficultyForLevel(level)
  };
}

function makeSolvedGrid(rng) {
  const base = Array.from({ length: 81 }, (_, i) => pattern(Math.floor(i / 9), i % 9) + 1);
  const rows = shuffleBands(rng);
  const cols = shuffleBands(rng);
  const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
  return Array.from({ length: 81 }, (_, i) => {
    const r = rows[Math.floor(i / 9)];
    const c = cols[i % 9];
    return nums[base[r * 9 + c] - 1];
  });
}

function pattern(row, col) {
  return (row * 3 + Math.floor(row / 3) + col) % 9;
}

function shuffleBands(rng) {
  return shuffle([0, 1, 2], rng)
    .flatMap((band) => shuffle([0, 1, 2], rng).map((row) => band * 3 + row));
}

function givensForLevel(level) {
  const t = (level - 1) / (TOTAL_LEVELS - 1);
  return Math.round(46 - t * 20);
}

function difficultyForLevel(level) {
  if (level <= 20) return "入门";
  if (level <= 45) return "进阶";
  if (level <= 70) return "困难";
  if (level <= 90) return "专家";
  return "大师";
}

function shuffle(items, rng) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function mulberry32(seed) {
  return function rand() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hasUniqueSolution(values) {
  const grid = values.slice();
  return countSolutions(grid, 2) === 1;
}

function countSolutions(grid, limit) {
  let bestIndex = -1;
  let bestOptions = null;

  for (let i = 0; i < 81; i += 1) {
    if (grid[i]) continue;
    const options = candidatesFor(grid, i);
    if (!options.length) return 0;
    if (!bestOptions || options.length < bestOptions.length) {
      bestOptions = options;
      bestIndex = i;
      if (options.length === 1) break;
    }
  }

  if (bestIndex < 0) return 1;

  let count = 0;
  for (const value of bestOptions) {
    grid[bestIndex] = value;
    count += countSolutions(grid, limit - count);
    grid[bestIndex] = 0;
    if (count >= limit) return count;
  }
  return count;
}

function candidatesFor(grid, index) {
  const row = Math.floor(index / 9);
  const col = index % 9;
  const used = new Set();

  for (let i = 0; i < 9; i += 1) {
    used.add(grid[row * 9 + i]);
    used.add(grid[i * 9 + col]);
  }

  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      used.add(grid[(boxRow + r) * 9 + boxCol + c]);
    }
  }

  const options = [];
  for (let value = 1; value <= 9; value += 1) {
    if (!used.has(value)) options.push(value);
  }
  return options;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
