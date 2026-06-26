/* 爆発チェーンスイカ — 合体すると衝撃波で周囲を吹き飛ばし、連鎖でコンボを稼ぐ */
(() => {
  'use strict';

  const { Engine, Render, Runner, World, Bodies, Body, Events, Composite } = Matter;

  const FRUITS = [
    { name: 'さくらんぼ', emoji: '🍒', radius: 16, color: '#e63946', score: 1 },
    { name: 'いちご',     emoji: '🍓', radius: 22, color: '#ff5d73', score: 3 },
    { name: 'ぶどう',     emoji: '🍇', radius: 30, color: '#7b2cbf', score: 6 },
    { name: 'みかん',     emoji: '🍊', radius: 38, color: '#fb8500', score: 10 },
    { name: 'りんご',     emoji: '🍎', radius: 48, color: '#d00000', score: 15 },
    { name: 'なし',       emoji: '🍐', radius: 58, color: '#9ef01a', score: 21 },
    { name: 'もも',       emoji: '🍑', radius: 70, color: '#ff9eb5', score: 28 },
    { name: 'パイナップル', emoji: '🍍', radius: 84, color: '#ffd000', score: 36 },
    { name: 'ココナッツ', emoji: '🥥', radius: 98, color: '#8d6346', score: 45 },
    { name: 'メロン',     emoji: '🍈', radius: 116, color: '#80b918', score: 55 },
    { name: 'スイカ',     emoji: '🍉', radius: 138, color: '#2d6a4f', score: 66 },
  ];

  const BASE_W = 400;
  const BASE_H = 560;
  const WALL = 14;
  const DEAD_LINE = 80;
  const COMBO_WINDOW = 750; // この時間内に次の合体が起きれば連鎖カウント(ms)

  const canvas = document.getElementById('game');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const nextFruitEl = document.getElementById('next-fruit');
  const nextNameEl = document.getElementById('next-name');
  const overlay = document.getElementById('overlay');
  const comboEl = document.getElementById('combo');
  const startBtn = document.getElementById('start');

  let scale = 1;
  function computeScale() {
    const maxW = Math.min(window.innerWidth - 24, 420);
    const maxH = window.innerHeight - 210;
    scale = Math.min(maxW / BASE_W, maxH / BASE_H, 1);
    scale = Math.max(scale, 0.5);
  }
  computeScale();

  const W = BASE_W, H = BASE_H;

  const engine = Engine.create();
  engine.gravity.y = 1.1;
  const world = engine.world;

  const render = Render.create({
    canvas, engine,
    options: { width: W, height: H, wireframes: false, background: 'transparent', pixelRatio: window.devicePixelRatio || 1 },
  });

  function applyScale() {
    computeScale();
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
  }
  applyScale();

  Render.run(render);
  Runner.run(Runner.create(), engine);

  const wallOpts = { isStatic: true, render: { fillStyle: '#7a3b18' }, restitution: 0.1 };
  World.add(world, [
    Bodies.rectangle(W / 2, H - WALL / 2, W, WALL, wallOpts),
    Bodies.rectangle(WALL / 2, H / 2, WALL, H, wallOpts),
    Bodies.rectangle(W - WALL / 2, H / 2, WALL, H, wallOpts),
  ]);

  let score = 0;
  let best = Number(localStorage.getItem('boom_best') || 0);
  let currentIndex = randomDropIndex();
  let nextIndex = randomDropIndex();
  let dropX = W / 2;
  let canDrop = false;
  let started = false;
  let gameOver = false;
  let pendingBody = null;
  let overflowTimer = 0;

  let comboCount = 0;
  let lastMergeAt = -1e9;
  let comboScale = 1;

  bestEl.textContent = best;
  updateNextUI();

  function now() { return performance.now(); }

  function randomDropIndex() {
    const r = Math.random();
    if (r < 0.4) return 0;
    if (r < 0.7) return 1;
    if (r < 0.88) return 2;
    if (r < 0.97) return 3;
    return 4;
  }

  function updateNextUI() {
    const f = FRUITS[nextIndex];
    nextFruitEl.textContent = f.emoji;
    nextNameEl.textContent = f.name;
  }

  function makeFruit(index, x, y, isStatic = false) {
    const f = FRUITS[index];
    const body = Bodies.circle(x, y, f.radius, {
      isStatic, restitution: 0.2, friction: 0.4, frictionStatic: 0.6, density: 0.001,
      label: 'fruit',
      render: { fillStyle: f.color, strokeStyle: 'rgba(0,0,0,0.15)', lineWidth: 2 },
    });
    body.fruitIndex = index;
    body.merged = false;
    return body;
  }

  function clampX(x, index) {
    const r = FRUITS[index].radius;
    return Math.max(WALL + r, Math.min(W - WALL - r, x));
  }

  function preparePending() {
    const f = FRUITS[currentIndex];
    dropX = clampX(dropX, currentIndex);
    pendingBody = makeFruit(currentIndex, dropX, DEAD_LINE - 10, true);
    pendingBody.isPending = true;
    World.add(world, pendingBody);
  }

  function drop() {
    if (!canDrop || gameOver || !pendingBody || !started) return;
    canDrop = false;
    const idx = pendingBody.fruitIndex;
    const x = pendingBody.position.x;
    World.remove(world, pendingBody);
    pendingBody = null;

    World.add(world, makeFruit(idx, x, DEAD_LINE - 10, false));

    currentIndex = nextIndex;
    nextIndex = randomDropIndex();
    updateNextUI();

    setTimeout(() => {
      if (gameOver) return;
      canDrop = true;
      preparePending();
    }, 480);
  }

  // --- 合体 + 爆発 ---
  Events.on(engine, 'collisionStart', (ev) => {
    if (gameOver) return;
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.label !== 'fruit' || b.label !== 'fruit') continue;
      if (a.merged || b.merged) continue;
      if (a.fruitIndex !== b.fruitIndex) continue;
      if (a.fruitIndex >= FRUITS.length - 1) continue;

      a.merged = true; b.merged = true;
      const newIndex = a.fruitIndex + 1;
      const mx = (a.position.x + b.position.x) / 2;
      const my = (a.position.y + b.position.y) / 2;

      World.remove(world, a);
      World.remove(world, b);
      const merged = makeFruit(newIndex, mx, my, false);
      World.add(world, merged);

      // コンボ計算
      const t = now();
      if (t - lastMergeAt < COMBO_WINDOW) comboCount++;
      else comboCount = 1;
      lastMergeAt = t;

      const gained = FRUITS[newIndex].score * comboCount;
      addScore(gained);
      if (newIndex === FRUITS.length - 1) addScore(100); // スイカ完成ボーナス

      // 爆発（衝撃波）。大きいフルーツほど強く、コンボでさらに強化
      const power = (2.4 + newIndex * 0.6) * (1 + (comboCount - 1) * 0.35);
      const radius = FRUITS[newIndex].radius * 3.2 + 40;
      explode(mx, my, power, radius, merged);

      spawnRing(mx, my, radius, FRUITS[newIndex].color);
      spawnSparks(mx, my, FRUITS[newIndex].color, 10 + newIndex);
      showCombo();
    }
  });

  function explode(x, y, power, radius, exclude) {
    const bodies = Composite.allBodies(world);
    for (const b of bodies) {
      if (b.label !== 'fruit' || b.isPending || b.isStatic || b === exclude) continue;
      const dx = b.position.x - x;
      const dy = b.position.y - y;
      const dist = Math.hypot(dx, dy) || 0.001;
      if (dist > radius) continue;
      const falloff = 1 - dist / radius;        // 近いほど強い
      const boost = power * falloff;
      // 上向きに飛びすぎないよう、上方向は少し抑える
      const ny = dy / dist;
      const damp = ny < 0 ? 0.7 : 1;
      Body.setVelocity(b, {
        x: b.velocity.x + (dx / dist) * boost,
        y: b.velocity.y + ny * boost * damp,
      });
      Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.3);
    }
  }

  function addScore(pts) {
    score += pts;
    scoreEl.textContent = score;
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem('boom_best', best);
    }
  }

  // --- コンボ表示 ---
  function showCombo() {
    if (comboCount < 2) return;
    comboEl.textContent = `${comboCount} CHAIN!`;
    comboEl.style.opacity = '1';
    comboScale = 1.5;
  }

  // --- エフェクト ---
  const rings = [];
  const sparks = [];
  function spawnRing(x, y, max, color) {
    rings.push({ x, y, r: max * 0.15, max, life: 1, color });
  }
  function spawnSparks(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 5;
      sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, color });
    }
  }

  Events.on(render, 'afterRender', () => {
    const ctx = render.context;

    // デッドライン
    ctx.save();
    ctx.strokeStyle = 'rgba(255,120,60,0.6)';
    ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(WALL, DEAD_LINE); ctx.lineTo(W - WALL, DEAD_LINE); ctx.stroke();
    ctx.restore();

    // フルーツ絵文字
    const bodies = Composite.allBodies(world);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const body of bodies) {
      if (body.label !== 'fruit') continue;
      const f = FRUITS[body.fruitIndex];
      const size = f.radius * 1.7;
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.font = `${size}px serif`;
      ctx.globalAlpha = body.isPending ? 0.85 : 1;
      ctx.fillText(f.emoji, 0, size * 0.05);
      ctx.restore();
    }
    ctx.restore();

    // 落下ガイド
    if (pendingBody && canDrop && !gameOver) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,180,120,0.3)';
      ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(pendingBody.position.x, DEAD_LINE);
      ctx.lineTo(pendingBody.position.x, H - WALL);
      ctx.stroke();
      ctx.restore();
    }

    // 爆発リング
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      ctx.save();
      ctx.globalAlpha = Math.max(r.life, 0) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 4 * r.life + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
      // 内側の白い閃光
      ctx.globalAlpha = Math.max(r.life, 0) * 0.5;
      ctx.strokeStyle = 'rgba(255,240,210,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      r.r += (r.max - r.r) * 0.25;
      r.life -= 0.05;
      if (r.life <= 0) rings.splice(i, 1);
    }

    // 火花
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * p.life + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.vx *= 0.98; p.life -= 0.035;
      if (p.life <= 0) sparks.splice(i, 1);
    }
  });

  // コンボ表示の減衰
  Events.on(engine, 'afterUpdate', () => {
    // コンボのポップ演出
    if (comboScale > 1) {
      comboScale += (1 - comboScale) * 0.2;
      comboEl.style.transform = `translateX(-50%) scale(${comboScale.toFixed(3)})`;
    }
    if (comboCount >= 2 && now() - lastMergeAt > COMBO_WINDOW) {
      comboEl.style.opacity = '0';
    }
  });

  // --- ゲームオーバー判定 ---
  Events.on(engine, 'afterUpdate', () => {
    if (gameOver || !started) return;
    const dt = engine.timing.lastDelta || 16.6;
    const bodies = Composite.allBodies(world);
    let over = false;
    for (const body of bodies) {
      if (body.label !== 'fruit' || body.isPending || body.isStatic) continue;
      const top = body.position.y - FRUITS[body.fruitIndex].radius;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (top < DEAD_LINE && speed < 0.6) { over = true; break; }
    }
    if (over) {
      overflowTimer += dt;
      if (overflowTimer > 1500) endGame();
    } else {
      overflowTimer = Math.max(0, overflowTimer - dt * 2);
    }
  });

  function endGame() {
    gameOver = true;
    canDrop = false;
    started = false;
    overlay.querySelector('h1').textContent = '💥 ゲームオーバー';
    overlay.querySelector('p').innerHTML = `スコア: <b>${score}</b>　/　ベスト: <b>${best}</b>`;
    startBtn.textContent = 'もう一度あそぶ';
    overlay.classList.remove('hidden');
  }

  function startGame() {
    // リセット
    for (const body of Composite.allBodies(world)) {
      if (body.label === 'fruit') World.remove(world, body);
    }
    rings.length = 0; sparks.length = 0;
    score = 0; overflowTimer = 0; comboCount = 0; lastMergeAt = -1e9;
    scoreEl.textContent = '0';
    comboEl.style.opacity = '0';
    gameOver = false;
    started = true;
    currentIndex = randomDropIndex();
    nextIndex = randomDropIndex();
    dropX = W / 2;
    updateNextUI();
    overlay.classList.add('hidden');
    preparePending();
    canDrop = true;
  }

  startBtn.addEventListener('click', startGame);

  // --- 入力 ---
  function pointerXToWorld(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) / rect.width * W;
  }
  function moveTo(clientX) {
    if (!pendingBody || !canDrop || gameOver) return;
    const x = clampX(pointerXToWorld(clientX), pendingBody.fruitIndex);
    dropX = x;
    Body.setPosition(pendingBody, { x, y: pendingBody.position.y });
  }

  let pointerDown = false;
  canvas.addEventListener('pointerdown', (e) => { pointerDown = true; moveTo(e.clientX); });
  canvas.addEventListener('pointermove', (e) => { if (pointerDown) moveTo(e.clientX); });
  canvas.addEventListener('pointerup', (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    moveTo(e.clientX);
    drop();
  });
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });

  window.addEventListener('keydown', (e) => {
    if (!started) {
      if (e.key === 'Enter' || e.key === ' ') startGame();
      return;
    }
    if (!pendingBody) return;
    const step = 18;
    if (e.key === 'ArrowLeft') { Body.setPosition(pendingBody, { x: clampX(pendingBody.position.x - step, pendingBody.fruitIndex), y: pendingBody.position.y }); dropX = pendingBody.position.x; }
    else if (e.key === 'ArrowRight') { Body.setPosition(pendingBody, { x: clampX(pendingBody.position.x + step, pendingBody.fruitIndex), y: pendingBody.position.y }); dropX = pendingBody.position.x; }
    else if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); drop(); }
  });

  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('resize', applyScale);
})();
