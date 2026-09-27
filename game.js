(() => {
  "use strict";

  // —— Constants ——
  const W = 960;
  const H = 540;
  const GRAVITY = 2100;
  const MOVE_ACCEL = 3200;
  const MAX_RUN = 260;
  const FRICTION = 2400;
  const AIR_FRICTION = 400;
  const JUMP_V = -520;
  const JUMP_CUT = 0.45;
  const COYOTE_MS = 110;
  const BUFFER_MS = 120;
  const PLAYER_W = 28;
  const PLAYER_H = 30;
  const BOUNCE_V = -680;
  const FALL_Y = 720;

  // —— DOM ——
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayStory = document.getElementById("overlay-story");
  const overlayControls = document.getElementById("overlay-controls");
  const overlayHint = document.getElementById("overlay-hint");
  const touchNote = document.getElementById("touch-note");
  const hud = document.getElementById("hud");
  const gemHud = document.getElementById("gem-hud");

  // —— Input ——
  const keys = Object.create(null);
  let jumpPressedThisFrame = false;
  let mute = false;

  const JUMP_CODES = new Set(["Space", "KeyW", "ArrowUp"]);
  const LEFT_CODES = new Set(["ArrowLeft", "KeyA"]);
  const RIGHT_CODES = new Set(["ArrowRight", "KeyD"]);

  function isTouchNoKeyboard() {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const noHover = window.matchMedia("(hover: none)").matches;
    const touchPoints = navigator.maxTouchPoints > 0;
    // Treat as touch-primary if coarse pointer / no hover and no physical keyboard hint
    return (coarse || noHover || touchPoints) && !window.matchMedia("(any-pointer: fine)").matches;
  }

  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    if (!keys[e.code]) {
      if (JUMP_CODES.has(e.code)) jumpPressedThisFrame = true;
      if (e.code === "KeyR" && state.mode === "play") restartLevel();
      if (e.code === "KeyM") {
        mute = !mute;
        if (!mute) ensureAudio();
      }
      if (e.code === "Space") {
        if (state.mode === "start") startGame();
        else if (state.mode === "win") startGame();
      }
    }
    keys[e.code] = true;
  });

  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  function wantLeft() {
    for (const c of LEFT_CODES) if (keys[c]) return true;
    return false;
  }
  function wantRight() {
    for (const c of RIGHT_CODES) if (keys[c]) return true;
    return false;
  }
  function wantJumpHeld() {
    for (const c of JUMP_CODES) if (keys[c]) return true;
    return false;
  }

  // —— Audio ——
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }

  function beep(freq, dur, type, vol, slide) {
    if (mute || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    gain.gain.setValueAtTime(vol || 0.08, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function sfxJump() {
    beep(320, 0.12, "square", 0.05, 520);
  }
  function sfxGem() {
    beep(660, 0.08, "sine", 0.07, 990);
    setTimeout(() => beep(880, 0.1, "sine", 0.05, 1320), 40);
  }
  function sfxBounce() {
    beep(180, 0.15, "triangle", 0.08, 420);
  }
  function sfxRespawn() {
    beep(220, 0.18, "sawtooth", 0.04, 110);
  }
  function sfxWin() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => setTimeout(() => beep(f, 0.2, "sine", 0.07), i * 90));
  }

  // —— Level data ——
  // Platforms: {x, y, w, h, kind: 'grass'|'stone'|'sand'}
  // Moving: {x, y, w, h, ax, ay, bx, by, speed, kind}
  // Gems: {x, y}
  // Spikes: {x, y, w}  — upward crystals along top edge at y
  // Bounces: {x, y, w}
  // Checkpoint: {x, y, w}
  // Goal: {x, y, w, h}

  const LEVEL = {
    platforms: [
      // Wide starting meadow
      { x: 0, y: 420, w: 520, h: 140, kind: "grass" },
      // Step-up island
      { x: 580, y: 400, w: 160, h: 160, kind: "grass" },
      // Short gap landing
      { x: 820, y: 390, w: 140, h: 170, kind: "grass" },
      // Approach to bridge
      { x: 1020, y: 400, w: 100, h: 160, kind: "sand" },
      // Stone bridge deck
      { x: 1140, y: 380, w: 320, h: 36, kind: "stone" },
      // Bridge pillars (visual + solid underside)
      { x: 1160, y: 416, w: 40, h: 140, kind: "stone" },
      { x: 1280, y: 416, w: 40, h: 140, kind: "stone" },
      { x: 1400, y: 416, w: 40, h: 140, kind: "stone" },
      // After bridge
      { x: 1500, y: 400, w: 180, h: 160, kind: "grass" },
      // Higher island
      { x: 1760, y: 300, w: 220, h: 260, kind: "grass" },
      // Mid ledge before moving platform gap
      { x: 2060, y: 340, w: 120, h: 220, kind: "sand" },
      // Far side of wide gap (after moving platform)
      { x: 2480, y: 360, w: 200, h: 200, kind: "grass" },
      // Checkpoint meadow
      { x: 2740, y: 400, w: 280, h: 160, kind: "grass" },
      // Spike island approach
      { x: 3100, y: 380, w: 160, h: 180, kind: "sand" },
      // Safe pads around spikes
      { x: 3340, y: 360, w: 100, h: 200, kind: "grass" },
      { x: 3560, y: 340, w: 140, h: 220, kind: "grass" },
      // Final run to goal
      { x: 3780, y: 380, w: 420, h: 180, kind: "grass" },
    ],
    movers: [
      {
        x: 2220,
        y: 300,
        w: 110,
        h: 28,
        ax: 2220,
        ay: 300,
        bx: 2380,
        by: 300,
        speed: 55,
        kind: "stone",
        t: 0,
      },
    ],
    gems: [
      { x: 280, y: 360 },
      { x: 640, y: 340 },
      { x: 880, y: 330 },
      { x: 1260, y: 300 },
      { x: 1580, y: 340 },
      { x: 1860, y: 220 },
      { x: 2100, y: 280 },
      { x: 2560, y: 300 },
      { x: 2860, y: 340 },
      { x: 3600, y: 280 },
    ],
    spikes: [
      { x: 3180, y: 380, w: 72 },
      { x: 3460, y: 360, w: 80 },
    ],
    bounces: [
      { x: 1680, y: 400, w: 56 },
      { x: 3020, y: 400, w: 56 },
    ],
    checkpoint: { x: 2840, y: 400, w: 48 },
    goal: { x: 4020, y: 260, w: 100, h: 120 },
    spawn: { x: 80, y: 360 },
  };

  // —— State ——
  const state = {
    mode: "start", // start | play | win
    player: null,
    cameraX: 0,
    gemsCollected: 0,
    gemStates: [],
    checkpointReached: false,
    spawn: { x: LEVEL.spawn.x, y: LEVEL.spawn.y },
    time: 0,
    movers: [],
    flash: 0,
  };

  function cloneMovers() {
    return LEVEL.movers.map((m) => ({ ...m, t: 0, x: m.ax, y: m.ay }));
  }

  function resetGems() {
    state.gemStates = LEVEL.gems.map((g) => ({ ...g, taken: false, spark: 0 }));
  }

  function makePlayer(x, y) {
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      onGround: false,
      facing: 1,
      coyote: 0,
      buffer: 0,
      airJumps: 1,
      jumpHeld: false,
      anim: 0,
      runPhase: 0,
      breathe: 0,
      noseTwitch: 0,
      stretch: 0,
      riding: null,
      invuln: 0,
    };
  }

  function showStartOverlay() {
    overlay.classList.remove("hidden");
    hud.classList.add("hidden");
    overlayTitle.textContent = "Skybridge";
    overlayStory.textContent = "A little mole crosses the sky meadows.";
    overlayStory.classList.remove("hidden");
    overlayControls.classList.remove("hidden");
    overlayHint.textContent = "Press Space to start.";
    if (isTouchNoKeyboard()) {
      touchNote.classList.remove("hidden");
    } else {
      touchNote.classList.add("hidden");
    }
  }

  function showWinOverlay() {
    overlay.classList.remove("hidden");
    hud.classList.add("hidden");
    const total = LEVEL.gems.length;
    overlayTitle.textContent = "You made it!";
    overlayStory.textContent = `Coral gems: ${state.gemsCollected} / ${total}`;
    overlayStory.classList.remove("hidden");
    overlayControls.classList.add("hidden");
    overlayHint.textContent = "Press Space to play again.";
    touchNote.classList.add("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
    hud.classList.remove("hidden");
  }

  function startGame() {
    ensureAudio();
    state.mode = "play";
    state.gemsCollected = 0;
    state.checkpointReached = false;
    state.spawn = { x: LEVEL.spawn.x, y: LEVEL.spawn.y };
    state.movers = cloneMovers();
    resetGems();
    state.player = makePlayer(LEVEL.spawn.x, LEVEL.spawn.y);
    state.cameraX = 0;
    state.flash = 0;
    hideOverlay();
    updateHud();
  }

  function restartLevel() {
    ensureAudio();
    startGame();
  }

  function updateHud() {
    gemHud.textContent = `Gems: ${state.gemsCollected}`;
  }

  function winGame() {
    state.mode = "win";
    sfxWin();
    showWinOverlay();
  }

  function respawn() {
    const p = state.player;
    p.x = state.spawn.x;
    p.y = state.spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.onGround = false;
    p.coyote = 0;
    p.buffer = 0;
    p.airJumps = 1;
    p.riding = null;
    p.invuln = 0.6;
    state.flash = 0.35;
    sfxRespawn();
  }

  // —— Collision helpers ——
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function solidList() {
    return state.movers.concat(LEVEL.platforms);
  }

  function resolvePlatforms(p, dt) {
    p.onGround = false;
    p.riding = null;

    // Horizontal
    p.x += p.vx * dt;
    for (const s of solidList()) {
      const body = { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H };
      if (!rectsOverlap(body, s)) continue;
      if (p.vx > 0) p.x = s.x - PLAYER_W;
      else if (p.vx < 0) p.x = s.x + s.w;
      p.vx = 0;
    }

    // Vertical
    p.y += p.vy * dt;
    for (const s of solidList()) {
      const body = { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H };
      if (!rectsOverlap(body, s)) continue;
      if (p.vy > 0) {
        p.y = s.y - PLAYER_H;
        p.vy = 0;
        p.onGround = true;
        if (state.movers.includes(s)) p.riding = s;
      } else if (p.vy < 0) {
        p.y = s.y + s.h;
        p.vy = 0;
      }
    }
  }

  // —— Update ——
  function updateMovers(dt) {
    for (const m of state.movers) {
      const dx = m.bx - m.ax;
      const dy = m.by - m.ay;
      const dist = Math.hypot(dx, dy) || 1;
      const period = (dist * 2) / m.speed;
      m.t = (m.t + dt) % period;
      const half = period / 2;
      let u = m.t < half ? m.t / half : 1 - (m.t - half) / half;
      // Smooth ease
      u = u * u * (3 - 2 * u);
      const prevX = m.x;
      const prevY = m.y;
      m.x = m.ax + dx * u;
      m.y = m.ay + dy * u;
      m._dx = m.x - prevX;
      m._dy = m.y - prevY;
    }
  }

  function updatePlayer(dt) {
    const p = state.player;
    if (p.invuln > 0) p.invuln -= dt;

    // Carry with moving platform
    if (p.riding) {
      p.x += p.riding._dx || 0;
      p.y += p.riding._dy || 0;
    }

    // Horizontal
    let move = 0;
    if (wantLeft()) move -= 1;
    if (wantRight()) move += 1;
    if (move !== 0) {
      p.vx += move * MOVE_ACCEL * dt;
      p.facing = move;
      p.vx = Math.max(-MAX_RUN, Math.min(MAX_RUN, p.vx));
    } else {
      const fr = p.onGround ? FRICTION : AIR_FRICTION;
      if (p.vx > 0) p.vx = Math.max(0, p.vx - fr * dt);
      else if (p.vx < 0) p.vx = Math.min(0, p.vx + fr * dt);
    }

    // Coyote / buffer. Landing refills the extra midair jump.
    if (p.onGround) {
      p.coyote = COYOTE_MS / 1000;
      p.airJumps = 1;
    } else {
      p.coyote = Math.max(0, p.coyote - dt);
    }

    if (jumpPressedThisFrame) p.buffer = BUFFER_MS / 1000;
    else p.buffer = Math.max(0, p.buffer - dt);

    // Ground jump, then one extra jump in the air.
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = JUMP_V;
      p.onGround = false;
      p.coyote = 0;
      p.buffer = 0;
      p.jumpHeld = true;
      p.stretch = 1;
      sfxJump();
    } else if (p.buffer > 0 && p.airJumps > 0) {
      p.vy = JUMP_V;
      p.onGround = false;
      p.coyote = 0;
      p.buffer = 0;
      p.airJumps -= 1;
      p.jumpHeld = true;
      p.stretch = 1;
      sfxJump();
    }

    // Variable jump cut
    if (p.jumpHeld && !wantJumpHeld() && p.vy < 0) {
      p.vy *= JUMP_CUT;
      p.jumpHeld = false;
    }
    if (p.vy >= 0) p.jumpHeld = false;

    p.vy += GRAVITY * dt;
    if (p.vy > 900) p.vy = 900;

    resolvePlatforms(p, dt);

    // Bounce mushrooms
    for (const b of LEVEL.bounces) {
      const pad = { x: b.x, y: b.y - 18, w: b.w, h: 18 };
      const body = { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H };
      if (rectsOverlap(body, pad) && p.vy >= 0) {
        p.y = pad.y - PLAYER_H;
        p.vy = BOUNCE_V;
        p.onGround = false;
        p.coyote = 0;
        p.airJumps = 1;
        p.jumpHeld = wantJumpHeld();
        p.stretch = 1.2;
        sfxBounce();
      }
    }

    // Gems
    for (const g of state.gemStates) {
      if (g.taken) continue;
      const gem = { x: g.x - 10, y: g.y - 10, w: 20, h: 20 };
      const body = { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H };
      if (rectsOverlap(body, gem)) {
        g.taken = true;
        g.spark = 1;
        state.gemsCollected++;
        updateHud();
        sfxGem();
      }
    }

    // Checkpoint
    const cp = LEVEL.checkpoint;
    const banner = { x: cp.x, y: cp.y - 80, w: cp.w, h: 80 };
    const body = { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H };
    if (!state.checkpointReached && rectsOverlap(body, banner)) {
      state.checkpointReached = true;
      state.spawn = { x: cp.x + 8, y: cp.y - PLAYER_H - 2 };
    }

    // Spikes
    if (p.invuln <= 0) {
      for (const sp of LEVEL.spikes) {
        const hit = { x: sp.x + 4, y: sp.y - 22, w: sp.w - 8, h: 22 };
        if (rectsOverlap(body, hit)) {
          respawn();
          return;
        }
      }
    }

    // Fall
    if (p.y > FALL_Y) {
      respawn();
      return;
    }

    // Goal
    const goal = LEVEL.goal;
    const arch = { x: goal.x + 20, y: goal.y + 40, w: goal.w - 40, h: goal.h - 20 };
    if (rectsOverlap(body, arch)) {
      winGame();
      return;
    }

    // Animation
    p.breathe += dt;
    p.anim += dt;
    if (Math.random() < dt * 0.8) p.noseTwitch = 0.25;
    p.noseTwitch = Math.max(0, p.noseTwitch - dt);
    p.stretch = Math.max(0, p.stretch - dt * 3);

    if (p.onGround && Math.abs(p.vx) > 30) {
      p.runPhase += dt * Math.abs(p.vx) * 0.045;
    } else if (p.onGround) {
      p.runPhase *= 0.9;
    }
  }

  function update(dt) {
    state.time += dt;
    if (state.flash > 0) state.flash -= dt;
    if (state.mode !== "play") return;
    updateMovers(dt);
    updatePlayer(dt);

    // Camera
    const p = state.player;
    const target = p.x + PLAYER_W / 2 - W * 0.38;
    state.cameraX += (target - state.cameraX) * Math.min(1, dt * 6);
    if (state.cameraX < 0) state.cameraX = 0;
    const worldEnd = 4300;
    if (state.cameraX > worldEnd - W) state.cameraX = Math.max(0, worldEnd - W);
  }

  // —— Drawing ——
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#6ec8f0");
    g.addColorStop(0.55, "#a8dff8");
    g.addColorStop(1, "#d4f0ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft sun glow
    const sx = W * 0.78;
    const sy = 70;
    const sg = ctx.createRadialGradient(sx, sy, 10, sx, sy, 120);
    sg.addColorStop(0, "rgba(255, 244, 180, 0.55)");
    sg.addColorStop(1, "rgba(255, 244, 180, 0)");
    ctx.fillStyle = sg;
    ctx.fillRect(sx - 120, sy - 120, 240, 240);
  }

  function drawClouds(cam) {
    const clouds = [
      { x: 80, y: 70, s: 1 },
      { x: 420, y: 110, s: 0.8 },
      { x: 760, y: 55, s: 1.1 },
      { x: 1100, y: 95, s: 0.9 },
      { x: 1500, y: 60, s: 1.2 },
      { x: 1900, y: 100, s: 0.75 },
      { x: 2300, y: 50, s: 1 },
      { x: 2700, y: 90, s: 0.85 },
      { x: 3100, y: 65, s: 1.05 },
      { x: 3500, y: 105, s: 0.9 },
      { x: 3900, y: 55, s: 1.15 },
    ];
    const drift = state.time * 12;
    ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
    for (const c of clouds) {
      const cx = c.x - cam * 0.35 + (drift % 5000) * 0.15;
      const x = ((cx % 4600) + 4600) % 4600 - 200;
      const y = c.y;
      const s = c.s;
      ctx.beginPath();
      ctx.ellipse(x, y, 40 * s, 18 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 28 * s, y - 8 * s, 28 * s, 16 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 50 * s, y + 2 * s, 32 * s, 15 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 18 * s, y + 6 * s, 30 * s, 14 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawPlatform(plat) {
    const { x, y, w, h, kind } = plat;
    if (kind === "stone") {
      ctx.fillStyle = "#8a8680";
      roundRect(x, y, w, h, 4);
      ctx.fill();
      ctx.fillStyle = "#9c9890";
      ctx.fillRect(x + 2, y + 2, w - 4, Math.min(12, h - 2));
      // Brick lines
      ctx.strokeStyle = "rgba(60, 55, 50, 0.25)";
      ctx.lineWidth = 1;
      for (let ly = y + 14; ly < y + h; ly += 16) {
        ctx.beginPath();
        ctx.moveTo(x + 2, ly);
        ctx.lineTo(x + w - 2, ly);
        ctx.stroke();
      }
      return;
    }

    // Sandstone body
    const body = ctx.createLinearGradient(x, y, x, y + h);
    if (kind === "sand") {
      body.addColorStop(0, "#d4b896");
      body.addColorStop(1, "#b8926a");
    } else {
      body.addColorStop(0, "#c9a87a");
      body.addColorStop(1, "#a67c52");
    }
    ctx.fillStyle = body;
    roundRect(x, y + 10, w, h - 10, 6);
    ctx.fill();

    // Grass top
    const grassH = 16;
    ctx.fillStyle = "#5aaa4a";
    roundRect(x - 2, y, w + 4, grassH + 4, 8);
    ctx.fill();
    ctx.fillStyle = "#6ec45a";
    ctx.fillRect(x, y + 4, w, grassH - 2);

    // Blades
    ctx.strokeStyle = "#4a9a3a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (let i = 4; i < w; i += 10) {
      const sway = Math.sin(state.time * 2.2 + x * 0.05 + i * 0.2) * 2;
      ctx.beginPath();
      ctx.moveTo(x + i, y + 10);
      ctx.quadraticCurveTo(x + i + sway, y + 2, x + i + sway * 0.5, y - 2);
      ctx.stroke();
    }
  }

  function drawBounce(b) {
    const x = b.x;
    const y = b.y;
    const w = b.w;
    // Stem
    ctx.fillStyle = "#5a8a40";
    ctx.fillRect(x + w * 0.35, y - 8, w * 0.3, 12);
    // Cap
    ctx.fillStyle = "#e87868";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y - 16, w * 0.55, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff0e0";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y - 12, w * 0.28, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Spots
    ctx.fillStyle = "#fff6ee";
    ctx.beginPath();
    ctx.arc(x + w * 0.3, y - 20, 3.5, 0, Math.PI * 2);
    ctx.arc(x + w * 0.65, y - 18, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSpike(sp) {
    const baseY = sp.y;
    const count = Math.max(2, Math.floor(sp.w / 16));
    const step = sp.w / count;
    for (let i = 0; i < count; i++) {
      const cx = sp.x + step * (i + 0.5);
      const tip = baseY - 26 - (i % 2) * 4;
      const g = ctx.createLinearGradient(cx, tip, cx, baseY);
      g.addColorStop(0, "#e8f6ff");
      g.addColorStop(0.4, "#7ec8e8");
      g.addColorStop(1, "#3a88b0");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, tip);
      ctx.lineTo(cx + step * 0.42, baseY);
      ctx.lineTo(cx - step * 0.42, baseY);
      ctx.closePath();
      ctx.fill();
      // Shine
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 2, tip + 8);
      ctx.lineTo(cx - 2, tip + 16);
      ctx.stroke();
    }
  }

  function drawGem(g) {
    if (g.taken) {
      if (g.spark > 0) {
        g.spark -= 0.04;
        ctx.fillStyle = `rgba(255, 180, 140, ${g.spark})`;
        for (let i = 0; i < 5; i++) {
          const a = state.time * 6 + i;
          ctx.beginPath();
          ctx.arc(g.x + Math.cos(a) * 16, g.y + Math.sin(a) * 12, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    const bob = Math.sin(state.time * 3 + g.x * 0.05) * 4;
    const x = g.x;
    const y = g.y + bob;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(state.time * 2 + g.x) * 0.15);
    // Coral gem diamond
    ctx.fillStyle = "#ef7a6a";
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(9, 0);
    ctx.lineTo(0, 11);
    ctx.lineTo(-9, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffb09e";
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(9, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    // Sparkle
    if (Math.sin(state.time * 8 + g.x) > 0.7) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(2, -6, 2, 2);
    }
    ctx.restore();
  }

  function drawCheckpoint() {
    const cp = LEVEL.checkpoint;
    const poleX = cp.x + cp.w / 2;
    const baseY = cp.y;
    // Pole
    ctx.fillStyle = "#8a6a40";
    ctx.fillRect(poleX - 3, baseY - 88, 6, 88);
    // Banner flag
    const wave = Math.sin(state.time * 3) * 4;
    const active = state.checkpointReached;
    ctx.fillStyle = active ? "#f0c040" : "#e8a030";
    ctx.beginPath();
    ctx.moveTo(poleX + 3, baseY - 86);
    ctx.lineTo(poleX + 48 + wave, baseY - 72);
    ctx.lineTo(poleX + 3, baseY - 58);
    ctx.closePath();
    ctx.fill();
    // Emblem
    ctx.fillStyle = active ? "#fff8d0" : "#fff0c0";
    ctx.beginPath();
    ctx.arc(poleX + 18, baseY - 72, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGoal() {
    const g = LEVEL.goal;
    // Pillars
    ctx.fillStyle = "#f2eee6";
    roundRect(g.x, g.y + 20, 22, g.h - 20, 4);
    ctx.fill();
    roundRect(g.x + g.w - 22, g.y + 20, 22, g.h - 20, 4);
    ctx.fill();
    // Arch
    ctx.fillStyle = "#faf7f0";
    ctx.beginPath();
    ctx.moveTo(g.x, g.y + 50);
    ctx.lineTo(g.x, g.y + 28);
    ctx.quadraticCurveTo(g.x + g.w / 2, g.y - 10, g.x + g.w, g.y + 28);
    ctx.lineTo(g.x + g.w, g.y + 50);
    ctx.quadraticCurveTo(g.x + g.w / 2, g.y + 18, g.x, g.y + 50);
    ctx.fill();
    // Inner shadow
    ctx.strokeStyle = "rgba(160, 150, 130, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(g.x + 22, g.y + 48);
    ctx.quadraticCurveTo(g.x + g.w / 2, g.y + 22, g.x + g.w - 22, g.y + 48);
    ctx.stroke();
    // Waving ribbon
    const baseY = g.y + 8;
    const t = state.time;
    ctx.strokeStyle = "#e87868";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(g.x + g.w / 2 - 8, baseY);
    for (let i = 0; i <= 40; i++) {
      const px = g.x + g.w / 2 - 8 + i;
      const py = baseY + Math.sin(t * 4 + i * 0.25) * 6 + i * 0.15;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = "#f0c040";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(g.x + g.w / 2 + 4, baseY + 2);
    for (let i = 0; i <= 36; i++) {
      const px = g.x + g.w / 2 + 4 + i;
      const py = baseY + 2 + Math.sin(t * 4 + 1 + i * 0.28) * 5 + i * 0.12;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function drawMole(p) {
    const cx = p.x + PLAYER_W / 2;
    const cy = p.y + PLAYER_H / 2;
    const facing = p.facing >= 0 ? 1 : -1;

    const idle = p.onGround && Math.abs(p.vx) < 25;
    const running = p.onGround && Math.abs(p.vx) >= 25;
    const airborne = !p.onGround;

    const breathe = idle ? Math.sin(p.breathe * 3.2) * 1.5 : 0;
    let stretchY = 1;
    let stretchX = 1;
    if (airborne) {
      stretchY = 1.12 + p.stretch * 0.08;
      stretchX = 0.9 - p.stretch * 0.05;
    } else if (p.stretch > 0) {
      stretchY = 1 - p.stretch * 0.08;
      stretchX = 1 + p.stretch * 0.1;
    } else {
      stretchY = 1 + breathe * 0.02;
      stretchX = 1 - breathe * 0.015;
    }

    ctx.save();
    ctx.translate(cx, cy + breathe * 0.3);
    ctx.scale(facing * stretchX, stretchY);

    // Shadow
    ctx.fillStyle = "rgba(40, 50, 30, 0.18)";
    ctx.beginPath();
    ctx.ellipse(0, PLAYER_H / 2 - 2, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ears
    ctx.fillStyle = "#8a5a38";
    ctx.beginPath();
    ctx.arc(-9, -11, 5, 0, Math.PI * 2);
    ctx.arc(9, -11, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d4a090";
    ctx.beginPath();
    ctx.arc(-9, -11, 2.5, 0, Math.PI * 2);
    ctx.arc(9, -11, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = "#8b5a3c";
    ctx.beginPath();
    ctx.ellipse(0, 1, 13, 13.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly
    ctx.fillStyle = "#d4b896";
    ctx.beginPath();
    ctx.ellipse(0, 5, 8, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Muzzle
    ctx.fillStyle = "#c9a882";
    ctx.beginPath();
    ctx.ellipse(0, 2, 7, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = "#1a1814";
    ctx.beginPath();
    ctx.arc(-4.5, -2, 2.2, 0, Math.PI * 2);
    ctx.arc(4.5, -2, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(-3.8, -2.6, 0.8, 0, Math.PI * 2);
    ctx.arc(5.2, -2.6, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Nose
    const noseY = p.noseTwitch > 0 ? 4.5 : 5;
    ctx.fillStyle = "#e890a0";
    ctx.beginPath();
    ctx.ellipse(0, noseY, 3.2, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff6f8";
    ctx.beginPath();
    ctx.arc(-1, noseY - 0.6, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Paws
    ctx.fillStyle = "#7a4e34";
    if (airborne) {
      // Arms out
      ctx.beginPath();
      ctx.ellipse(-14, 2, 4, 3, -0.4, 0, Math.PI * 2);
      ctx.ellipse(14, 2, 4, 3, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-6, 12, 4, 3, 0.2, 0, Math.PI * 2);
      ctx.ellipse(6, 12, 4, 3, -0.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (running) {
      const ph = p.runPhase;
      const a = Math.sin(ph * Math.PI * 2) * 5;
      const b = Math.sin(ph * Math.PI * 2 + Math.PI) * 5;
      ctx.beginPath();
      ctx.ellipse(-8, 11 + a * 0.3, 4.5, 3.2, 0.2, 0, Math.PI * 2);
      ctx.ellipse(8, 11 + b * 0.3, 4.5, 3.2, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-12, 4 - a * 0.4, 3.5, 2.8, -0.3, 0, Math.PI * 2);
      ctx.ellipse(12, 4 - b * 0.4, 3.5, 2.8, 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(-8, 12, 4.5, 3, 0.15, 0, Math.PI * 2);
      ctx.ellipse(8, 12, 4.5, 3, -0.15, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawWorld() {
    const cam = state.cameraX;
    ctx.save();
    ctx.translate(-Math.round(cam), 0);

    for (const plat of LEVEL.platforms) drawPlatform(plat);
    for (const m of state.movers) drawPlatform(m);
    for (const b of LEVEL.bounces) drawBounce(b);
    for (const sp of LEVEL.spikes) drawSpike(sp);
    drawCheckpoint();
    drawGoal();
    for (const g of state.gemStates) drawGem(g);

    if (state.player) {
      const p = state.player;
      if (p.invuln <= 0 || Math.floor(state.time * 20) % 2 === 0) {
        drawMole(p);
      }
    }

    ctx.restore();
  }

  function drawMuteIcon() {
    if (!mute || state.mode !== "play") return;
    ctx.fillStyle = "rgba(255,248,232,0.85)";
    ctx.font = "600 14px Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("Muted", W - 16, 28);
  }

  function render() {
    drawSky();
    drawClouds(state.cameraX);
    drawWorld();
    drawMuteIcon();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 220, 200, ${state.flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // —— Loop ——
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    update(dt);
    render();
    jumpPressedThisFrame = false;
    requestAnimationFrame(frame);
  }

  // —— Boot ——
  function fitCanvas() {
    // CSS handles max fit; keep internal resolution fixed
    canvas.width = W;
    canvas.height = H;
  }

  fitCanvas();
  window.addEventListener("resize", fitCanvas);
  resetGems();
  state.movers = cloneMovers();
  state.player = makePlayer(LEVEL.spawn.x, LEVEL.spawn.y);
  showStartOverlay();
  requestAnimationFrame(frame);
})();
