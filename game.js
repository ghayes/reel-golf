// ============================================================
// REEL GOLF — Game Engine & Canvas Renderer (game.js)
// ============================================================
(() => {
  'use strict';

  const cv = document.getElementById('cv');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const stampEl = document.getElementById('stamp');

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = W * DPR;
    cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function hasUpgrade(key) {
    return (window.RG_API && typeof window.RG_API.hasUpgrade === 'function')
      ? window.RG_API.hasUpgrade(key)
      : false;
  }

  // ---------- world constants ----------
  const YARD = 9;                 // px per yard (world units)
  const DOCK_X = 60;              // tee position (world x)
  const MAX_LINE_YD = 175;        // spool capacity
  const GRAV = 420;               // px/s^2
  const BALL_R = 5;

  // ---------- game state ----------
  const S = {};

  function newRound() {
    S.score = 0;
    S.balls = 3;
    S.bestDist = 0;
    S.fishCaught = 0;
    S.roundCatches = [];
    S.everRing2x = false;
    nextBall();
  }

  function nextBall() {
    S.phase = 'ready';          // ready|charge|flight|reel|snapped|landed|over
    S.power = 0;
    S.holding = false;
    S.wind = (Math.random() * 16 - 8);           // mph, + = tailwind
    S.ball = { x: DOCK_X, y: 0, vx: 0, vy: 0 };  // y measured up from water surface
    S.distYd = 0;
    S.lineOutYd = 0;
    S.tension = 0;
    S.shotMult = 1;
    S.banked = false;
    S.msg = '';
    S.cam = 0;
    S.splashT = 0;
    S.fish = null;
    S.toast = null;
    S.swingT = SWING_DUR;
    S.contactDone = true;
    S.lockedPower = 0;
    S.contactFrac = 0.6;
    S.time = 0;
    S.trail = [];
    // target rings: 2 rings at random distances
    S.rings = [];
    const r1 = 45 + Math.random() * 45;
    const r2 = 100 + Math.random() * 55;
    S.rings.push({ yd: r1, r: 7 });
    S.rings.push({ yd: r2, r: 7 });
  }

  function toast(text) {
    S.toast = { text, t: 1.8 };
  }

  // fish tiers by distance
  function makeFish(distYd) {
    let tier;
    if (distYd < 60)  tier = { name: 'PERCH', bonus: 50, stamina: 3, pull: 26, runT: 1.4, restT: 2.2, color: '#7FA65A' };
    else if (distYd < 110) tier = { name: 'BASS', bonus: 150, stamina: 5, pull: 40, runT: 1.8, restT: 2.0, color: '#5A8FA6' };
    else tier = { name: 'PIKE', bonus: 400, stamina: 8, pull: 56, runT: 2.2, restT: 1.7, color: '#A6705A' };
    return { ...tier, st: tier.stamina, mode: 'rest', mt: tier.restT * 0.6, landed: false };
  }

  // ---------- input ----------
  function press() {
    const overlay = document.getElementById('overlay');
    const shopOverlay = document.getElementById('shopOverlay');
    if ((overlay && !overlay.classList.contains('hidden')) ||
        (shopOverlay && !shopOverlay.classList.contains('hidden'))) {
      return;
    }
    S.holding = true;
    if (S.phase === 'ready') {
      S.phase = 'charge';
      S.power = 0;
    }
  }

  // swing pose angles (canvas: 0=right, +down, -up)
  const A_ADDRESS = 1.0, A_END = -1.3;
  function topAngle(p) { return A_ADDRESS + easeOut(Math.min(1, p / 100)) * 2.9; }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }

  function release() {
    S.holding = false;
    if (S.phase === 'charge') {
      S.lockedPower = S.power;
      const aTop = topAngle(S.lockedPower);
      S.contactFrac = Math.sqrt(Math.max(0.15, (aTop - A_ADDRESS) / (aTop - A_END)));
      S.swingT = 0;
      S.contactDone = false;
      S.phase = 'downswing';
    }
  }

  cv.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
  window.addEventListener('pointerup', () => release());
  window.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); press(); } });
  window.addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); release(); } });

  // ---------- swing ----------
  const SWING_DUR = 0.22;          // downswing length (s)
  const CONTACT_AT = 0.62;         // fraction of downswing where club meets ball

  function contact() {
    const p = S.lockedPower;
    // red zone 85-100; snap chance ramps 0 -> 85%
    if (p > 85) {
      const chance = (p - 85) / 15 * 0.85;
      if (Math.random() < chance) { return snapLine('SWUNG TOO HARD'); }
    }
    const rodMult = hasUpgrade('graphite_rod') ? 1.10 : 1.0;
    const speed = (190 + Math.pow(p / 100, 1.25) * 560) * rodMult;   // px/s
    const ang = -Math.PI / 4.4;
    S.ball.x = DOCK_X;
    S.ball.y = 30;  // tee height above water
    S.ball.vx = Math.cos(ang) * speed;
    S.ball.vy = Math.sin(ang) * speed;
    S.phase = 'flight';
  }

  // ---------- snap ----------
  function snapLine(reason) {
    S.phase = 'snapped';
    S.msg = reason;
    S.balls--;
    localStorage.setItem('rg_snaps', String((parseInt(localStorage.getItem('rg_snaps') || '0', 10)) + 1));
    if (stampEl) {
      stampEl.classList.remove('show');
      void stampEl.offsetWidth;
      stampEl.classList.add('show');
    }
    setTimeout(() => {
      if (stampEl) stampEl.classList.remove('show');
      if (S.balls <= 0) gameOver(); else nextBall();
    }, 1400);
  }

  function landBall() {
    S.phase = 'landed';
    let pts = Math.round(S.distYd) * S.shotMult;
    let fishPts = 0;
    if (S.fish && S.fish.st <= 0) {
      fishPts = S.fish.bonus;
      S.fishCaught++;
      S.roundCatches.push({ species: S.fish.name, distance_yd: Math.round(S.distYd), bonus_points: fishPts });
    }
    if (S.shotMult > 1) S.everRing2x = true;
    S.score += pts + fishPts;
    S.msg = `+${pts}${fishPts ? ' +' + fishPts + ' ' + S.fish.name : ''}`;
    S.balls--;
    setTimeout(() => { if (S.balls <= 0) gameOver(); else nextBall(); }, 1500);
  }

  function gameOver() {
    S.phase = 'over';
    const summary = {
      score: S.score,
      bestDist: S.bestDist,
      fishCaught: S.fishCaught,
      catches: S.roundCatches,
      ring2x: S.everRing2x,
      lifetimeSnaps: parseInt(localStorage.getItem('rg_snaps') || '0', 10),
    };
    const earnedCoins = Math.floor(S.score / 10);

    if (window.RG_API) {
      window.RG_API.submitRound(summary);
    }

    if (window.RG_GAME && typeof window.RG_GAME.onGameOver === 'function') {
      window.RG_GAME.onGameOver(summary, earnedCoins);
    }
  }

  // ---------- update ----------
  let last = performance.now();
  function update(dt) {
    S.time += dt;

    if (S.phase === 'charge') {
      S.power += dt * 62;                       // ~1.6s to 100
      if (S.power >= 104) { S.power = 104; snapLine('OVERWOUND'); }
    }

    // downswing animation; ball launches at the computed contact frame
    if ((S.phase === 'downswing' || S.phase === 'flight') && S.swingT < SWING_DUR) {
      S.swingT += dt;
      if (S.phase === 'downswing' && !S.contactDone && S.swingT >= SWING_DUR * S.contactFrac) {
        S.contactDone = true;
        contact();
      }
      if (S.phase === 'downswing' && S.swingT >= SWING_DUR && !S.contactDone) {
        S.contactDone = true;
        contact();
      }
    }

    if (S.phase === 'flight') {
      S.ball.vx += (S.wind * 4.2) * dt;           // wind drift
      S.ball.vy += GRAV * dt;                   // vy positive = falling
      S.ball.x += S.ball.vx * dt;
      S.ball.y -= S.ball.vy * dt;               // y = height above water
      if (S.ball.y <= 0) {
        S.ball.y = 0;
        S.distYd = Math.max(0, (S.ball.x - DOCK_X) / YARD);
        if (S.distYd > MAX_LINE_YD) { snapLine('OUT OF LINE — SPOOLED'); return; }
        S.bestDist = Math.max(S.bestDist, S.distYd);
        S.lineOutYd = S.distYd;
        // ring check
        S.shotMult = 1;
        for (const r of S.rings) {
          if (Math.abs(S.distYd - r.yd) <= r.r) { S.shotMult = 2; r.hit = true; }
        }
        S.splashT = 0.5;
        S.phase = 'reel';
        S.tension = 12;
      }
    }

    if (S.splashT > 0) S.splashT -= dt;
    if (S.toast) { S.toast.t -= dt; if (S.toast.t <= 0) S.toast = null; }

    if (S.phase === 'reel') {
      const f = S.fish;
      if (f && f.st > 0) {
        const dropRate = (S.tension < 25) ? 0.18 : 0.012;      // per second
        if (Math.random() < dt * dropRate) {
          toast('THE ' + f.name + ' DROPPED IT');
          S.fish = null;
        }
      }
      if (S.fish && S.fish.st > 0) {
        const fz = S.fish;
        fz.mt -= dt;
        if (fz.mt <= 0) {
          fz.mode = (fz.mode === 'rest') ? 'run' : 'rest';
          fz.mt = (fz.mode === 'run') ? fz.runT * (0.8 + Math.random() * 0.5) : fz.restT * (0.8 + Math.random() * 0.5);
        }
        if (fz.mode === 'run') {
          S.lineOutYd += (fz.pull / 10) * dt;               // fish takes line
          S.tension += (S.holding ? fz.pull * 1.9 : fz.pull * 0.35 - 28) * dt;
          if (S.lineOutYd > MAX_LINE_YD) return snapLine('SPOOLED BY THE ' + fz.name);
        } else { // rest
          if (S.holding) fz.st -= dt;                    // tire it out while reeling
          S.tension += (S.holding ? 14 : -30) * dt;
        }
      } else {
        // no fish (or tired fish): plain reeling
        S.tension += (S.holding ? 20 : -34) * dt;
      }

      // reeling in
      const lf = S.fish;
      if (S.holding) {
        const drag = (lf && lf.st > 0 && lf.mode === 'run') ? 0.15 : 1;
        const reelSpeed = hasUpgrade('titanium_reel') ? 11.5 : 9.5;
        S.lineOutYd -= reelSpeed * drag * dt;
      }
      // hook check: chance per yard reeled, only if no fish yet
      const biteRate = hasUpgrade('super_bait') ? 0.28 : 0.22;
      if (!lf && S.holding && Math.random() < dt * biteRate && S.lineOutYd > 8) {
        S.fish = makeFish(S.distYd);
        toast('SOMETHING GRABBED IT');
      }
      // tired fish adds weight
      if (lf && lf.st <= 0 && S.holding) S.tension += 8 * dt;

      const maxTension = hasUpgrade('braided_line') ? 120 : 100;
      S.tension = Math.max(6, S.tension);
      if (S.tension >= maxTension) return snapLine(lf ? 'THE ' + lf.name + ' BROKE OFF' : 'REELED TOO HOT');

      if (S.lineOutYd <= 0) {
        if (lf && lf.st > 0) { S.lineOutYd = 6; S.tension += 24; }
        else { S.lineOutYd = 0; landBall(); }
      }
    }

    const followX = (S.phase === 'reel') ? DOCK_X + S.lineOutYd * YARD : S.ball.x;
    S.cam += ((Math.max(0, followX - W * 0.5)) - S.cam) * Math.min(1, dt * 4);
  }

  // ---------- draw ----------
  function waterY() { return H * 0.62; }

  function draw() {
    const wy = waterY();
    // sky — dusk
    let g = ctx.createLinearGradient(0, 0, 0, wy);
    g.addColorStop(0, '#2E1E4E');
    g.addColorStop(0.55, '#8C3B52');
    g.addColorStop(1, '#E08A4E');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, wy);

    // sun
    ctx.fillStyle = 'rgba(255,214,150,.9)';
    ctx.beginPath();
    ctx.arc(W * 0.72, wy - 40, 26, 0, Math.PI * 2);
    ctx.fill();

    // far pines (parallax)
    ctx.fillStyle = 'rgba(22,40,31,.55)';
    const pOff = -S.cam * 0.2;
    for (let i = 0; i < Math.ceil(W / 70) + 3; i++) {
      const px = ((i * 70 + pOff) % (W + 140)) - 70;
      tri(px, wy, 34, 58);
    }
    // water
    g = ctx.createLinearGradient(0, wy, 0, H);
    g.addColorStop(0, '#0F4C52');
    g.addColorStop(1, '#072E33');
    ctx.fillStyle = g;
    ctx.fillRect(0, wy, W, H - wy);
    // sun glitter
    ctx.strokeStyle = 'rgba(255,201,120,.25)';
    for (let i = 0; i < 8; i++) {
      const yy = wy + 8 + i * 10;
      ctx.beginPath();
      ctx.moveTo(W * 0.72 - 40 + Math.sin(S.time * 2 + i) * 8, yy);
      ctx.lineTo(W * 0.72 + 40 + Math.sin(S.time * 2 + i) * 8, yy);
      ctx.stroke();
    }

    const cam = S.cam;
    const wx = x => x - cam;

    // yard markers every 25 yd
    ctx.fillStyle = 'rgba(247,243,231,.35)';
    ctx.font = '14px ui-monospace,monospace';
    ctx.textAlign = 'center';
    for (let ydm = 25; ydm <= MAX_LINE_YD; ydm += 25) {
      const sx = wx(DOCK_X + ydm * YARD);
      if (sx > -40 && sx < W + 40) {
        ctx.fillRect(sx - 1, wy - 6, 2, 6);
        ctx.fillText(ydm, sx, wy + 18);
      }
    }

    // rings
    for (const r of S.rings) {
      const sx = wx(DOCK_X + r.yd * YARD);
      if (sx < -80 || sx > W + 80) continue;
      ctx.strokeStyle = r.hit ? '#FFC978' : 'rgba(247,243,231,.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(sx, wy + 6, r.r * YARD, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // dock
    const dsx = wx(0);
    ctx.fillStyle = '#6E3F22';
    ctx.fillRect(dsx, wy - 14, 110, 10);
    ctx.fillStyle = '#8F5B36';
    for (let i = 0; i < 7; i++) ctx.fillRect(dsx + 2 + i * 15, wy - 14, 12, 10);
    ctx.fillStyle = '#5A331B';
    ctx.fillRect(dsx + 14, wy - 4, 8, 40);
    ctx.fillRect(dsx + 86, wy - 4, 8, 40);

    // golfer — articulated swing
    const gx = wx(DOCK_X - 18);
    const hipY = wy - 32, footY = wy - 13, shX = gx + 2, shY = wy - 47;

    let clubA;
    if (S.phase === 'ready') {
      clubA = A_ADDRESS + Math.sin(S.time * 2) * 0.03;
    } else if (S.phase === 'charge') {
      clubA = topAngle(S.power);
    } else if (S.phase === 'downswing' || (S.phase === 'flight' && S.swingT < SWING_DUR)) {
      const aTop = topAngle(S.lockedPower);
      const pp = Math.min(1, S.swingT / SWING_DUR);
      clubA = aTop + (A_END - aTop) * (pp * pp);
    } else {
      clubA = A_END;
    }

    const lean = (clubA - A_ADDRESS) * 1.6;
    const shx = shX - Math.max(-6, Math.min(6, lean));

    ctx.strokeStyle = '#0E1B14';
    ctx.fillStyle = '#0E1B14';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    // legs
    ctx.beginPath();
    ctx.moveTo(gx, hipY); ctx.lineTo(gx - 7, footY);
    ctx.moveTo(gx, hipY); ctx.lineTo(gx + 7, footY);
    // torso
    ctx.moveTo(gx, hipY); ctx.lineTo(shx, shY);
    ctx.stroke();
    // head
    ctx.beginPath(); ctx.arc(shx + 1, shY - 9, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(shx + 1, shY - 14, 9, 3);
    // arms + club
    const dirX = Math.cos(clubA), dirY = Math.sin(clubA);
    const gripX = shx + dirX * 9,  gripY = shY + dirY * 9;
    const tipX  = shx + dirX * 32, tipY  = shY + dirY * 32;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(shx - 3, shY + 2); ctx.lineTo(gripX, gripY);
    ctx.moveTo(shx + 3, shY + 1); ctx.lineTo(gripX, gripY);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(gripX, gripY); ctx.lineTo(tipX, tipY); ctx.stroke();
    // club head
    ctx.beginPath(); ctx.arc(tipX, tipY, 3, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1;

    // ball + line
    const preSwing = (S.phase === 'ready' || S.phase === 'charge' || S.phase === 'downswing');
    const ballWX = (S.phase === 'reel' || S.phase === 'landed') ? DOCK_X + S.lineOutYd * YARD : S.ball.x;
    const ballWY = (S.phase === 'flight') ? wy - S.ball.y : preSwing ? wy - 30 : wy + 4;
    const bsx = wx(ballWX), bsy = ballWY;

    // tee peg
    if (preSwing) {
      ctx.strokeStyle = '#5A331B'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bsx, bsy + 5); ctx.lineTo(bsx, wy - 14); ctx.stroke();
      ctx.lineWidth = 1;
    }

    // fishing line
    if (S.phase !== 'snapped') {
      const anchorX = tipX, anchorY = tipY;
      const t = S.tension / 100;
      const sag = (S.phase === 'reel') ? Math.max(2, 40 * (1 - t)) : 22;
      const vib = (t > 0.7) ? Math.sin(S.time * 70) * (t - 0.7) * 14 : 0;
      ctx.strokeStyle = t > 0.85 ? '#FF6B4A' : 'rgba(247,243,231,.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.quadraticCurveTo((anchorX + bsx) / 2, Math.max(anchorY, bsy) + sag + vib, bsx, bsy);
      ctx.stroke();
    }

    // splash
    if (S.splashT > 0) {
      ctx.strokeStyle = 'rgba(247,243,231,' + (S.splashT * 1.6) + ')';
      const rr = (0.5 - S.splashT) * 80 + 8;
      ctx.beginPath(); ctx.ellipse(bsx, wy + 6, rr, rr * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // fish shadow
    if (S.phase === 'reel' && S.fish) {
      const f = S.fish;
      const fy = wy + 22 + Math.sin(S.time * 5) * 4;
      ctx.fillStyle = f.st <= 0 ? 'rgba(180,180,180,.5)' : hexA(f.color, .75);
      ctx.beginPath();
      ctx.ellipse(bsx + (f.mode === 'run' ? 18 : 10), fy, 16 + f.bonus / 40, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bsx + 30 + f.bonus / 40, fy);
      ctx.lineTo(bsx + 40 + f.bonus / 40, fy - 6 + Math.sin(S.time * 10) * 4);
      ctx.lineTo(bsx + 40 + f.bonus / 40, fy + 6);
      ctx.closePath(); ctx.fill();
    }

    // ball trail for neon ball
    if (hasUpgrade('neon_ball') && S.phase === 'flight') {
      if (!S.trail) S.trail = [];
      S.trail.push({ x: bsx, y: bsy });
      if (S.trail.length > 10) S.trail.shift();
    } else if (S.phase !== 'flight') {
      S.trail = [];
    }
    if (S.trail && S.trail.length) {
      for (let i = 0; i < S.trail.length; i++) {
        const pt = S.trail[i];
        const a = ((i + 1) / S.trail.length) * 0.45;
        ctx.fillStyle = `rgba(57, 255, 20, ${a})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, BALL_R * (0.3 + 0.7 * (i / S.trail.length)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ball
    if (hasUpgrade('neon_ball')) {
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#39FF14';
      ctx.fillStyle = '#39FF14';
    } else {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#F7F3E7';
    }
    ctx.beginPath(); ctx.arc(bsx, bsy, BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    drawHUD(wy);
  }

  function tri(x, y, w, h) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w / 2, y - h); ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  function drawHUD(wy) {
    ctx.textAlign = 'left';
    // score
    ctx.fillStyle = '#F7F3E7'; ctx.font = '30px Staatliches, Arial Narrow, sans-serif';
    ctx.fillText(S.score, 18, 40);
    ctx.font = '12px ui-monospace,monospace'; ctx.fillStyle = 'rgba(247,243,231,.6)';
    ctx.fillText('POINTS', 18, 56);

    // balls remaining
    for (let i = 0; i < S.balls; i++) {
      ctx.fillStyle = '#F7F3E7';
      ctx.beginPath(); ctx.arc(30 + i * 20, 76, 6, 0, Math.PI * 2); ctx.fill();
    }

    // wind
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(247,243,231,.85)'; ctx.font = '14px ui-monospace,monospace';
    const wdir = S.wind >= 0 ? '\u2192' : '\u2190';
    ctx.fillText('WIND ' + wdir + ' ' + Math.abs(S.wind).toFixed(0) + ' MPH', W - 18, 34);

    // distance readout
    if (S.phase === 'flight' || S.phase === 'reel') {
      const d = (S.phase === 'flight') ? (S.ball.x - DOCK_X) / YARD : S.lineOutYd;
      ctx.fillText(Math.max(0, d).toFixed(0) + ' YD OUT', W - 18, 54);
      if (S.shotMult > 1 && S.phase === 'reel') { ctx.fillStyle = '#FFC978'; ctx.fillText('RING! 2\u00D7 SHOT', W - 18, 74); }
    }

    ctx.textAlign = 'center';

    // power meter
    if (S.phase === 'charge' || S.phase === 'ready') {
      const mw = Math.min(340, W - 80), mx = (W - mw) / 2, my = H - 64;
      ctx.fillStyle = 'rgba(7,26,22,.7)'; roundRect(mx - 6, my - 6, mw + 12, 26, 8); ctx.fill();
      ctx.fillStyle = 'rgba(247,243,231,.18)'; ctx.fillRect(mx, my, mw * 0.85, 14);
      ctx.fillStyle = 'rgba(196,80,46,.55)';  ctx.fillRect(mx + mw * 0.85, my, mw * 0.15, 14);
      const pw = Math.min(1, S.power / 100) * mw;
      ctx.fillStyle = S.power > 85 ? '#FF6B4A' : '#FFC978';
      ctx.fillRect(mx, my, pw, 14);
      ctx.fillStyle = 'rgba(247,243,231,.8)'; ctx.font = '13px ui-monospace,monospace';
      ctx.fillText(S.phase === 'ready' ? 'HOLD TO SWING' : 'RELEASE TO HIT \u00B7 RED = SNAP RISK', W / 2, my - 12);
    }

    // tension meter
    if (S.phase === 'reel') {
      const mw = Math.min(340, W - 80), mx = (W - mw) / 2, my = H - 64;
      ctx.fillStyle = 'rgba(7,26,22,.7)'; roundRect(mx - 6, my - 6, mw + 12, 26, 8); ctx.fill();
      ctx.fillStyle = 'rgba(247,243,231,.18)'; ctx.fillRect(mx, my, mw, 14);
      const maxTension = hasUpgrade('braided_line') ? 120 : 100;
      const t = Math.min(1, S.tension / maxTension);
      ctx.fillStyle = t > 0.85 ? '#FF6B4A' : t > 0.6 ? '#E08A4E' : '#7FA65A';
      ctx.fillRect(mx, my, mw * t, 14);
      ctx.fillStyle = 'rgba(247,243,231,.85)'; ctx.font = '13px ui-monospace,monospace';
      let hint = 'HOLD TO REEL \u00B7 TENSION SNAPS AT FULL';
      if (S.fish && S.fish.st > 0) hint = S.fish.mode === 'run'
        ? S.fish.name + ' RUNNING \u2014 LET GO!'
        : S.fish.name + ' RESTING \u2014 REEL NOW';
      if (S.fish && S.fish.st <= 0) hint = S.fish.name + ' TIRED \u2014 HAUL IT IN';
      ctx.fillText(hint, W / 2, my - 12);
    }

    // toast
    if (S.toast) {
      const a = Math.min(1, S.toast.t / 0.4);
      ctx.fillStyle = 'rgba(255,201,120,' + a + ')';
      ctx.font = '26px Staatliches, Arial Narrow, sans-serif';
      ctx.fillText(S.toast.text, W / 2, H * 0.28);
    }

    // landed message
    if (S.phase === 'landed' && S.msg) {
      ctx.fillStyle = '#FFC978'; ctx.font = '42px Staatliches, Arial Narrow, sans-serif';
      ctx.fillText(S.msg, W / 2, H * 0.34);
    }
    if (S.phase === 'snapped' && S.msg) {
      ctx.fillStyle = 'rgba(247,243,231,.9)'; ctx.font = '15px ui-monospace,monospace';
      ctx.fillText(S.msg, W / 2, H * 0.52);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- loop ----------
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (S.phase) update(dt);
    if (S.phase) draw();
    requestAnimationFrame(frame);
  }
  newRound();
  requestAnimationFrame(frame);

  const RG_GAME = {
    S,
    newRound,
    nextBall,
    toast,
    onGameOver: null
  };

  if (typeof window !== 'undefined') {
    window.RG_GAME = RG_GAME;
  }
})();
