/* ヘビゲーム — 依存なしのCanvas実装。キーボード・スワイプ・画面ボタン対応 */
(() => {
  'use strict';

  const COLS = 20;            // グリッドの列数
  const ROWS = 20;            // グリッドの行数
  const BASE_SPEED = 160;     // 1マス進む間隔(ms)。スコアで加速
  const MIN_SPEED = 70;       // 最速時の間隔(ms)

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovMsg = document.getElementById('ov-msg');
  const startBtn = document.getElementById('start');

  // --- 画面サイズに合わせてセルサイズを決定 ---
  let cell = 18;
  function computeSize() {
    const maxW = Math.min(window.innerWidth - 24, 460);
    const maxH = window.innerHeight - 320; // HUD・dpad・ヒント分を確保
    const size = Math.max(140, Math.min(maxW, maxH));
    cell = Math.floor(size / COLS);
    cell = Math.max(cell, 8);
    const px = cell * COLS;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = px * dpr;
    canvas.height = cell * ROWS * dpr;
    canvas.style.width = px + 'px';
    canvas.style.height = (cell * ROWS) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  // --- 状態 ---
  let snake, dir, nextDir, food, score, best, alive, paused, started, timer;
  best = Number(localStorage.getItem('snake_best') || 0);
  bestEl.textContent = best;

  function reset() {
    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2);
    snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score = 0;
    alive = true;
    paused = false;
    scoreEl.textContent = '0';
    placeFood();
  }

  function placeFood() {
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
      }
    }
    if (free.length === 0) { winGame(); return; }
    food = free[Math.floor(Math.random() * free.length)];
  }

  function currentSpeed() {
    // 食べるほど速くなる（下限あり）
    const step = Math.min(score, (BASE_SPEED - MIN_SPEED));
    return Math.max(MIN_SPEED, BASE_SPEED - step * 4);
  }

  function scheduleTick() {
    clearTimeout(timer);
    if (!alive || paused || !started) return;
    timer = setTimeout(tick, currentSpeed());
  }

  function tick() {
    step();
    draw();
    scheduleTick();
  }

  function step() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // 壁判定
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      return gameOver();
    }
    // 自分判定（最後尾は動くので一致しても可、ただし食べた直後は伸びるので厳密に）
    const willGrow = head.x === food.x && head.y === food.y;
    const body = willGrow ? snake : snake.slice(0, -1);
    if (body.some((s) => s.x === head.x && s.y === head.y)) {
      return gameOver();
    }

    snake.unshift(head);
    if (willGrow) {
      score += 1;
      scoreEl.textContent = score;
      if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('snake_best', best);
      }
      placeFood();
    } else {
      snake.pop();
    }
  }

  // --- 描画 ---
  function draw() {
    const w = cell * COLS;
    const h = cell * ROWS;
    // 背景の市松模様
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#11241a' : '#0e2018';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    if (!snake) return;

    // エサ
    drawCellEmoji(food.x, food.y, '🍎');

    // ヘビ本体
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      const t = i / Math.max(snake.length - 1, 1);
      const g = Math.floor(252 - t * 90);
      ctx.fillStyle = i === 0 ? '#aef7c2' : `rgb(60, ${g}, 110)`;
      roundRect(s.x * cell + 1, s.y * cell + 1, cell - 2, cell - 2, Math.max(3, cell * 0.22));
      ctx.fill();
    }

    // 目（頭）
    const head = snake[0];
    const hx = head.x * cell;
    const hy = head.y * cell;
    ctx.fillStyle = '#0c1a12';
    const eo = cell * 0.28; // 目のオフセット
    const er = Math.max(1.4, cell * 0.09);
    // 進行方向に応じて目を配置
    const ex = dir.x !== 0 ? (dir.x > 0 ? cell * 0.65 : cell * 0.35) : cell * 0.5;
    const offs = dir.x !== 0
      ? [{ dx: ex, dy: cell * 0.32 }, { dx: ex, dy: cell * 0.68 }]
      : [{ dx: cell * 0.32, dy: dir.y > 0 ? cell * 0.65 : cell * 0.35 }, { dx: cell * 0.68, dy: dir.y > 0 ? cell * 0.65 : cell * 0.35 }];
    for (const o of offs) {
      ctx.beginPath();
      ctx.arc(hx + o.dx, hy + o.dy, er, 0, Math.PI * 2);
      ctx.fill();
    }

    void eo;
  }

  function drawCellEmoji(x, y, emoji) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.floor(cell * 0.8)}px serif`;
    ctx.fillText(emoji, x * cell + cell / 2, y * cell + cell / 2 + cell * 0.04);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // --- ゲーム進行 ---
  function startGame() {
    reset();
    started = true;
    overlay.classList.add('hidden');
    draw();
    scheduleTick();
  }

  function gameOver() {
    alive = false;
    started = false;
    clearTimeout(timer);
    ovTitle.textContent = '💥 ゲームオーバー';
    ovMsg.innerHTML = `スコア: <b>${score}</b>　/　ベスト: <b>${best}</b>`;
    startBtn.textContent = 'もう一度あそぶ';
    overlay.classList.remove('hidden');
  }

  function winGame() {
    alive = false;
    started = false;
    clearTimeout(timer);
    ovTitle.textContent = '🏆 クリア！';
    ovMsg.innerHTML = `全マス制覇！　スコア: <b>${score}</b>`;
    startBtn.textContent = 'もう一度あそぶ';
    overlay.classList.remove('hidden');
  }

  function togglePause() {
    if (!started || !alive) return;
    paused = !paused;
    if (paused) {
      clearTimeout(timer);
      ovTitle.textContent = '⏸ 一時停止';
      ovMsg.innerHTML = 'つづける には下のボタンを押してね';
      startBtn.textContent = 'つづける';
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
      scheduleTick();
    }
  }

  // --- 入力 ---
  function setDir(x, y) {
    if (!started || !alive || paused) return;
    // 逆方向には進めない
    if (x === -dir.x && y === -dir.y) return;
    // 同フレームで複数回入力されても、直前方向の反対は無効
    if (x === -nextDir.x && y === -nextDir.y && (nextDir.x !== dir.x || nextDir.y !== dir.y)) return;
    nextDir = { x, y };
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') { setDir(0, -1); e.preventDefault(); }
    else if (k === 'arrowdown' || k === 's') { setDir(0, 1); e.preventDefault(); }
    else if (k === 'arrowleft' || k === 'a') { setDir(-1, 0); e.preventDefault(); }
    else if (k === 'arrowright' || k === 'd') { setDir(1, 0); e.preventDefault(); }
    else if (k === ' ') { e.preventDefault(); if (!started) startGame(); else togglePause(); }
    else if (k === 'enter' && !started) startGame();
  });

  // 画面ボタン
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  };
  bind('up', () => setDir(0, -1));
  bind('down', () => setDir(0, 1));
  bind('left', () => setDir(-1, 0));
  bind('right', () => setDir(1, 0));
  bind('pause', () => { if (!started) startGame(); else togglePause(); });

  // スワイプ
  let touchStart = null;
  canvas.addEventListener('pointerdown', (e) => {
    touchStart = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) {
      // タップ: 未開始ならスタート
      if (!started) startGame();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
    else setDir(0, dy > 0 ? 1 : -1);
  });

  startBtn.addEventListener('click', () => {
    if (paused) { togglePause(); return; }
    startGame();
  });

  window.addEventListener('resize', computeSize);

  // 初期化
  reset();
  started = false;
  computeSize();
})();
