/* スイカゲーム — Matter.js を使ったフルーツ合体ゲーム */
(() => {
  'use strict';

  const { Engine, Render, Runner, World, Bodies, Body, Events, Composite } = Matter;

  // --- フルーツ定義（小さい順に進化） ---
  // radius は基準サイズ。score は合体時に加算される点数。
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

  // 落とせるのは小さめのフルーツだけ（index 0..4）
  const DROPPABLE_MAX = 4;

  // --- ステージ寸法（基準値、後でスケール） ---
  const BASE_W = 400;
  const BASE_H = 560;
  const WALL = 14;          // 壁の厚み
  const DEAD_LINE = 80;     // 上端からのデッドライン位置（この線を超え続けるとアウト）

  const canvas = document.getElementById('game');
  const wrap = document.getElementById('stage-wrap');

  // 画面サイズに合わせてスケール決定
  let scale = 1;
  function computeScale() {
    const maxW = Math.min(window.innerWidth - 24, 420);
    const maxH = window.innerHeight - 210; // HUD・ヒント分を差し引く
    scale = Math.min(maxW / BASE_W, maxH / BASE_H, 1);
    scale = Math.max(scale, 0.5);
  }
  computeScale();

  const W = BASE_W;
  const H = BASE_H;

  const engine = Engine.create();
  engine.gravity.y = 1.1;
  const world = engine.world;

  const render = Render.create({
    canvas,
    engine,
    options: {
      width: W,
      height: H,
      wireframes: false,
      background: 'transparent',
      pixelRatio: window.devicePixelRatio || 1,
    },
  });

  function applyScale() {
    computeScale();
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
  }
  applyScale();

  Render.run(render);
  const runner = Runner.create();
  Runner.run(runner, engine);

  // --- 壁・床 ---
  const wallOpts = { isStatic: true, render: { fillStyle: '#b5651d' }, restitution: 0.1 };
  const floor = Bodies.rectangle(W / 2, H - WALL / 2, W, WALL, wallOpts);
  const leftWall = Bodies.rectangle(WALL / 2, H / 2, WALL, H, wallOpts);
  const rightWall = Bodies.rectangle(W - WALL / 2, H / 2, WALL, H, wallOpts);
  World.add(world, [floor, leftWall, rightWall]);

  // --- 状態 ---
  let score = 0;
  let best = Number(localStorage.getItem('suika_best') || 0);
  let currentIndex = randomDropIndex();
  let nextIndex = randomDropIndex();
  let dropX = W / 2;
  let canDrop = true;
  let gameOver = false;
  let pendingBody = null; // プレビュー中のフルーツ
  let overflowTimer = 0;  // デッドライン超過の累積時間

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const nextFruitEl = document.getElementById('next-fruit');
  const nextNameEl = document.getElementById('next-name');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovMsg = document.getElementById('ov-msg');

  bestEl.textContent = best;
  updateNextUI();

  function randomDropIndex() {
    // 落下フルーツは小さいものほど出やすい
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

  // フルーツのボディ生成
  function makeFruit(index, x, y, isStatic = false) {
    const f = FRUITS[index];
    const body = Bodies.circle(x, y, f.radius, {
      isStatic,
      restitution: 0.18,
      friction: 0.4,
      frictionStatic: 0.6,
      density: 0.001,
      label: 'fruit',
      render: {
        fillStyle: f.color,
        strokeStyle: 'rgba(0,0,0,0.15)',
        lineWidth: 2,
      },
    });
    body.fruitIndex = index;
    body.merged = false;
    return body;
  }

  // プレビュー（落下待機）フルーツを用意
  function preparePending() {
    const f = FRUITS[currentIndex];
    const y = DEAD_LINE - 10;
    dropX = clampX(dropX, currentIndex);
    pendingBody = makeFruit(currentIndex, dropX, y, true);
    pendingBody.isPending = true;
    World.add(world, pendingBody);
  }

  function clampX(x, index) {
    const r = FRUITS[index].radius;
    return Math.max(WALL + r, Math.min(W - WALL - r, x));
  }

  function drop() {
    if (!canDrop || gameOver || !pendingBody) return;
    canDrop = false;

    const idx = pendingBody.fruitIndex;
    const x = pendingBody.position.x;
    World.remove(world, pendingBody);
    pendingBody = null;

    const body = makeFruit(idx, x, DEAD_LINE - 10, false);
    World.add(world, body);

    // 次のフルーツへ
    currentIndex = nextIndex;
    nextIndex = randomDropIndex();
    updateNextUI();

    // 落下クールダウン
    setTimeout(() => {
      if (gameOver) return;
      canDrop = true;
      preparePending();
    }, 500);
  }

  // --- 合体処理 ---
  Events.on(engine, 'collisionStart', (ev) => {
    if (gameOver) return;
    for (const pair of ev.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      if (a.label !== 'fruit' || b.label !== 'fruit') continue;
      if (a.merged || b.merged) continue;
      if (a.fruitIndex !== b.fruitIndex) continue;
      if (a.fruitIndex >= FRUITS.length - 1) continue; // スイカ同士は合体しない

      a.merged = true;
      b.merged = true;

      const newIndex = a.fruitIndex + 1;
      const mx = (a.position.x + b.position.x) / 2;
      const my = (a.position.y + b.position.y) / 2;

      World.remove(world, a);
      World.remove(world, b);

      const merged = makeFruit(newIndex, mx, my, false);
      World.add(world, merged);
      // ちょっと弾ませる
      Body.setVelocity(merged, { x: 0, y: -2 });

      addScore(FRUITS[newIndex].score);
      spawnPop(mx, my, FRUITS[newIndex].color);

      if (newIndex === FRUITS.length - 1) {
        // スイカ完成ボーナス
        addScore(100);
      }
    }
  });

  function addScore(pts) {
    score += pts;
    scoreEl.textContent = score;
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem('suika_best', best);
    }
  }

  // --- 合体エフェクト（簡易パーティクル） ---
  const pops = [];
  function spawnPop(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI * 2 * i) / 8;
      pops.push({
        x, y,
        vx: Math.cos(ang) * 3,
        vy: Math.sin(ang) * 3,
        life: 1,
        color,
      });
    }
  }

  // --- カスタム描画（絵文字・デッドライン・パーティクル） ---
  Events.on(render, 'afterRender', () => {
    const ctx = render.context;

    // デッドライン
    ctx.save();
    ctx.strokeStyle = 'rgba(231,111,81,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(WALL, DEAD_LINE);
    ctx.lineTo(W - WALL, DEAD_LINE);
    ctx.stroke();
    ctx.restore();

    // フルーツの上に絵文字を重ねる
    const bodies = Composite.allBodies(world);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
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
      ctx.strokeStyle = 'rgba(90,58,18,0.25)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(pendingBody.position.x, DEAD_LINE);
      ctx.lineTo(pendingBody.position.x, H - WALL);
      ctx.stroke();
      ctx.restore();
    }

    // パーティクル
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 * p.life + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life -= 0.04;
      if (p.life <= 0) pops.splice(i, 1);
    }
  });

  // --- ゲームオーバー判定（デッドライン超過の継続時間で判定） ---
  Events.on(engine, 'afterUpdate', (ev) => {
    if (gameOver) return;
    const dt = engine.timing.lastDelta || 16.6;
    const bodies = Composite.allBodies(world);
    let over = false;
    for (const body of bodies) {
      if (body.label !== 'fruit' || body.isPending) continue;
      if (body.isStatic) continue;
      const top = body.position.y - FRUITS[body.fruitIndex].radius;
      // ほぼ静止していて、デッドラインより上にある場合のみカウント
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (top < DEAD_LINE && speed < 0.6) {
        over = true;
        break;
      }
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
    ovTitle.textContent = 'ゲームオーバー';
    ovMsg.textContent = `スコア: ${score}　/　ベスト: ${best}`;
    overlay.classList.add('show');
  }

  function restart() {
    // フルーツを全消去
    const bodies = Composite.allBodies(world);
    for (const body of bodies) {
      if (body.label === 'fruit') World.remove(world, body);
    }
    pops.length = 0;
    score = 0;
    overflowTimer = 0;
    scoreEl.textContent = '0';
    gameOver = false;
    canDrop = true;
    currentIndex = randomDropIndex();
    nextIndex = randomDropIndex();
    dropX = W / 2;
    updateNextUI();
    overlay.classList.remove('show');
    preparePending();
  }

  document.getElementById('restart').addEventListener('click', restart);

  // --- 入力（マウス・タッチ） ---
  function pointerXToWorld(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * W;
    return x;
  }

  function moveTo(clientX) {
    if (!pendingBody || !canDrop || gameOver) return;
    const x = clampX(pointerXToWorld(clientX), pendingBody.fruitIndex);
    dropX = x;
    Body.setPosition(pendingBody, { x, y: pendingBody.position.y });
  }

  let pointerDown = false;
  canvas.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    moveTo(e.clientX);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointerDown) moveTo(e.clientX);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    moveTo(e.clientX);
    drop();
  });
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });

  // キーボード操作
  window.addEventListener('keydown', (e) => {
    if (gameOver) {
      if (e.key === 'Enter' || e.key === ' ') restart();
      return;
    }
    if (!pendingBody) return;
    const step = 18;
    if (e.key === 'ArrowLeft') {
      Body.setPosition(pendingBody, { x: clampX(pendingBody.position.x - step, pendingBody.fruitIndex), y: pendingBody.position.y });
      dropX = pendingBody.position.x;
    } else if (e.key === 'ArrowRight') {
      Body.setPosition(pendingBody, { x: clampX(pendingBody.position.x + step, pendingBody.fruitIndex), y: pendingBody.position.y });
      dropX = pendingBody.position.x;
    } else if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      drop();
    }
  });

  window.addEventListener('resize', applyScale);

  // 開始
  preparePending();
})();
