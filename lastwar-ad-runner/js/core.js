/*
 * core.js — rules and simulation for the gate runner.
 * No DOM access: runs in the browser and in Node (tools/balance.js).
 * World units: the road spans x = -150..150, z grows forward.
 */
(function (root) {
  'use strict';
  const ZGR = (root.ZGR = root.ZGR || {});

  // ---------- random numbers (seeded, deterministic) ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Rng(seed) {
    this.next = mulberry32(seed);
  }
  Rng.prototype.f = function (a, b) {
    if (a === undefined) return this.next();
    return a + (b - a) * this.next();
  };
  Rng.prototype.i = function (a, b) {
    return Math.floor(a + (b - a + 1) * this.next());
  };
  Rng.prototype.pick = function (arr) {
    return arr[Math.floor(this.next() * arr.length)];
  };
  Rng.prototype.chance = function (p) {
    return this.next() < p;
  };
  Rng.prototype.weighted = function (entries) {
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.next() * total;
    for (const e of entries) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return entries[entries.length - 1][0];
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- tuning constants ----------
  const C = {
    DT: 1 / 60,
    ROAD_HALF: 150,
    MOVE_LIMIT: 130,
    RUN_SPEED: 170,
    STEER_SPEED: 720,
    BULLET_SPEED: 900,
    BULLET_RANGE: 800,
    MAX_SQUAD: 999,
    FORM_C: 6,
    FORM_MAX_R: 85,
    FORM_DEPTH: 0.45,
    ACTIVATE_DIST: 1150,
    RAPID_TIME: 8,
    FREEZE_TIME: 6,
    FREEZE_SLOW: 0.45,
    BOMB_RADIUS: 220,
    BOSS_START_DIST: 540,
    BOSS_HALF_W: 70,
    CLASH_RATE: 0.12,
    CONTACT: 0.8, // fraction of the summed radii that counts as touching
    LUNGE_DIST: 320, // hordes and brutes this close lunge sideways at the squad
  };

  const WEAPONS = [
    null,
    { lv: 1, name: '권총', interval: 0.4, dmg: 1 },
    { lv: 2, name: '소총', interval: 0.3, dmg: 1.5 },
    { lv: 3, name: '기관단총', interval: 0.16, dmg: 1.5 },
    { lv: 4, name: '기관총', interval: 0.11, dmg: 2 },
    { lv: 5, name: '로켓포', interval: 0.45, dmg: 12, splash: 45 },
    { lv: 6, name: '레이저', interval: 0.09, dmg: 3.5, pierce: 3 },
  ];
  const MAX_WEAPON = WEAPONS.length - 1;

  // ---------- formation / firepower helpers ----------
  function formationRadius(n) {
    return Math.min(C.FORM_MAX_R, C.FORM_C * Math.sqrt(Math.max(1, n)));
  }
  function formationDepth(n) {
    return formationRadius(n) * C.FORM_DEPTH;
  }
  function bulletsPerVolley(n) {
    return clamp(Math.round(1.25 * Math.sqrt(Math.max(1, n))), 1, 24);
  }
  function weaponDps(n, lv) {
    const w = WEAPONS[clamp(lv, 1, MAX_WEAPON)];
    return (bulletsPerVolley(n) * w.dmg) / w.interval;
  }
  // Bullets of one volley whose lane falls inside [lo, hi] when the squad centre is at x.
  function volleyHits(n, x, lo, hi) {
    const b = bulletsPerVolley(n);
    if (b === 1) return x >= lo && x <= hi ? 1 : 0;
    const r = formationRadius(n) * 0.9;
    let hits = 0;
    for (let i = 0; i < b; i++) {
      const bx = x + ((i / (b - 1)) * 2 - 1) * r;
      if (bx >= lo && bx <= hi) hits++;
    }
    return hits;
  }
  // Damage per second the squad puts into a target spanning [lo, hi].
  function targetDps(n, lv, x, lo, hi, rapid) {
    const w = WEAPONS[clamp(lv, 1, MAX_WEAPON)];
    return (volleyHits(n, x, lo, hi) * w.dmg) / (w.interval * (rapid ? 0.5 : 1));
  }

  function hordeRadius(count) {
    return Math.min(110, 8 + 4.2 * Math.sqrt(Math.max(1, count)));
  }
  function overlapFrac(cx, r, x0, x1) {
    const a = Math.max(cx - r, x0);
    const b = Math.min(cx + r, x1);
    if (b <= a) return 0;
    return (b - a) / (2 * r);
  }
  function gateResult(n, gate) {
    let out = n;
    if (gate.op === 'add') out = n + gate.v;
    else if (gate.op === 'mul') out = n * gate.v;
    else if (gate.op === 'div') out = Math.max(1, Math.floor(n / gate.v));
    return clamp(Math.round(out), 0, C.MAX_SQUAD);
  }
  function gateIsGood(gate) {
    if (gate.op === 'add') return gate.v >= 0;
    return gate.op === 'mul';
  }
  // Sideways distance a horde or brute can cover in `tc` seconds, lunge included.
  function moverReach(e, dz, tc, closing) {
    if (!e.homing) return 0;
    const tFar = clamp((dz - C.LUNGE_DIST) / closing, 0, tc);
    return e.homing * tFar + e.lunge * (tc - tFar);
  }

  function sawX(e, t) {
    return e.cx + e.amp * Math.sin((t * 2 * Math.PI) / e.period + e.phase);
  }

  // ---------- entity factories (used by stages.js) ----------
  const make = {
    gate(z, x0, x1, op, v, pair, extra) {
      return Object.assign(
        { kind: 'gate', z, x0, x1, op, v, pair, acc: 0, hpPerPoint: 1, soft: 25, alive: true, passed: false, flash: 0 },
        extra
      );
    },
    horde(z, x, count, zh, style, extra) {
      const speed = style === 'static' ? 0 : style === 'runner' ? 95 : 40;
      const homing = style === 'static' ? 0 : style === 'runner' ? 90 : 60;
      const lunge = style === 'static' ? 0 : style === 'runner' ? 190 : 150;
      return Object.assign(
        { kind: 'horde', z, x, count, count0: count, zh, style, speed, homing, lunge, acc: 0, clash: false, alive: true, flash: 0, killsTick: 0 },
        extra
      );
    },
    brute(z, x, hp, killPer, extra) {
      return Object.assign(
        { kind: 'brute', z, x, hp, hpMax: hp, killPer, speed: 26, homing: 30, lunge: 110, alive: true, flash: 0 },
        extra
      );
    },
    barrel(z, x, type, hp, amount, extra) {
      return Object.assign({ kind: 'barrel', z, x, type, hp, hpMax: hp, amount, alive: true, passed: false, flash: 0 }, extra);
    },
    saw(z, cx, amp, period, phase, extra) {
      return Object.assign({ kind: 'saw', z, cx, x: cx, amp, period, phase, halfW: 30, alive: true, passed: false }, extra);
    },
    spikes(z, x0, x1, extra) {
      return Object.assign({ kind: 'spikes', z, x0, x1, alive: true, passed: false }, extra);
    },
    tires(z, x, hp, hpPerSoldier, extra) {
      return Object.assign(
        { kind: 'tires', z, x, hp, hpMax: hp, hpPerSoldier, halfW: 42, alive: true, passed: false, flash: 0 },
        extra
      );
    },
  };

  const HITTABLE = { gate: 1, barrel: 1, horde: 1, brute: 1, tires: 1, boss: 1 };

  function zHalf(e) {
    switch (e.kind) {
      case 'gate':
        return 5;
      case 'barrel':
        return 14;
      case 'horde':
        return hordeRadius(e.count) * C.FORM_DEPTH + 4;
      case 'brute':
        return 18;
      case 'tires':
        return 16;
      case 'boss':
        return 34;
      default:
        return 10;
    }
  }
  function xHit(e, x) {
    switch (e.kind) {
      case 'gate':
        return x >= e.x0 && x <= e.x1;
      case 'barrel':
        return Math.abs(x - e.x) <= 21;
      case 'horde':
        return Math.abs(x - e.x) <= hordeRadius(e.count) + 4;
      case 'brute':
        return Math.abs(x - e.x) <= 25;
      case 'tires':
        return Math.abs(x - e.x) <= e.halfW;
      case 'boss':
        return Math.abs(x - e.x) <= e.halfW;
      default:
        return false;
    }
  }

  function cloneEnt(e) {
    const c = Object.assign({}, e);
    delete c.hint; // hints stay on the definition; the app reads them from there
    c.src = e;
    return c;
  }

  // ---------- game ----------
  function createGame(def) {
    const g = {
      def,
      endless: !!def.endless,
      t: 0,
      tick: 0,
      z: 0,
      x: 0,
      targetX: 0,
      count: def.startCount,
      peak: def.startCount,
      kills: 0,
      weapon: def.startWeapon || 1,
      fireT: 0.3,
      rapidT: 0,
      freezeT: 0,
      ents: def.entities.map(cloneEnt),
      bullets: [],
      events: [],
      phase: 'run',
      boss: null,
      bossesKilled: 0,
      rng: new Rng(((def.seed || 1) ^ 0x5bd1e995) >>> 0),
      over: false,
      won: false,
      lossCause: null,
      stats: { gatesGood: 0, gatesBad: 0, lost: 0, gained: 0, barrels: 0 },
    };
    if (def.initGame) def.initGame(g);
    return g;
  }

  function emit(g, ev) {
    if (g.events.length < 400) g.events.push(ev);
  }

  function loseSoldiers(g, n, cause, x, z) {
    n = Math.min(Math.max(0, Math.round(n)), g.count);
    if (n <= 0) return 0;
    g.count -= n;
    g.stats.lost += n;
    if (g.count <= 0) g.lossCause = cause;
    emit(g, { t: 'loss', n, cause, x, z });
    return n;
  }

  function addSoldiers(g, n, x, z) {
    const before = g.count;
    g.count = clamp(g.count + Math.round(n), 0, C.MAX_SQUAD);
    const d = g.count - before;
    if (d > 0) g.stats.gained += d;
    emit(g, { t: 'gain', n: d, x, z });
  }

  function applyGate(g, e) {
    const before = g.count;
    const after = gateResult(before, e);
    g.count = after;
    const good = after >= before;
    if (good) {
      g.stats.gatesGood++;
      g.stats.gained += after - before;
    } else {
      g.stats.gatesBad++;
      g.stats.lost += before - after;
      if (after <= 0) g.lossCause = 'gate';
    }
    emit(g, { t: 'gate', op: e.op, v: e.v, before, after, good, x: (e.x0 + e.x1) / 2, z: e.z });
  }

  function pumpGate(e) {
    for (let guard = 0; guard < 2000; guard++) {
      const cost = e.hpPerPoint * (1 + Math.max(0, e.v) / e.soft);
      if (e.acc < cost) break;
      e.acc -= cost;
      e.v += 1;
      if (e.v >= C.MAX_SQUAD) {
        e.v = C.MAX_SQUAD;
        e.acc = 0;
        break;
      }
    }
  }

  function damageHorde(g, e, d) {
    e.acc += d;
    e.flash = 0.06;
    if (e.acc >= e.zh) {
      const k = Math.min(e.count, Math.floor(e.acc / e.zh));
      e.count -= k;
      e.acc -= k * e.zh;
      e.killsTick += k;
      g.kills += k;
      if (e.count <= 0) {
        e.count = 0;
        e.alive = false;
      }
    }
  }

  function damageEnemy(g, e, d) {
    switch (e.kind) {
      case 'horde':
        damageHorde(g, e, d);
        break;
      case 'brute':
        e.hp -= d;
        e.flash = 0.06;
        if (e.hp <= 0) {
          e.hp = 0;
          e.alive = false;
          g.kills += 1;
          emit(g, { t: 'kill', x: e.x, z: e.z, n: 6, big: true });
        }
        break;
      case 'tires':
        e.hp -= d;
        e.flash = 0.06;
        if (e.hp <= 0) {
          e.hp = 0;
          e.alive = false;
          emit(g, { t: 'debris', x: e.x, z: e.z });
        }
        break;
      case 'barrel':
        e.hp -= d;
        e.flash = 0.06;
        if (e.hp <= 0) breakBarrel(g, e);
        break;
      case 'boss':
        damageBoss(g, e, d);
        break;
    }
  }

  function explode(g, x, z, radius, dmg) {
    emit(g, { t: 'bomb', x, z, r: radius });
    for (const e of g.ents) {
      if (!e.alive) continue;
      if (e.kind !== 'horde' && e.kind !== 'brute' && e.kind !== 'tires') continue;
      const dx = e.x - x;
      const dz = e.z - z;
      if (dx * dx + dz * dz <= radius * radius) damageEnemy(g, e, dmg);
    }
    if (g.boss && g.boss.alive) {
      const dx = g.boss.x - x;
      const dz = g.boss.z - z;
      if (dx * dx + dz * dz <= (radius + 60) * (radius + 60)) damageBoss(g, g.boss, dmg * 0.5);
    }
  }

  function breakBarrel(g, e) {
    e.alive = false;
    e.hp = 0;
    g.stats.barrels++;
    switch (e.type) {
      case 'troops':
        addSoldiers(g, e.amount, e.x, e.z);
        break;
      case 'weapon':
        if (g.weapon < MAX_WEAPON) g.weapon++;
        emit(g, { t: 'weapon', lv: g.weapon });
        break;
      case 'rapid':
        g.rapidT = C.RAPID_TIME;
        break;
      case 'bomb':
        explode(g, e.x, e.z, C.BOMB_RADIUS, e.amount);
        break;
      case 'freeze':
        g.freezeT = C.FREEZE_TIME;
        break;
    }
    emit(g, { t: 'barrel', type: e.type, x: e.x, z: e.z, amount: e.amount });
  }

  function damageBoss(g, b, d) {
    if (!b.alive) return;
    b.hp -= d;
    b.flash = 0.05;
    if (b.hp <= 0) {
      b.hp = 0;
      b.alive = false;
      g.kills += 1;
      g.bossesKilled++;
      emit(g, { t: 'bossDown', x: b.x, z: b.z });
      if (g.endless) {
        g.phase = 'run';
        g.boss = null;
        if (g.def.onBossDown) g.def.onBossDown(g);
      } else {
        finish(g, true);
      }
    }
  }

  function startBoss(g, spec) {
    g.phase = 'boss';
    g.boss = {
      kind: 'boss',
      name: spec.name || '거대 좀비',
      alive: true,
      z: g.z + C.BOSS_START_DIST,
      x: 0,
      hp: spec.hp,
      hpMax: spec.hp,
      speed: spec.speed || 45,
      homing: spec.homing || 30,
      halfW: C.BOSS_HALF_W,
      dps: spec.dps,
      contact: false,
      lossAcc: 0,
      summon: spec.summon || null,
      summonT: spec.summon ? spec.summon.interval : 0,
      flash: 0,
    };
    emit(g, { t: 'boss', hp: spec.hp, name: g.boss.name });
  }

  function finish(g, won) {
    if (g.over) return;
    g.over = true;
    g.won = won;
    g.phase = won ? 'won' : 'lost';
    emit(g, { t: won ? 'win' : 'lose' });
  }

  function result(g) {
    const def = g.def;
    let stars = 0;
    if (g.won) {
      stars = 1;
      if (def.stars) {
        if (g.count >= def.stars[0]) stars++;
        if (g.count >= def.stars[1]) stars++;
      }
    }
    return {
      won: g.won,
      survivors: g.count,
      peak: g.peak,
      kills: g.kills,
      time: g.t,
      stars,
      score: Math.floor(g.z / 10) + g.kills,
      distance: Math.floor(g.z),
      cause: g.lossCause,
    };
  }

  // ---------- step ----------
  function step(g, input) {
    if (g.over) return;
    const dt = C.DT;
    g.t += dt;
    g.tick++;
    if (g.rapidT > 0) g.rapidT = Math.max(0, g.rapidT - dt);
    if (g.freezeT > 0) g.freezeT = Math.max(0, g.freezeT - dt);

    // steering
    if (input && Number.isFinite(input.targetX)) g.targetX = clamp(input.targetX, -C.MOVE_LIMIT, C.MOVE_LIMIT);
    const maxStep = C.STEER_SPEED * dt;
    g.x += clamp(g.targetX - g.x, -maxStep, maxStep);

    // forward movement
    const prevZ = g.z;
    if (g.phase === 'run') {
      g.z += C.RUN_SPEED * dt;
      if (!g.endless && g.z >= g.def.length) {
        g.z = g.def.length;
        startBoss(g, g.def.boss);
      } else if (g.endless && g.def.nextBoss && g.z >= g.def.nextBoss(g)) {
        startBoss(g, g.def.makeBoss(g));
      }
    }
    if (g.def.extend) g.def.extend(g);

    updateEntities(g, dt);
    fire(g, dt);
    updateBullets(g, dt);
    crossings(g, prevZ);
    if (!g.over) contacts(g);
    if (!g.over && g.boss) updateBoss(g, dt);

    if (g.count > g.peak) g.peak = g.count;
    if (!g.over && g.count <= 0) finish(g, false);

    if (g.tick % 30 === 0) {
      const minZ = g.z - 250;
      g.ents = g.ents.filter((e) => e.alive && e.z > minZ);
      g.bullets = g.bullets.filter((b) => b.alive);
    }
  }

  function updateEntities(g, dt) {
    const slow = g.freezeT > 0 ? C.FREEZE_SLOW : 1;
    const depth = formationDepth(g.count);
    for (const e of g.ents) {
      if (!e.alive) continue;
      if (e.flash > 0) e.flash -= dt;
      switch (e.kind) {
        case 'horde': {
          if (e.clash) {
            e.z = g.z + depth + hordeRadius(e.count) * C.FORM_DEPTH;
            e.x += (g.x - e.x) * Math.min(1, dt * 10);
            break;
          }
          if (e.style !== 'static' && e.z - g.z < C.ACTIVATE_DIST) {
            e.z -= e.speed * slow * dt;
            const h = (e.z - g.z < C.LUNGE_DIST ? e.lunge : e.homing) * slow * dt;
            e.x = clamp(e.x + clamp(g.x - e.x, -h, h), -C.ROAD_HALF + 12, C.ROAD_HALF - 12);
          }
          break;
        }
        case 'brute': {
          if (e.z - g.z < C.ACTIVATE_DIST) {
            e.z -= e.speed * slow * dt;
            const h = (e.z - g.z < C.LUNGE_DIST ? e.lunge : e.homing) * slow * dt;
            e.x = clamp(e.x + clamp(g.x - e.x, -h, h), -C.ROAD_HALF + 20, C.ROAD_HALF - 20);
          }
          break;
        }
        case 'saw':
          e.x = sawX(e, g.t);
          break;
      }
    }
    if (g.boss && g.boss.flash > 0) g.boss.flash -= dt;
  }

  function fire(g, dt) {
    if (g.count <= 0) return;
    g.fireT -= dt;
    if (g.fireT > 0) return;
    const w = WEAPONS[g.weapon];
    g.fireT += w.interval * (g.rapidT > 0 ? 0.5 : 1);
    if (g.fireT < 0) g.fireT = 0;
    const n = bulletsPerVolley(g.count);
    const r = formationRadius(g.count) * 0.9;
    const zf = g.z + formationDepth(g.count) * 0.6;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      const bx = g.x + u * r + (g.rng.f() - 0.5) * 6;
      g.bullets.push({ x: bx, z: zf, z0: zf, dmg: w.dmg, pierce: w.pierce || 0, splash: w.splash || 0, last: null, alive: true, lv: g.weapon });
    }
    emit(g, { t: 'fire', n, lv: g.weapon });
  }

  function updateBullets(g, dt) {
    const stepZ = C.BULLET_SPEED * dt;
    const targets = [];
    const zMax = g.z + C.BULLET_RANGE + 120;
    for (const e of g.ents) {
      if (e.alive && HITTABLE[e.kind] && e.z > g.z - 40 && e.z < zMax) targets.push(e);
    }
    if (g.boss && g.boss.alive) targets.push(g.boss);
    targets.sort((a, b) => a.z - zHalf(a) - (b.z - zHalf(b)));

    for (const b of g.bullets) {
      if (!b.alive) continue;
      const z1 = b.z + stepZ;
      for (const e of targets) {
        if (!e.alive || e === b.last) continue;
        const h = zHalf(e);
        if (e.z + h < b.z || e.z - h > z1) continue;
        if (!xHit(e, b.x)) continue;
        onHit(g, e, b);
        if (!b.alive) break;
      }
      if (b.alive) {
        b.z = z1;
        if (b.z - b.z0 > C.BULLET_RANGE) b.alive = false;
      }
    }

    for (const e of targets) {
      if (e.kind === 'horde' && e.killsTick > 0) {
        emit(g, { t: 'kill', x: e.x, z: e.z, n: e.killsTick });
        e.killsTick = 0;
      }
    }
  }

  function onHit(g, e, b) {
    if (e.kind === 'gate') {
      if (e.op === 'add') {
        e.acc += b.dmg;
        pumpGate(e);
      }
      e.flash = 0.07;
      b.alive = false;
      return;
    }
    damageEnemy(g, e, b.dmg);
    if (b.splash) {
      const r = b.splash;
      for (const o of g.ents) {
        if (o === e || !o.alive) continue;
        if (o.kind !== 'horde' && o.kind !== 'brute' && o.kind !== 'tires' && o.kind !== 'barrel') continue;
        const dx = o.x - b.x;
        const dz = o.z - e.z;
        const rr = r + (o.kind === 'horde' ? hordeRadius(o.count) * 0.5 : 20);
        if (dx * dx + dz * dz <= rr * rr) damageEnemy(g, o, b.dmg * 0.6);
      }
      emit(g, { t: 'splash', x: b.x, z: e.z, r });
    }
    if (b.pierce > 0) {
      b.pierce--;
      b.last = e;
    } else {
      b.alive = false;
    }
  }

  function crossings(g, prevZ) {
    // gates: resolved when the squad centre crosses the gate line
    let pairs = null;
    for (const e of g.ents) {
      if (e.kind !== 'gate' || !e.alive || e.passed) continue;
      if (e.z <= g.z && e.z > prevZ - 1) {
        if (!pairs) pairs = new Map();
        if (!pairs.has(e.pair)) pairs.set(e.pair, []);
        pairs.get(e.pair).push(e);
      }
    }
    if (pairs) {
      for (const [pair, gates] of pairs) {
        let chosen = null;
        for (const e of gates) if (g.x >= e.x0 && g.x <= e.x1 && !chosen) chosen = e;
        for (const e of g.ents) {
          if (e.kind === 'gate' && e.pair === pair) {
            e.passed = true;
            e.alive = false;
          }
        }
        if (chosen) applyGate(g, chosen);
        if (g.count <= 0) return;
      }
    }

    // static things resolved when the formation's front edge reaches them
    const r = formationRadius(g.count);
    const front = g.z + r * C.FORM_DEPTH;
    for (const e of g.ents) {
      if (!e.alive || e.passed) continue;
      if (e.kind !== 'saw' && e.kind !== 'spikes' && e.kind !== 'tires' && e.kind !== 'barrel') continue;
      if (e.z > front) continue;
      e.passed = true;
      if (e.z < g.z - 60) continue;
      const n = g.count;
      if (e.kind === 'saw') {
        const ov = overlapFrac(g.x, r, e.x - e.halfW, e.x + e.halfW);
        if (ov > 0) loseSoldiers(g, Math.ceil(0.4 * n * ov) + 1, 'saw', e.x, e.z);
      } else if (e.kind === 'spikes') {
        const ov = overlapFrac(g.x, r, e.x0, e.x1);
        if (ov > 0) loseSoldiers(g, Math.ceil(0.35 * n * ov) + 1, 'spikes', g.x, e.z);
      } else if (e.kind === 'tires') {
        const ov = overlapFrac(g.x, r, e.x - e.halfW, e.x + e.halfW);
        if (ov > 0) {
          loseSoldiers(g, Math.max(1, Math.ceil(e.hp / e.hpPerSoldier)), 'tires', e.x, e.z);
          e.alive = false;
          emit(g, { t: 'debris', x: e.x, z: e.z });
        }
      } else if (e.kind === 'barrel') {
        if (Math.abs(e.x - g.x) < r + 18) {
          e.alive = false;
          emit(g, { t: 'crush', x: e.x, z: e.z });
        }
      }
      if (g.count <= 0) return;
    }
  }

  function contacts(g) {
    const r = formationRadius(g.count);
    const depth = r * C.FORM_DEPTH;
    const front = g.z + depth;
    const back = g.z - depth;
    for (const e of g.ents) {
      if (!e.alive) continue;
      if (e.kind === 'horde') {
        if (e.clash) continue;
        const hr = hordeRadius(e.count);
        const hd = hr * C.FORM_DEPTH;
        if (e.z - hd <= front && e.z + hd >= back && Math.abs(e.x - g.x) < (hr + r) * C.CONTACT) {
          e.clash = true;
          emit(g, { t: 'clashStart', x: e.x, z: e.z, n: e.count });
        } else if (e.z + hd < back - 20) {
          e.alive = false; // dodged, it runs off behind the squad
        }
      } else if (e.kind === 'brute') {
        if (e.z - 18 <= front && e.z + 18 >= back && Math.abs(e.x - g.x) < (25 + r) * C.CONTACT) {
          const loss = Math.max(3, Math.ceil(e.hp / e.killPer));
          loseSoldiers(g, loss, 'brute', e.x, e.z);
          e.alive = false;
          g.kills += 1;
          emit(g, { t: 'smash', x: e.x, z: e.z, n: loss });
          if (g.count <= 0) return;
        } else if (e.z + 18 < back - 20) {
          e.alive = false;
        }
      }
    }
    // clashes: both sides lose one for one until one is gone
    for (const e of g.ents) {
      if (!e.alive || e.kind !== 'horde' || !e.clash) continue;
      const n = Math.max(1, Math.ceil(e.count * C.CLASH_RATE));
      const k = Math.min(n, e.count, g.count);
      e.count -= k;
      g.kills += k;
      loseSoldiers(g, k, 'horde', e.x, e.z);
      emit(g, { t: 'clash', x: e.x, z: e.z, n: k });
      if (e.count <= 0) {
        e.count = 0;
        e.alive = false;
      }
      if (g.count <= 0) return;
    }
  }

  function updateBoss(g, dt) {
    const b = g.boss;
    if (!b || !b.alive) return;
    const slow = g.freezeT > 0 ? C.FREEZE_SLOW : 1;
    const r = formationRadius(g.count);
    const contactZ = g.z + r * C.FORM_DEPTH + 30;
    if (!b.contact) {
      b.z -= b.speed * slow * dt;
      const h = b.homing * slow * dt;
      b.x = clamp(b.x + clamp(g.x - b.x, -h, h), -C.ROAD_HALF + 40, C.ROAD_HALF - 40);
      if (b.z <= contactZ) {
        b.z = contactZ;
        b.contact = true;
        emit(g, { t: 'bossContact', x: b.x, z: b.z });
      }
    } else {
      b.z = contactZ;
      const h = 160 * slow * dt;
      b.x = clamp(b.x + clamp(g.x - b.x, -h, h), -C.ROAD_HALF + 40, C.ROAD_HALF - 40);
      if (Math.abs(g.x - b.x) < b.halfW + r) {
        b.lossAcc += b.dps * slow * dt;
        if (b.lossAcc >= 1) {
          const n = Math.floor(b.lossAcc);
          b.lossAcc -= n;
          loseSoldiers(g, n, 'boss', g.x, b.z);
        }
      }
    }
    if (b.summon) {
      b.summonT -= dt;
      if (b.summonT <= 0) {
        b.summonT += b.summon.interval;
        const sx = clamp(b.x + g.rng.f(-70, 70), -C.ROAD_HALF + 20, C.ROAD_HALF - 20);
        const h = make.horde(b.z - 50, sx, b.summon.count, b.summon.zh, 'runner');
        g.ents.push(h);
        emit(g, { t: 'summon', x: sx, z: b.z });
      }
    }
  }

  ZGR.Rng = Rng;
  ZGR.C = C;
  ZGR.WEAPONS = WEAPONS;
  ZGR.MAX_WEAPON = MAX_WEAPON;
  ZGR.clamp = clamp;
  ZGR.make = make;
  ZGR.formationRadius = formationRadius;
  ZGR.formationDepth = formationDepth;
  ZGR.bulletsPerVolley = bulletsPerVolley;
  ZGR.weaponDps = weaponDps;
  ZGR.hordeRadius = hordeRadius;
  ZGR.volleyHits = volleyHits;
  ZGR.targetDps = targetDps;
  ZGR.overlapFrac = overlapFrac;
  ZGR.gateResult = gateResult;
  ZGR.gateIsGood = gateIsGood;
  ZGR.sawX = sawX;
  ZGR.moverReach = moverReach;
  ZGR.createGame = createGame;
  ZGR.step = step;
  ZGR.result = result;
})(typeof window !== 'undefined' ? window : globalThis);
