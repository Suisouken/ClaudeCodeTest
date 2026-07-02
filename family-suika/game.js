/* かぞくスイカゲーム — 家族の写真で遊ぶスイカゲーム（Matter.js） */
(() => {
  'use strict';

  const { Engine, Render, Runner, World, Bodies, Body, Events, Composite } = Matter;

  // --- 段階定義（小さい順に進化） ---
  // 写真が未設定の段階は emoji で代用する。
  const TIERS = [
    { emoji: '🍒', radius: 16,  color: '#e63946', score: 1 },
    { emoji: '🍓', radius: 22,  color: '#ff5d73', score: 3 },
    { emoji: '🍇', radius: 30,  color: '#7b2cbf', score: 6 },
    { emoji: '🍊', radius: 38,  color: '#fb8500', score: 10 },
    { emoji: '🍎', radius: 48,  color: '#d00000', score: 15 },
    { emoji: '🍐', radius: 58,  color: '#9ef01a', score: 21 },
    { emoji: '🍑', radius: 70,  color: '#ff9eb5', score: 28 },
    { emoji: '🍍', radius: 84,  color: '#ffd000', score: 36 },
    { emoji: '🥥', radius: 98,  color: '#8d6346', score: 45 },
    { emoji: '🍈', radius: 116, color: '#80b918', score: 55 },
    { emoji: '🍉', radius: 138, color: '#2d6a4f', score: 66 },
  ];
  const N = TIERS.length;

  // 落とせるのは小さめの段階だけ（index 0..4）
  const DROPPABLE_MAX = 4;

  // --- デフォルトの家族写真（リポジトリ同梱、小さい順に割り当て） ---
  // 設定画面でアップロードした写真があればそちらが優先される。
  const DEFAULT_PHOTOS = [
    'photos/face2_boy_sunglasses.jpg', // No.1
    'photos/face1_boy_cap.jpg',        // No.2
    'photos/face3_girl.jpg',           // No.3
    'photos/face5_woman.jpg',          // No.4
    'photos/face4_man.jpg',            // No.5
    null, null, null, null, null, null,
  ];

  // --- 写真・名前の保存（localStorage） ---
  const PHOTO_KEY = 'family_suika_photos_v1';
  const NAME_KEY = 'family_suika_names_v1';

  let photoData = [];
  let names = [];
  try { photoData = JSON.parse(localStorage.getItem(PHOTO_KEY) || '[]'); } catch (e) { photoData = []; }
  try { names = JSON.parse(localStorage.getItem(NAME_KEY) || '[]'); } catch (e) { names = []; }
  for (let i = 0; i < N; i++) {
    if (typeof names[i] !== 'string' || !names[i]) names[i] = `レベル${i + 1}`;
  }

  // アップロード写真（dataURL）＞ デフォルト写真 ＞ なし
  function photoSrc(i) {
    return photoData[i] || DEFAULT_PHOTOS[i] || null;
  }

  const photoImgs = new Array(N).fill(null);
  function reloadPhotoImg(i) {
    const src = photoSrc(i);
    if (src) {
      const img = new Image();
      img.src = src;
      photoImgs[i] = img;
    } else {
      photoImgs[i] = null;
    }
  }
  function setPhoto(i, dataUrl) {
    photoData[i] = dataUrl;
    reloadPhotoImg(i);
  }
  for (let i = 0; i < N; i++) reloadPhotoImg(i);

  function savePhotos() {
    try {
      localStorage.setItem(PHOTO_KEY, JSON.stringify(photoData));
      localStorage.setItem(NAME_KEY, JSON.stringify(names));
    } catch (e) {
      alert('写真の保存に失敗しました（容量オーバーの可能性があります）');
    }
  }

  function photoReady(i) {
    const img = photoImgs[i];
    return img && img.complete && img.naturalWidth > 0;
  }

  // --- ステージ寸法（基準値、後でスケール） ---
  const BASE_W = 400;
  const BASE_H = 560;
  const WALL = 14;          // 壁の厚み
  const DEAD_LINE = 80;     // 上端からのデッドライン位置

  const canvas = document.getElementById('game');

  let scale = 1;
  function computeScale() {
    const maxW = Math.min(window.innerWidth - 24, 420);
    const maxH = window.innerHeight - 210;
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
  let best = Number(localStorage.getItem('family_suika_best') || 0);
  let currentIndex = randomDropIndex();
  let nextIndex = randomDropIndex();
  let dropX = W / 2;
  let canDrop = true;
  let gameOver = false;
  let pendingBody = null;
  let overflowTimer = 0;
  let setupOpen = false;

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const nextFaceEl = document.getElementById('next-face');
  const nextNameEl = document.getElementById('next-name');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovMsg = document.getElementById('ov-msg');

  bestEl.textContent = best;

  function randomDropIndex() {
    const r = Math.random();
    if (r < 0.4) return 0;
    if (r < 0.7) return 1;
    if (r < 0.88) return 2;
    if (r < 0.97) return 3;
    return 4;
  }

  function updateNextUI() {
    nextNameEl.textContent = names[nextIndex];
    if (photoSrc(nextIndex)) {
      nextFaceEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = photoSrc(nextIndex);
      nextFaceEl.appendChild(img);
    } else {
      nextFaceEl.textContent = TIERS[nextIndex].emoji;
    }
  }

  // 進化チャート（下部）
  const evolveEl = document.getElementById('evolve');
  function updateEvolveUI() {
    evolveEl.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      if (photoSrc(i)) {
        const img = document.createElement('img');
        img.src = photoSrc(i);
        chip.appendChild(img);
      } else {
        chip.textContent = TIERS[i].emoji;
      }
      evolveEl.appendChild(chip);
      if (i < N - 1) evolveEl.appendChild(document.createTextNode('→'));
    }
  }

  // ボディ生成
  function makeBall(index, x, y, isStatic = false) {
    const t = TIERS[index];
    const body = Bodies.circle(x, y, t.radius, {
      isStatic,
      restitution: 0.18,
      friction: 0.4,
      frictionStatic: 0.6,
      density: 0.001,
      label: 'ball',
      render: {
        fillStyle: t.color,
        strokeStyle: 'rgba(0,0,0,0.15)',
        lineWidth: 2,
      },
    });
    body.tierIndex = index;
    body.merged = false;
    return body;
  }

  function preparePending() {
    const y = DEAD_LINE - 10;
    dropX = clampX(dropX, currentIndex);
    pendingBody = makeBall(currentIndex, dropX, y, true);
    pendingBody.isPending = true;
    World.add(world, pendingBody);
  }

  function clampX(x, index) {
    const r = TIERS[index].radius;
    return Math.max(WALL + r, Math.min(W - WALL - r, x));
  }

  function drop() {
    if (!canDrop || gameOver || setupOpen || !pendingBody) return;
    canDrop = false;

    const idx = pendingBody.tierIndex;
    const x = pendingBody.position.x;
    World.remove(world, pendingBody);
    pendingBody = null;

    const body = makeBall(idx, x, DEAD_LINE - 10, false);
    World.add(world, body);

    currentIndex = nextIndex;
    nextIndex = randomDropIndex();
    updateNextUI();

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
      if (a.label !== 'ball' || b.label !== 'ball') continue;
      if (a.merged || b.merged) continue;
      if (a.tierIndex !== b.tierIndex) continue;
      if (a.tierIndex >= N - 1) continue; // 最終段階同士は合体しない

      a.merged = true;
      b.merged = true;

      const newIndex = a.tierIndex + 1;
      const mx = (a.position.x + b.position.x) / 2;
      const my = (a.position.y + b.position.y) / 2;

      World.remove(world, a);
      World.remove(world, b);

      const merged = makeBall(newIndex, mx, my, false);
      World.add(world, merged);
      Body.setVelocity(merged, { x: 0, y: -2 });

      addScore(TIERS[newIndex].score);
      spawnPop(mx, my, TIERS[newIndex].color);

      if (newIndex === N - 1) {
        // 最終段階（いちばん大きい家族写真）完成ボーナス
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
      localStorage.setItem('family_suika_best', best);
    }
  }

  // --- 合体エフェクト ---
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

  // --- カスタム描画（写真・デッドライン・パーティクル） ---
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

    // ボールの上に写真（or 絵文字）を重ねる
    const bodies = Composite.allBodies(world);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const body of bodies) {
      if (body.label !== 'ball') continue;
      const t = TIERS[body.tierIndex];
      const r = t.radius;
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.globalAlpha = body.isPending ? 0.85 : 1;
      if (photoReady(body.tierIndex)) {
        // 円形に切り抜いた写真
        ctx.beginPath();
        ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(photoImgs[body.tierIndex], -r, -r, r * 2, r * 2);
        // ふち取り
        ctx.beginPath();
        ctx.arc(0, 0, r - 1.5, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
      } else {
        const size = r * 1.7;
        ctx.font = `${size}px serif`;
        ctx.fillText(t.emoji, 0, size * 0.05);
      }
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

  // --- ゲームオーバー判定 ---
  Events.on(engine, 'afterUpdate', () => {
    if (gameOver) return;
    const dt = engine.timing.lastDelta || 16.6;
    const bodies = Composite.allBodies(world);
    let over = false;
    for (const body of bodies) {
      if (body.label !== 'ball' || body.isPending) continue;
      if (body.isStatic) continue;
      const top = body.position.y - TIERS[body.tierIndex].radius;
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
    const bodies = Composite.allBodies(world);
    for (const body of bodies) {
      if (body.label === 'ball') World.remove(world, body);
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
    return (clientX - rect.left) / rect.width * W;
  }

  function moveTo(clientX) {
    if (!pendingBody || !canDrop || gameOver || setupOpen) return;
    const x = clampX(pointerXToWorld(clientX), pendingBody.tierIndex);
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
    if (setupOpen) return;
    if (gameOver) {
      if (e.key === 'Enter' || e.key === ' ') restart();
      return;
    }
    if (!pendingBody) return;
    const step = 18;
    if (e.key === 'ArrowLeft') {
      Body.setPosition(pendingBody, { x: clampX(pendingBody.position.x - step, pendingBody.tierIndex), y: pendingBody.position.y });
      dropX = pendingBody.position.x;
    } else if (e.key === 'ArrowRight') {
      Body.setPosition(pendingBody, { x: clampX(pendingBody.position.x + step, pendingBody.tierIndex), y: pendingBody.position.y });
      dropX = pendingBody.position.x;
    } else if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      drop();
    }
  });

  window.addEventListener('resize', applyScale);

  // --- 写真設定画面 ---
  const setupEl = document.getElementById('setup');
  const slotsEl = document.getElementById('slots');

  // 画像を中央で正方形に切り抜き、縮小して dataURL 化
  function processImageFile(file, cb) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const SIZE = 256;
      const c = document.createElement('canvas');
      c.width = SIZE;
      c.height = SIZE;
      const cctx = c.getContext('2d');
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - s) / 2;
      const sy = (img.naturalHeight - s) / 2;
      cctx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
      URL.revokeObjectURL(url);
      cb(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert('画像を読み込めませんでした');
    };
    img.src = url;
  }

  function buildSetupUI() {
    slotsEl.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';

      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = `No.${i + 1}` + (i === N - 1 ? '（いちばん大きい）' : '');

      const face = document.createElement('div');
      face.className = 'face' + (photoSrc(i) ? ' has-photo' : '');
      if (photoSrc(i)) {
        const img = document.createElement('img');
        img.src = photoSrc(i);
        face.appendChild(img);
      } else {
        face.textContent = TIERS[i].emoji;
      }

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        processImageFile(file, (dataUrl) => {
          setPhoto(i, dataUrl);
          savePhotos();
          buildSetupUI();
        });
      });
      face.addEventListener('click', () => fileInput.click());

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = names[i];
      nameInput.maxLength = 10;
      nameInput.addEventListener('change', () => {
        names[i] = nameInput.value.trim() || `レベル${i + 1}`;
        savePhotos();
      });

      slot.appendChild(num);
      slot.appendChild(face);
      slot.appendChild(fileInput);
      slot.appendChild(nameInput);

      if (photoData[i]) {
        const clear = document.createElement('button');
        clear.className = 'clear';
        clear.textContent = DEFAULT_PHOTOS[i] ? '元の写真に戻す' : '写真を消す';
        clear.addEventListener('click', () => {
          setPhoto(i, null);
          savePhotos();
          buildSetupUI();
        });
        slot.appendChild(clear);
      }

      slotsEl.appendChild(slot);
    }
  }

  function openSetup() {
    setupOpen = true;
    buildSetupUI();
    setupEl.classList.add('show');
  }

  function closeSetup() {
    setupOpen = false;
    setupEl.classList.remove('show');
    updateNextUI();
    updateEvolveUI();
  }

  document.getElementById('photo-btn').addEventListener('click', openSetup);
  document.getElementById('setup-done').addEventListener('click', closeSetup);

  // --- 開始 ---
  updateNextUI();
  updateEvolveUI();
  preparePending();

  // 写真が1枚もなければ最初に設定画面を開く（デフォルト写真があれば開かない）
  if (!photoData.some(Boolean) && !DEFAULT_PHOTOS.some(Boolean)) {
    openSetup();
  }
})();
