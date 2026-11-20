/* ============================================================================
 * game.js  --  the game itself: asteroids bouncing around a "table".
 *
 * It knows NOTHING about Bluetooth or the SPIKE hub. It only asks one question
 * every frame: "what is player i doing?", answered by a function you give it:
 *
 *     Game.start(canvas, (playerIndex) => ({ x: 0..1, aim: -1..1, fire: true/false }))
 *
 *   x    0 = far left of that player's edge, 1 = far right
 *   aim  -1 = turret fully left, 0 = straight ahead, +1 = fully right
 *   fire true while the trigger is held
 *
 * app.js turns raw hub numbers into that shape (that is what calibration is for).
 *
 * "Tabletop" idea: the arena fills the whole canvas (whatever shape the screen is)
 * and each player sits on one side of it (side 0 = bottom, 1 = left, 2 = top,
 * 3 = right). All of a player's math is done as if they were at the bottom
 * ("local" coordinates) and then rotated into the real screen ("world" coordinates). Only one player is created below; to add
 * more, push more entries into `players` and give getInputs() an answer for them.
 * ========================================================================== */
"use strict";

const Game = (() => {

  // ===== Settings you can tweak ===============================================
  const ARENA_HEIGHT = 1000;        // the arena is always 1000 game units tall; its width follows the screen shape
  const PLAYER_MARGIN = 60;         // how far from the corners the player can go
  const MAX_AIM_DEG = 75;           // turret angle at aim = +/-1 (0 degrees = straight into the arena)
  const BULLET_SPEED = 800;         // game units per second
  const FIRE_COOLDOWN = 0.25;       // seconds between shots while holding the trigger
  const ASTEROID_RADIUS = [0, 18, 34, 55];   // index = size (3 = big, 1 = small)
  const ASTEROID_SCORE  = [0, 100, 50, 20];  // smaller = harder to hit = more points
  const ASTEROID_SPEED = 90;        // game units per second (smaller ones are faster)
  const FIRST_WAVE_COUNT = 3;       // big asteroids in wave 1 (+1 each wave)
  const COLOR = "#ffffff";          // 1980s vector style: white lines on black
  // ============================================================================

  let canvas, ctx, getInputs;
  let running = false, lastTime = 0, scale = 1, rafId = 0;
  let W = ARENA_HEIGHT, H = ARENA_HEIGHT;   // arena size in game units (W is set by resize())
  let players = [], bullets = [], asteroids = [];
  let score = 0, wave = 0;
  let debugLine = "";               // text shown at the bottom of the screen
  let showPlayers = true;           // false = don't draw the triangle + turret (the real robot is the turret)

  // ---- Local -> world coordinates --------------------------------------------
  // Local: the player is on the bottom edge, (0,0) top-left, y points down.
  // World: the real arena on screen. `side` rotates by 90 degrees per step.
  // For the left/right sides the edge the player sits on is H long (not W), so
  // edgeSize() gives [length of that edge, depth of the arena as that player sees it].
  function edgeSize(side) { return side % 2 === 0 ? [W, H] : [H, W]; }
  function rotate(side, dx, dy) {
    for (let k = 0; k < side; k++) { const t = dx; dx = -dy; dy = t; }   // 90 degrees
    return [dx, dy];
  }
  function toWorld(side, lx, ly) {
    const [length, depth] = edgeSize(side);
    const [dx, dy] = rotate(side, lx - length / 2, ly - depth / 2);
    return [W / 2 + dx, H / 2 + dy];
  }

  // ---- Setup -----------------------------------------------------------------
  function start(canvasElement, inputsFunction) {
    canvas = canvasElement;
    ctx = canvas.getContext("2d");
    getInputs = inputsFunction;
    players = [{ side: 0, lx: W / 2, aimDeg: 0, cooldown: 0, firing: false }];   // add more players here
    bullets = [];
    asteroids = [];
    score = 0;
    wave = 0;
    nextWave();
    resize();
    if (!running) { running = true; lastTime = performance.now(); rafId = requestAnimationFrame(frame); }
  }

  function stop() { running = false; cancelAnimationFrame(rafId); }
  function setDebugText(text) { debugLine = text; }
  function setShowPlayers(show) { showPlayers = !!show; }

  /** Make the canvas fill its container (call again whenever the container changes size). */
  function resize() {
    if (!canvas) return;
    const box = canvas.parentElement;             // clientWidth/Height ignore any CSS rotation
    canvas.width = Math.max(200, box.clientWidth);
    canvas.height = Math.max(200, box.clientHeight);
    scale = canvas.height / ARENA_HEIGHT;         // game units -> pixels
    H = ARENA_HEIGHT;
    W = canvas.width / scale;                     // wider screen = wider arena
  }

  // ---- Asteroids ---------------------------------------------------------------
  function makeAsteroid(size, x, y) {
    const angle = Math.random() * Math.PI * 2;
    const speed = ASTEROID_SPEED * (1 + (3 - size) * 0.5) * (0.7 + Math.random() * 0.6);
    const points = [];                           // a lumpy outline: 10 corners at slightly different radii
    for (let i = 0; i < 10; i++) points.push(0.75 + Math.random() * 0.25);
    return { size, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
             rot: Math.random() * 6, spin: (Math.random() - 0.5) * 1.5, points };
  }

  function nextWave() {
    wave++;
    const count = Math.min(FIRST_WAVE_COUNT + wave - 1, 8);
    for (let i = 0; i < count; i++) {            // appear in the upper part, away from the bottom player
      asteroids.push(makeAsteroid(3, 120 + Math.random() * (W - 240), 100 + Math.random() * H * 0.4));
    }
  }

  // ---- Shooting ----------------------------------------------------------------
  function shoot(player) {
    const a = player.aimDeg * Math.PI / 180;
    const [dirx, diry] = rotate(player.side, Math.sin(a), -Math.cos(a));       // turret direction, in world space
    const [bx, by] = toWorld(player.side, player.lx, edgeSize(player.side)[1] - 24);   // turret base
    bullets.push({ x: bx + dirx * 36, y: by + diry * 36, vx: dirx * BULLET_SPEED, vy: diry * BULLET_SPEED });
  }

  // ---- One step of the game (dt = seconds since the last frame) -------------------
  function update(dt) {
    players.forEach((p, i) => {
      const input = getInputs(i);
      if (!input) return;
      p.lx = PLAYER_MARGIN + input.x * (edgeSize(p.side)[0] - 2 * PLAYER_MARGIN);   // x: 0..1 -> position along the edge
      p.aimDeg = input.aim * MAX_AIM_DEG;                              // aim: -1..1 -> turret angle
      p.firing = !!input.fire;
      p.cooldown -= dt;
      if (p.firing && p.cooldown <= 0) { shoot(p); p.cooldown = FIRE_COOLDOWN; }
    });

    for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    bullets = bullets.filter((b) => b.x > 0 && b.x < W && b.y > 0 && b.y < H);

    for (const a of asteroids) {                 // move, spin, and BOUNCE off the walls
      const r = ASTEROID_RADIUS[a.size];
      a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.spin * dt;
      if (a.x < r) { a.x = r; a.vx = Math.abs(a.vx); }
      if (a.x > W - r) { a.x = W - r; a.vx = -Math.abs(a.vx); }
      if (a.y < r) { a.y = r; a.vy = Math.abs(a.vy); }
      if (a.y > H - r) { a.y = H - r; a.vy = -Math.abs(a.vy); }
    }

    // Bullet hits asteroid: both disappear; a big asteroid splits into two smaller ones.
    const survivors = [];
    for (const a of asteroids) {
      const hit = bullets.find((b) => Math.hypot(b.x - a.x, b.y - a.y) < ASTEROID_RADIUS[a.size]);
      if (!hit) { survivors.push(a); continue; }
      bullets.splice(bullets.indexOf(hit), 1);
      score += ASTEROID_SCORE[a.size];
      if (a.size > 1) {
        survivors.push(makeAsteroid(a.size - 1, a.x, a.y), makeAsteroid(a.size - 1, a.x, a.y));
      }
    }
    asteroids = survivors;
    if (asteroids.length === 0) nextWave();
  }

  // ---- Drawing: plain white lines on black -----------------------------------------
  function line(x1, y1, x2, y2) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }

  function draw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = COLOR; ctx.fillStyle = COLOR; ctx.lineWidth = 2 / scale;

    ctx.strokeRect(1, 1, W - 2, H - 2);                      // the edge of the table

    for (const a of asteroids) {                                    // asteroids: lumpy polygons
      const r = ASTEROID_RADIUS[a.size];
      ctx.beginPath();
      a.points.forEach((k, i) => {
        const ang = a.rot + (i / a.points.length) * Math.PI * 2;
        const x = a.x + Math.cos(ang) * r * k, y = a.y + Math.sin(ang) * r * k;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath(); ctx.stroke();
    }

    for (const b of bullets) ctx.fillRect(b.x - 3, b.y - 3, 6, 6);  // bullets: little squares

    for (const p of players) {                                      // players: a triangle + turret line
      if (!showPlayers) continue;                                   // hidden: bullets still come from where the turret would be
      const corner = (lx, ly) => toWorld(p.side, lx, ly);
      const depth = edgeSize(p.side)[1];          // distance from the arena's far wall to this player's edge
      const [x1, y1] = corner(p.lx - 22, depth - 4), [x2, y2] = corner(p.lx, depth - 36), [x3, y3] = corner(p.lx + 22, depth - 4);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.stroke();
      const a = p.aimDeg * Math.PI / 180;
      const [dx, dy] = rotate(p.side, Math.sin(a), -Math.cos(a));
      const [bx, by] = corner(p.lx, depth - 24);
      ctx.beginPath(); line(bx, by, bx + dx * 36, by + dy * 36); ctx.stroke();
      if (p.firing) { ctx.beginPath(); ctx.arc(bx + dx * 44, by + dy * 44, 6, 0, Math.PI * 2); ctx.stroke(); }   // muzzle flash
    }

    ctx.font = "24px monospace"; ctx.textBaseline = "top";
    ctx.fillText("SCORE " + score, 20, 16);
    ctx.fillText("WAVE " + wave, W - 150, 16);
    ctx.font = "16px monospace"; ctx.fillText(debugLine, 20, H - 90);
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastTime) / 1000);   // cap dt so a lag spike can't teleport things
    lastTime = now;
    update(dt);
    draw();
    rafId = requestAnimationFrame(frame);
  }

  return { start, stop, resize, setDebugText, setShowPlayers };
})();
