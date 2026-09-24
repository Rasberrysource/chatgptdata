/*
 * render.js — pseudo-3D canvas renderer.
 * The world is drawn with a simple pinhole projection behind the squad:
 *   s = F / (z - camZ),  screenX = W/2 + (x - camX)·s,  screenY = horizonY + (camH - height)·s
 * Logical canvas width is 400; the height follows the screen's aspect ratio.
 */
(function (root) {
  'use strict';
  const ZGR = root.ZGR;
  const { C, formationRadius, hordeRadius, gateIsGood, clamp } = ZGR;

  const FONT = "'Black Han Sans', 'Arial Black', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  const MAX_SOLDIERS = 220;
  const MAX_ZOMBIES = 150;
  const FAR = 2700;

  const COL = {
    skyTop: '#16131f',
    skyMid: '#3a2731',
    skyLow: '#7a4632',
    sun: 'rgba(255,150,70,0.28)',
    skyline: '#221c26',
    dirt: '#1d1a18',
    roadFar: '#2b2826',
    roadNear: '#48443e',
    curb: '#5b554c',
    paint: 'rgba(222,208,170,0.75)',
    squad: '#3a95f5',
    squadDark: '#1b56a6',
    helmet: '#15407d',
    zombie: '#7ea846',
    zombieDark: '#4e6c2b',
    zombieHead: '#9dc862',
    runner: '#b2a13b',
    tough: '#56733a',
    eye: '#ff4032',
    good: 'rgba(46,140,255,0.36)',
    goodEdge: '#93d3ff',
    bad: 'rgba(240,58,48,0.36)',
    badEdge: '#ff9e90',
  };

  const BARREL = {
    troops: { body: '#2f7de0', band: '#1b4c92', top: '#7ab8ff' },
    weapon: { body: '#e9a92a', band: '#98680f', top: '#ffd98a' },
    rapid: { body: '#ff7a1f', band: '#a3450a', top: '#ffb47a' },
    bomb: { body: '#d63a2c', band: '#7b1a12', top: '#ff907f' },
    freeze: { body: '#39c3e6', band: '#1a7690', top: '#aaeeff' },
  };

  const BULLET_COL = [null, '#fff0b8', '#ffd76b', '#ffc443', '#ffad33', '#ff7a33', '#86f4ff'];

  // Sunflower spiral offsets for crowds, drawn back to front.
  const SPIRAL = [];
  for (let i = 0; i < Math.max(MAX_SOLDIERS, MAX_ZOMBIES); i++) {
    const a = i * 2.399963;
    const r = Math.sqrt(i + 0.5);
    SPIRAL.push({ i, ux: Math.cos(a) * r, uz: Math.sin(a) * r });
  }
  const SPIRAL_ORDER = SPIRAL.slice().sort((p, q) => q.uz - p.uz);

  function hash(n) {
    let x = (n | 0) * 374761393 + 668265263;
    x = (x ^ (x >>> 13)) * 1274126177;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  function Renderer(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.floats = [];
    this.rings = [];
    this.shake = 0;
    this.flashT = 0;
    this.flashCol = '#fff';
    this.muzzle = 0;
    this.time = 0;
    this.deadBoss = null;
    this.lossAcc = { n: 0, t: 0 };
    this.reduced = false;
    try {
      this.reduced = root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      /* no media queries */
    }
    this.skyline = [];
    let x = -20;
    let k = 1;
    while (x < 440) {
      const w = 18 + hash(k) * 40;
      this.skyline.push({ x, w, h: 10 + hash(k + 99) * 42 });
      x += w - 4;
      k++;
    }
    this.resize();
  }

  Renderer.prototype.resize = function () {
    const rect = this.cv.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    this.dpr = Math.min(2, root.devicePixelRatio || 1);
    this.cv.width = Math.round(cssW * this.dpr);
    this.cv.height = Math.round(cssH * this.dpr);
    this.W = 400;
    this.scale = cssW / this.W;
    this.H = cssH / this.scale;
    this.horizonY = this.H * 0.2;
    this.squadY = this.H * 0.78;
    this.camBack = 140;
    const sSquad = (0.92 * this.W) / (2 * C.ROAD_HALF);
    this.F = sSquad * this.camBack;
    this.camH = (this.squadY - this.horizonY) / sSquad;
    this.worldPerCssPx = 1 / (sSquad * this.scale);
    this.cssW = cssW;
  };

  // Projects (x, z, height) and stores the screen point in this.px/this.py. Returns the scale or 0.
  Renderer.prototype.P = function (x, z, y) {
    const dz = z - this.camZ;
    if (dz < 6) return 0;
    const s = this.F / dz;
    this.px = this.W / 2 + (x - this.camX) * s;
    this.py = this.horizonY + (this.camH - (y || 0)) * s;
    return s;
  };

  Renderer.prototype.fade = function (z) {
    return clamp((FAR - (z - this.camZ)) / 700, 0, 1);
  };

  // ---------- effects fed by simulation events ----------
  Renderer.prototype.burst = function (x, z, y, n, color, speed, size, grav) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length > 650) this.parts.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({
        x,
        z,
        y: y + Math.random() * 10,
        vx: Math.cos(a) * sp,
        vz: Math.sin(a) * sp * 0.6,
        vy: speed * (0.4 + Math.random()),
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        color,
        size: size * (0.6 + Math.random() * 0.8),
        grav: grav === undefined ? 520 : grav,
      });
    }
  };

  Renderer.prototype.float = function (text, x, z, y, color, size, life) {
    this.floats.push({ text, x, z, y, vy: 60, life: life || 1.1, max: life || 1.1, color, size: size || 30 });
    if (this.floats.length > 24) this.floats.shift();
  };

  Renderer.prototype.kick = function (amount) {
    if (this.reduced) return;
    this.shake = Math.min(1.2, this.shake + amount);
  };

  Renderer.prototype.onEvent = function (ev, g) {
    const squadTop = 40;
    switch (ev.t) {
      case 'fire':
        this.muzzle = 0.06;
        break;
      case 'gate': {
        const col = ev.good ? '#5fb4ff' : '#ff6a5a';
        this.burst(ev.x, ev.z, 60, 26, col, 160, 5, 300);
        let label;
        if (ev.op === 'mul') label = '×' + ev.v;
        else if (ev.op === 'div') label = '÷' + ev.v;
        else label = (ev.v >= 0 ? '+' : '−') + Math.abs(ev.v);
        this.float(label, g.x, g.z + 20, squadTop + 30, col, 46, 1.2);
        this.flashT = 0.18;
        this.flashCol = ev.good ? 'rgba(80,160,255,0.22)' : 'rgba(255,70,60,0.25)';
        break;
      }
      case 'kill':
        this.burst(ev.x, ev.z, 10, Math.min(10, 2 + ev.n), '#8fcf4f', 150, 4);
        if (ev.big) this.burst(ev.x, ev.z, 30, 16, '#6a9a35', 220, 6);
        break;
      case 'clash':
        this.burst(ev.x, ev.z, 8, Math.min(8, 2 + ev.n), '#d33b2c', 170, 4);
        this.burst(ev.x, ev.z, 8, Math.min(6, 1 + ev.n), '#8fcf4f', 170, 4);
        this.kick(0.05);
        break;
      case 'clashStart':
        this.kick(0.35);
        break;
      case 'loss':
        this.lossAcc.n += ev.n;
        if (ev.cause !== 'horde') this.burst(g.x, g.z, 10, Math.min(18, 3 + ev.n), '#d33b2c', 180, 4);
        break;
      case 'gain':
        if (ev.n > 0) this.float('+' + ev.n, g.x, g.z + 20, squadTop + 20, '#6cc0ff', 34, 1);
        break;
      case 'barrel': {
        const b = BARREL[ev.type];
        this.burst(ev.x, ev.z, 25, 22, b.body, 200, 5);
        this.burst(ev.x, ev.z, 25, 10, b.top, 140, 4);
        const names = { weapon: '무기 강화!', rapid: '연사!', freeze: '빙결!', bomb: '' };
        if (names[ev.type]) this.float(names[ev.type], ev.x, ev.z, 70, b.top, 30, 1.1);
        break;
      }
      case 'weapon':
        this.flashT = 0.15;
        this.flashCol = 'rgba(255,200,80,0.2)';
        break;
      case 'bomb':
        this.rings.push({ x: ev.x, z: ev.z, r: 10, max: ev.r, life: 0.55, t: 0 });
        this.burst(ev.x, ev.z, 20, 46, '#ff8a2a', 330, 7, 400);
        this.burst(ev.x, ev.z, 20, 24, '#ffd36b', 260, 5, 300);
        this.kick(0.8);
        this.flashT = 0.22;
        this.flashCol = 'rgba(255,150,60,0.3)';
        break;
      case 'splash':
        this.rings.push({ x: ev.x, z: ev.z, r: 6, max: ev.r, life: 0.25, t: 0 });
        this.burst(ev.x, ev.z, 14, 6, '#ff9a3a', 180, 4);
        break;
      case 'freeze':
        break;
      case 'smash':
        this.burst(ev.x, ev.z, 20, 26, '#d33b2c', 240, 5);
        this.kick(0.7);
        break;
      case 'debris':
        this.burst(ev.x, ev.z, 12, 18, '#39363a', 220, 6);
        break;
      case 'crush':
        this.burst(ev.x, ev.z, 10, 8, '#6a6258', 120, 4);
        break;
      case 'boss':
        this.kick(0.5);
        break;
      case 'bossContact':
        this.kick(0.9);
        break;
      case 'summon':
        this.burst(ev.x, ev.z, 20, 14, '#7fb84a', 160, 5);
        break;
      case 'bossDown':
        this.deadBoss = { x: ev.x, z: ev.z, t: 0 };
        this.burst(ev.x, ev.z, 80, 70, '#8fcf4f', 360, 7, 420);
        this.burst(ev.x, ev.z, 80, 40, '#ffd36b', 300, 6, 380);
        this.rings.push({ x: ev.x, z: ev.z, r: 20, max: 260, life: 0.7, t: 0 });
        this.kick(1.2);
        this.flashT = 0.3;
        this.flashCol = 'rgba(255,255,255,0.35)';
        break;
    }
  };

  // ---------- frame ----------
  Renderer.prototype.draw = function (g, dt) {
    const ctx = this.ctx;
    this.time += dt;
    this.blink = Math.floor(this.time * 24) % 3 === 0;
    this.camZ = g.z - this.camBack;
    this.camX = g.x * 0.2;

    let ox = 0;
    let oy = 0;
    if (this.shake > 0) {
      ox = (Math.random() - 0.5) * this.shake * 10;
      oy = (Math.random() - 0.5) * this.shake * 10;
      this.shake = Math.max(0, this.shake - dt * 2.6);
    }
    const k = this.dpr * this.scale;
    ctx.setTransform(k, 0, 0, k, ox * k, oy * k);
    ctx.lineJoin = 'round';

    this.drawSky();
    this.drawGround();
    this.drawRoad();
    this.drawProps();

    const list = [];
    for (const e of g.ents) {
      if (!e.alive) continue;
      const dz = e.z - this.camZ;
      if (dz > 20 && dz < FAR) list.push(e);
    }
    if (g.boss && g.boss.alive) list.push(g.boss);
    list.sort((a, b) => b.z - a.z);

    let i = 0;
    for (; i < list.length && list[i].z >= g.z - 4; i++) this.drawEnt(list[i], g);
    if (this.deadBoss) this.drawDeadBoss(dt);
    this.drawRings(dt);
    this.drawBullets(g);
    this.drawSquad(g);
    this.muzzle -= dt;
    for (; i < list.length; i++) this.drawEnt(list[i], g);
    this.drawParticles(dt);
    this.drawCount(g, dt);
    this.drawFloats(dt);

    if (this.flashT > 0) {
      ctx.fillStyle = this.flashCol;
      ctx.globalAlpha = clamp(this.flashT / 0.2, 0, 1);
      ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
      ctx.globalAlpha = 1;
      this.flashT -= dt;
    }
    if (g.freezeT > 0) {
      ctx.fillStyle = 'rgba(120,210,255,0.08)';
      ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
    }
  };

  Renderer.prototype.drawSky = function () {
    const ctx = this.ctx;
    const hy = this.horizonY;
    const grd = ctx.createLinearGradient(0, 0, 0, hy);
    grd.addColorStop(0, COL.skyTop);
    grd.addColorStop(0.6, COL.skyMid);
    grd.addColorStop(1, COL.skyLow);
    ctx.fillStyle = grd;
    ctx.fillRect(-20, -20, this.W + 40, hy + 21);
    ctx.fillStyle = COL.sun;
    ctx.beginPath();
    ctx.arc(this.W * 0.68 - this.camX * 0.05, hy - 6, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COL.skyline;
    const shift = -this.camX * 0.08;
    for (const b of this.skyline) ctx.fillRect(b.x + shift, hy - b.h, b.w, b.h + 1);
  };

  Renderer.prototype.drawGround = function () {
    const ctx = this.ctx;
    const grd = ctx.createLinearGradient(0, this.horizonY, 0, this.H);
    grd.addColorStop(0, '#3a2a26');
    grd.addColorStop(0.25, COL.dirt);
    grd.addColorStop(1, '#141210');
    ctx.fillStyle = grd;
    ctx.fillRect(-20, this.horizonY, this.W + 40, this.H - this.horizonY + 20);
  };

  Renderer.prototype.nearZ = function () {
    return this.camZ + (this.F * this.camH) / (this.H + 30 - this.horizonY);
  };

  Renderer.prototype.drawRoad = function () {
    const ctx = this.ctx;
    const zn = this.nearZ();
    const zf = this.camZ + 6000;
    const quad = (xa, xb, za, zb, fill) => {
      this.P(xa, za);
      const ax = this.px;
      const ay = this.py;
      this.P(xb, za);
      const bx = this.px;
      this.P(xb, zb);
      const cx = this.px;
      const cy = this.py;
      this.P(xa, zb);
      const dx = this.px;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, ay);
      ctx.lineTo(cx, cy);
      ctx.lineTo(dx, cy);
      ctx.closePath();
      ctx.fill();
    };
    const grd = ctx.createLinearGradient(0, this.horizonY, 0, this.H);
    grd.addColorStop(0, COL.roadFar);
    grd.addColorStop(1, COL.roadNear);
    quad(-C.ROAD_HALF - 22, C.ROAD_HALF + 22, zn, zf, COL.curb);
    quad(-C.ROAD_HALF, C.ROAD_HALF, zn, zf, grd);

    // cracks and patches that scroll past
    const step = 90;
    const first = Math.floor(zn / step);
    for (let k = first + 18; k >= first; k--) {
      const h = hash(k * 7 + 3);
      if (h > 0.55) continue;
      const z = k * step;
      const x = (hash(k * 13) - 0.5) * 240;
      const w = 20 + hash(k * 5) * 50;
      quad(x, x + w, z, z + 12 + h * 30, 'rgba(0,0,0,0.16)');
    }
    // centre dashes and edge lines
    const dash = 120;
    const d0 = Math.floor(zn / dash);
    for (let k = d0 + 30; k >= d0; k--) {
      const z = k * dash;
      quad(-3, 3, z, z + 55, COL.paint);
    }
    quad(-C.ROAD_HALF + 3, -C.ROAD_HALF + 8, zn, zf, 'rgba(222,208,170,0.5)');
    quad(C.ROAD_HALF - 8, C.ROAD_HALF - 3, zn, zf, 'rgba(222,208,170,0.5)');
  };

  Renderer.prototype.drawProps = function () {
    const ctx = this.ctx;
    const slot = 230;
    const zn = this.nearZ();
    const s0 = Math.floor((zn - 200) / slot);
    const s1 = Math.floor((this.camZ + FAR) / slot);
    for (let k = s1; k >= s0; k--) {
      for (const side of [-1, 1]) {
        const h1 = hash(k * 31 + (side > 0 ? 7 : 0));
        if (h1 < 0.18) continue;
        const z = k * slot + hash(k * 17 + side) * 60;
        const inner = 196 + hash(k * 3 + side) * 40;
        const w = 90 + hash(k * 11 + side) * 120;
        const h = 90 + hash(k * 23 + side) * 300;
        const depth = 120 + hash(k * 29 + side) * 70;
        const xin = side * inner;
        const xout = side * (inner + w);
        const fade = this.fade(z);
        if (fade <= 0) continue;
        const shade = 30 + Math.floor(h1 * 14);
        // side wall facing the road
        if (this.P(xin, z) === 0) continue;
        const ax = this.px;
        const ay = this.py;
        this.P(xin, z, h);
        const aty = this.py;
        this.P(xin, z + depth);
        const bx = this.px;
        const by = this.py;
        this.P(xin, z + depth, h);
        const bty = this.py;
        ctx.globalAlpha = fade;
        ctx.fillStyle = `rgb(${shade - 8},${shade - 12},${shade - 4})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax, aty);
        ctx.lineTo(bx, bty);
        ctx.lineTo(bx, by);
        ctx.closePath();
        ctx.fill();
        // front face
        this.P(xout, z, h);
        const fx = this.px;
        const fy = this.py;
        ctx.fillStyle = `rgb(${shade},${shade - 5},${shade + 4})`;
        ctx.fillRect(Math.min(ax, fx), fy, Math.abs(fx - ax), ay - fy);
        // lit windows
        const cols = 3;
        const rows = Math.max(1, Math.floor(h / 60));
        const s = this.F / (z - this.camZ);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const hw = hash(k * 97 + r * 7 + c * 3 + side);
            if (hw > 0.3) continue;
            const wx = xin + side * (18 + c * (w - 30) / cols);
            this.P(wx, z, 30 + r * 60);
            ctx.fillStyle = hw < 0.12 ? 'rgba(255,190,90,0.75)' : 'rgba(255,160,70,0.35)';
            ctx.fillRect(this.px - 6 * s, this.py - 14 * s, 12 * s, 14 * s);
          }
        }
        ctx.globalAlpha = 1;
      }
    }
    // haze near the horizon
    const hz = this.horizonY;
    const grd = ctx.createLinearGradient(0, hz - 4, 0, hz + this.H * 0.16);
    grd.addColorStop(0, 'rgba(92,56,44,0.95)');
    grd.addColorStop(1, 'rgba(92,56,44,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(-20, hz - 4, this.W + 40, this.H * 0.16 + 4);
  };

  // ---------- entities ----------
  Renderer.prototype.drawEnt = function (e, g) {
    const a = this.fade(e.z);
    if (a <= 0) return;
    this.ctx.globalAlpha = a;
    switch (e.kind) {
      case 'gate':
        this.drawGate(e);
        break;
      case 'barrel':
        this.drawBarrel(e);
        break;
      case 'horde':
        this.drawHorde(e);
        break;
      case 'brute':
        this.drawBrute(e);
        break;
      case 'tires':
        this.drawTires(e);
        break;
      case 'saw':
        this.drawSaw(e);
        break;
      case 'spikes':
        this.drawSpikes(e);
        break;
      case 'boss':
        this.drawBoss(e, g);
        break;
    }
    this.ctx.globalAlpha = 1;
  };

  Renderer.prototype.label = function (text, x, y, size, fill, stroke) {
    const ctx = this.ctx;
    if (size < 7) return;
    ctx.font = `${size.toFixed(1)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.strokeStyle = stroke || '#0b0a10';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill || '#fff';
    ctx.fillText(text, x, y);
  };

  function gateText(e) {
    if (e.op === 'mul') return '×' + e.v;
    if (e.op === 'div') return '÷' + e.v;
    return (e.v >= 0 ? '+' : '−') + Math.abs(e.v);
  }

  Renderer.prototype.drawGate = function (e) {
    const ctx = this.ctx;
    const good = gateIsGood(e);
    const s = this.P(e.x0 + 5, e.z, 0);
    if (!s) return;
    const left = this.px;
    const bottom = this.py;
    this.P(e.x1 - 5, e.z, 120);
    const right = this.px;
    const top = this.py;
    ctx.fillStyle = good ? COL.good : COL.bad;
    ctx.fillRect(left, top, right - left, bottom - top);
    if (e.flash > 0 && this.blink) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(left, top, right - left, bottom - top);
    }
    // shimmer stripes
    ctx.fillStyle = good ? 'rgba(160,215,255,0.12)' : 'rgba(255,170,160,0.12)';
    const t = (this.time * 0.8) % 1;
    for (let k = 0; k < 3; k++) {
      const yy = top + ((k / 3 + t) % 1) * (bottom - top);
      ctx.fillRect(left, yy, right - left, Math.max(1, 5 * s));
    }
    const edge = good ? COL.goodEdge : COL.badEdge;
    ctx.fillStyle = edge;
    const post = Math.max(2, 7 * s);
    ctx.fillRect(left - post / 2, top, post, bottom - top);
    ctx.fillRect(right - post / 2, top, post, bottom - top);
    ctx.fillRect(left - post / 2, top - post, right - left + post, post * 1.4);
    this.label(gateText(e), (left + right) / 2, top + (bottom - top) * 0.46, Math.min(96, 64 * s), '#ffffff', good ? '#0b2a57' : '#4a0d08');
  };

  Renderer.prototype.drawBarrel = function (e) {
    const ctx = this.ctx;
    const s = this.P(e.x, e.z, 0);
    if (!s) return;
    const cx = this.px;
    const by = this.py;
    const w = 38 * s;
    const h = 48 * s;
    const col = BARREL[e.type];
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, by, w * 0.62, w * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = (e.flash > 0 && this.blink) ? '#ffffff' : col.body;
    ctx.fillRect(cx - w / 2, by - h, w, h);
    ctx.fillStyle = col.band;
    ctx.fillRect(cx - w / 2, by - h * 0.78, w, h * 0.08);
    ctx.fillRect(cx - w / 2, by - h * 0.3, w, h * 0.08);
    ctx.fillStyle = col.top;
    ctx.beginPath();
    ctx.ellipse(cx, by - h, w / 2, w * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    this.drawIcon(e.type, cx, by - h * 0.54, w * 0.62, e.amount);
    this.label(String(Math.ceil(e.hp)), cx, by - h - 18 * s, Math.min(56, 30 * s), '#fff');
  };

  Renderer.prototype.drawIcon = function (type, cx, cy, size, amount) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    const u = size / 10;
    switch (type) {
      case 'troops':
        this.label('+' + amount, 0, 0, Math.min(40, size * 0.72), '#fff', '#0d2c5c');
        break;
      case 'weapon':
        ctx.fillRect(-4.5 * u, -2 * u, 9 * u, 2.6 * u);
        ctx.fillRect(-4.5 * u, -2 * u, 2.6 * u, 5.5 * u);
        ctx.fillRect(3 * u, -1.4 * u, 2.4 * u, 1.2 * u);
        break;
      case 'rapid':
        ctx.beginPath();
        ctx.moveTo(1 * u, -5 * u);
        ctx.lineTo(-3 * u, 0.5 * u);
        ctx.lineTo(-0.2 * u, 0.5 * u);
        ctx.lineTo(-1.2 * u, 5 * u);
        ctx.lineTo(3 * u, -0.8 * u);
        ctx.lineTo(0.2 * u, -0.8 * u);
        ctx.closePath();
        ctx.fill();
        break;
      case 'bomb':
        ctx.beginPath();
        ctx.arc(0, 0.8 * u, 3.4 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = Math.max(1, u);
        ctx.beginPath();
        ctx.moveTo(1.8 * u, -2 * u);
        ctx.quadraticCurveTo(3.5 * u, -4.5 * u, 4.6 * u, -3.4 * u);
        ctx.stroke();
        break;
      case 'freeze':
        ctx.lineWidth = Math.max(1, 1.2 * u);
        for (let k = 0; k < 3; k++) {
          const a = (k * Math.PI) / 3;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 4.5 * u, Math.sin(a) * 4.5 * u);
          ctx.lineTo(-Math.cos(a) * 4.5 * u, -Math.sin(a) * 4.5 * u);
          ctx.stroke();
        }
        break;
    }
    ctx.restore();
  };

  Renderer.prototype.drawCrowd = function (cx, cz, n, radius, drawOne) {
    const shown = Math.min(n, MAX_ZOMBIES);
    const c = shown > 0 ? Math.max(3.5, (radius - 4) / Math.sqrt(shown)) : 0;
    for (const p of SPIRAL_ORDER) {
      if (p.i >= shown) continue;
      drawOne(cx + p.ux * c, cz + p.uz * c * C.FORM_DEPTH, p.i);
    }
  };

  Renderer.prototype.drawZombie = function (x, z, i, body, head, big) {
    const s = this.P(x, z, 0);
    if (!s) return;
    const ctx = this.ctx;
    const bob = Math.abs(Math.sin(this.time * 9 + i * 1.7)) * 2.4 * s;
    const w = (big ? 10 : 7.5) * s;
    const h = (big ? 16 : 12.5) * s;
    const x0 = this.px;
    const y0 = this.py - bob;
    ctx.fillStyle = body;
    ctx.fillRect(x0 - w / 2, y0 - h, w, h);
    // arms reaching forward
    ctx.fillRect(x0 - w * 0.75, y0 - h * 0.85, w * 0.3, h * 0.45);
    ctx.fillRect(x0 + w * 0.45, y0 - h * 0.85, w * 0.3, h * 0.45);
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(x0, y0 - h - w * 0.35, w * 0.45, 0, Math.PI * 2);
    ctx.fill();
    if (s > 0.55) {
      ctx.fillStyle = COL.eye;
      ctx.fillRect(x0 - w * 0.25, y0 - h - w * 0.45, w * 0.16, w * 0.16);
      ctx.fillRect(x0 + w * 0.09, y0 - h - w * 0.45, w * 0.16, w * 0.16);
    }
  };

  Renderer.prototype.drawHorde = function (e) {
    const tough = e.zh >= 3;
    const body = (e.flash > 0 && this.blink) ? '#d7f0b0' : e.style === 'runner' ? COL.runner : tough ? COL.tough : COL.zombie;
    const head = tough ? '#86a65a' : COL.zombieHead;
    const r = hordeRadius(e.count);
    this.drawCrowd(e.x, e.z, e.count, r, (x, z, i) => this.drawZombie(x, z, i, body, head, tough));
    const s = this.P(e.x, e.z + r * C.FORM_DEPTH, 46);
    if (s) this.label(String(e.count), this.px, this.py, Math.min(58, 36 * s), '#ffe3dc', '#4a0d08');
  };

  Renderer.prototype.drawBrute = function (e) {
    const ctx = this.ctx;
    const s = this.P(e.x, e.z, 0);
    if (!s) return;
    const x0 = this.px;
    const y0 = this.py - Math.abs(Math.sin(this.time * 5)) * 3 * s;
    const w = 46 * s;
    const h = 60 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x0, this.py, w * 0.7, w * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = (e.flash > 0 && this.blink) ? '#e6f5c8' : '#56733a';
    ctx.fillRect(x0 - w / 2, y0 - h, w, h);
    ctx.fillRect(x0 - w * 0.85, y0 - h * 0.9, w * 0.32, h * 0.62);
    ctx.fillRect(x0 + w * 0.53, y0 - h * 0.9, w * 0.32, h * 0.62);
    ctx.fillStyle = '#7fa04c';
    ctx.beginPath();
    ctx.arc(x0, y0 - h - w * 0.2, w * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COL.eye;
    ctx.fillRect(x0 - w * 0.16, y0 - h - w * 0.28, w * 0.1, w * 0.08);
    ctx.fillRect(x0 + w * 0.06, y0 - h - w * 0.28, w * 0.1, w * 0.08);
    this.label(String(Math.ceil(e.hp)), x0, y0 - h - w * 0.8, Math.min(56, 30 * s), '#ffe3dc', '#4a0d08');
  };

  Renderer.prototype.drawTires = function (e) {
    const ctx = this.ctx;
    const s = this.P(e.x, e.z, 0);
    if (!s) return;
    const cx = this.px;
    const by = this.py;
    const r = 14 * s;
    const rows = [
      [-2, -1, 0, 1, 2],
      [-1.5, -0.5, 0.5, 1.5],
    ];
    rows.forEach((row, ri) => {
      for (const k of row) {
        const x = cx + k * r * 1.5;
        const y = by - r - ri * r * 1.6;
        ctx.fillStyle = (e.flash > 0 && this.blink) ? '#6a666e' : '#1c1b1f';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3a373e';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    this.label(String(Math.ceil(e.hp)), cx, by - r * 4.2, Math.min(52, 28 * s), '#fff');
  };

  Renderer.prototype.drawSaw = function (e) {
    const ctx = this.ctx;
    const s = this.P(-C.ROAD_HALF, e.z, 6);
    if (!s) return;
    const lx = this.px;
    const ly = this.py;
    this.P(C.ROAD_HALF, e.z, 6);
    ctx.strokeStyle = '#26232a';
    ctx.lineWidth = Math.max(2, 6 * s);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(this.px, this.py);
    ctx.stroke();
    this.P(e.x, e.z, 30);
    const cx = this.px;
    const cy = this.py;
    const R = e.halfW * s;
    const rot = this.time * 14;
    ctx.fillStyle = '#c9ccd2';
    ctx.beginPath();
    const teeth = 14;
    for (let k = 0; k < teeth * 2; k++) {
      const a = rot + (k * Math.PI) / teeth;
      const rr = k % 2 === 0 ? R : R * 0.8;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8c2a22';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.28, 0, Math.PI * 2);
    ctx.fill();
  };

  Renderer.prototype.drawSpikes = function (e) {
    const ctx = this.ctx;
    const s = this.P(e.x0, e.z, 0);
    if (!s) return;
    const x0 = this.px;
    const y0 = this.py;
    this.P(e.x1, e.z, 0);
    const x1 = this.px;
    ctx.fillStyle = '#4a2622';
    ctx.fillRect(x0, y0 - 6 * s, x1 - x0, 6 * s);
    ctx.fillStyle = '#c3c7cf';
    const n = Math.max(2, Math.round((e.x1 - e.x0) / 14));
    const w = (x1 - x0) / n;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = x0 + k * w;
      ctx.moveTo(a, y0 - 5 * s);
      ctx.lineTo(a + w / 2, y0 - 30 * s);
      ctx.lineTo(a + w, y0 - 5 * s);
    }
    ctx.fill();
  };

  Renderer.prototype.drawBossShape = function (b, x, z, sink, flash, swing) {
    const ctx = this.ctx;
    const s = this.P(x, z, 0);
    if (!s) return;
    const x0 = this.px;
    const ground = this.py;
    const walk = Math.sin(this.time * 4) * 4 * s;
    const y0 = ground + sink * s;
    const w = 120 * s;
    const h = 150 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x0, ground, w * 0.7, w * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // legs
    ctx.fillStyle = flash ? '#f2dcff' : '#3f3456';
    ctx.fillRect(x0 - w * 0.38, y0 - h * 0.34 + walk, w * 0.26, h * 0.34 - walk);
    ctx.fillRect(x0 + w * 0.12, y0 - h * 0.34 - walk, w * 0.26, h * 0.34 + walk);
    // torso
    ctx.fillStyle = flash ? '#fbefff' : '#5b4a78';
    ctx.fillRect(x0 - w / 2, y0 - h, w, h * 0.7);
    // arms
    const arm = swing ? Math.sin(this.time * 9) * 18 * s : 0;
    ctx.fillStyle = flash ? '#f2dcff' : '#4a3d63';
    ctx.fillRect(x0 - w * 0.78, y0 - h * 0.98 + arm, w * 0.3, h * 0.72);
    ctx.fillRect(x0 + w * 0.48, y0 - h * 0.98 - arm, w * 0.3, h * 0.72);
    // growths
    ctx.fillStyle = '#9dc862';
    ctx.beginPath();
    ctx.arc(x0 - w * 0.2, y0 - h * 0.72, w * 0.1, 0, Math.PI * 2);
    ctx.arc(x0 + w * 0.26, y0 - h * 0.5, w * 0.07, 0, Math.PI * 2);
    ctx.fill();
    // head
    ctx.fillStyle = flash ? '#fbefff' : '#6d5a8c';
    ctx.beginPath();
    ctx.arc(x0, y0 - h - w * 0.12, w * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff3b2e';
    ctx.fillRect(x0 - w * 0.15, y0 - h - w * 0.2, w * 0.09, w * 0.06);
    ctx.fillRect(x0 + w * 0.06, y0 - h - w * 0.2, w * 0.09, w * 0.06);
    ctx.fillStyle = '#1a0f16';
    ctx.fillRect(x0 - w * 0.12, y0 - h - w * 0.02, w * 0.24, w * 0.05);
  };

  Renderer.prototype.drawBoss = function (b) {
    this.drawBossShape(b, b.x, b.z, 0, b.flash > 0 && this.blink, b.contact);
  };

  Renderer.prototype.drawDeadBoss = function (dt) {
    const d = this.deadBoss;
    d.t += dt;
    if (d.t > 1.4) {
      this.deadBoss = null;
      return;
    }
    this.ctx.globalAlpha = clamp(1 - d.t / 1.4, 0, 1);
    this.drawBossShape(d, d.x, d.z, d.t * 90, true, false);
    this.ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawRings = function (dt) {
    const ctx = this.ctx;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const s = this.P(r.x, r.z, 2);
      if (!s) continue;
      const rad = (r.r + (r.max - r.r) * k) * s;
      ctx.strokeStyle = `rgba(255,${170 - k * 90},60,${1 - k})`;
      ctx.lineWidth = Math.max(1, 10 * s * (1 - k));
      ctx.beginPath();
      ctx.ellipse(this.px, this.py, rad, rad * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  // ---------- squad and bullets ----------
  Renderer.prototype.drawSquad = function (g) {
    const n = Math.min(g.count, MAX_SOLDIERS);
    if (n <= 0) return;
    const ctx = this.ctx;
    const R = formationRadius(g.count);
    const c = Math.max(3.2, R / Math.sqrt(Math.max(1, n)));
    const s0 = this.P(g.x, g.z, 0);
    if (s0) {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(this.px, this.py, (R + 8) * s0, (R * C.FORM_DEPTH + 5) * s0 * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const muzzle = this.muzzle > 0;
    for (const p of SPIRAL_ORDER) {
      if (p.i >= n) continue;
      const x = g.x + p.ux * c;
      const z = g.z + p.uz * c * C.FORM_DEPTH;
      const s = this.P(x, z, 0);
      if (!s) continue;
      const bob = Math.abs(Math.sin(this.time * 13 + p.i * 0.9)) * 2.2 * s;
      const w = 7.5 * s;
      const h = 11.5 * s;
      const x0 = this.px;
      const y0 = this.py - bob;
      ctx.fillStyle = COL.squadDark;
      ctx.fillRect(x0 - w / 2, y0 - h, w, h);
      ctx.fillStyle = COL.squad;
      ctx.fillRect(x0 - w / 2 + s, y0 - h + s, w - 2 * s, h * 0.62);
      ctx.fillStyle = COL.helmet;
      ctx.beginPath();
      ctx.arc(x0, y0 - h - w * 0.28, w * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1b20';
      ctx.fillRect(x0 + w * 0.2, y0 - h * 0.95, w * 0.22, h * 0.55);
      if (muzzle && p.uz > 0.5) {
        ctx.fillStyle = 'rgba(255,220,120,0.9)';
        ctx.fillRect(x0 + w * 0.12, y0 - h * 1.3, w * 0.38, w * 0.38);
      }
    }
  };

  Renderer.prototype.drawBullets = function (g) {
    const ctx = this.ctx;
    if (!g.bullets.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const lv = g.weapon;
    const col = BULLET_COL[lv] || '#fff';
    const wide = lv === 6 ? 2.2 : lv === 5 ? 3.2 : 1.5;
    ctx.strokeStyle = col;
    for (const b of g.bullets) {
      if (!b.alive) continue;
      const s = this.P(b.x, b.z, 16);
      if (!s) continue;
      const x1 = this.px;
      const y1 = this.py;
      this.P(b.x, b.z - (b.lv === 6 ? 50 : 28), 16);
      ctx.lineWidth = Math.max(1, wide * 2.2 * s);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(this.px, this.py);
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype.drawCount = function (g, dt) {
    if (g.count <= 0) return;
    const R = formationRadius(g.count);
    const s = this.P(g.x, g.z + R * C.FORM_DEPTH, 30);
    if (!s) return;
    const ctx = this.ctx;
    const text = String(g.count);
    ctx.font = `26px ${FONT}`;
    const tw = ctx.measureText(text).width;
    const w = tw + 26;
    const h = 34;
    const x = this.px - w / 2;
    const y = this.py - h - R * 0.55 * s;
    ctx.fillStyle = '#1e6bd0';
    ctx.strokeStyle = '#bfe0ff';
    ctx.lineWidth = 2.5;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.px, y + h / 2 + 1);
    // soldiers lost since the last moment: red tally beside the badge
    const la = this.lossAcc;
    if (la.n > 0) {
      la.t += dt;
      if (la.t > 0.25) {
        this.float('−' + la.n, g.x + R * 0.6 + 20, g.z + R * C.FORM_DEPTH, 60, '#ff6a5a', 26, 0.8);
        la.n = 0;
        la.t = 0;
      }
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  Renderer.prototype.drawParticles = function (dt) {
    const ctx = this.ctx;
    const ps = this.parts;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.vy -= p.grav * dt;
      p.y += p.vy * dt;
      if (p.y < 0) {
        p.y = 0;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const s = this.P(p.x, p.z, p.y);
      if (s) {
        const sz = Math.max(1, p.size * s);
        ctx.globalAlpha = clamp(p.life * 2, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(this.px - sz / 2, this.py - sz / 2, sz, sz);
      }
      ps[w++] = p;
    }
    ps.length = w;
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawFloats = function (dt) {
    const fl = this.floats;
    let w = 0;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      f.life -= dt;
      if (f.life <= 0) continue;
      f.y += f.vy * dt;
      f.vy *= 0.96;
      const s = this.P(f.x, f.z, f.y);
      if (s) {
        const k = f.life / f.max;
        const pop = k > 0.85 ? 1 + (k - 0.85) * 3 : 1;
        this.ctx.globalAlpha = clamp(k * 2.5, 0, 1);
        this.label(f.text, this.px, this.py, f.size * clamp(s, 0.7, 1.3) * pop, f.color, '#0b0a10');
      }
      fl[w++] = f;
    }
    fl.length = w;
    this.ctx.globalAlpha = 1;
  };

  Renderer.prototype.reset = function () {
    this.parts.length = 0;
    this.floats.length = 0;
    this.rings.length = 0;
    this.shake = 0;
    this.flashT = 0;
    this.deadBoss = null;
    this.lossAcc = { n: 0, t: 0 };
  };

  ZGR.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
