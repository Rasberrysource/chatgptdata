/*
 * bot.js — autopilot used by the title-screen demo and by tools/balance.js.
 * It plays like an attentive person: deal with the next group of objects,
 * keeping an eye on the group after it (it can change lanes in between).
 */
(function (root) {
  'use strict';
  const ZGR = root.ZGR;
  const { C, clamp, formationRadius, hordeRadius, overlapFrac, gateResult, weaponDps, sawX, MAX_WEAPON } = ZGR;

  const LANES = [-125, -100, -75, -50, -25, 0, 25, 50, 75, 100, 125];
  const COARSE = [-110, -60, -20, 20, 60, 110];
  const GROUP_GAP = 150;

  const PROFILES = {
    expert: { horizon: 900, every: 3, noise: 0, pump: true, predictSaw: true, mistake: 0, react: 0, margin: 28 },
    normal: { horizon: 850, every: 10, noise: 14, pump: false, predictSaw: false, mistake: 0.08, react: 0.2, margin: 14 },
    random: { random: true },
    ad: { horizon: 900, every: 3, noise: 0, pump: true, predictSaw: true, mistake: 0, react: 0, margin: 28, ad: true },
  };

  // Upcoming entities split into clusters along z.
  function upcomingGroups(g, cfg) {
    const ahead = [];
    for (const e of g.ents) {
      if (!e.alive || e.passed) continue;
      const behind = e.kind === 'horde' || e.kind === 'brute' ? 90 : 10;
      if (e.z < g.z - behind || e.z > g.z + cfg.horizon) continue;
      if (e.kind === 'horde' && e.clash) continue;
      ahead.push(e);
    }
    ahead.sort((a, b) => a.z - b.z);
    const groups = [];
    let cur = null;
    for (const e of ahead) {
      if (!cur || e.z - cur.zEnd > GROUP_GAP) {
        cur = { ents: [], zStart: e.z, zEnd: e.z };
        groups.push(cur);
      }
      cur.ents.push(e);
      cur.zEnd = e.z;
    }
    return groups;
  }

  // Outcome of heading for lane x while a group of entities comes through.
  // With `x0` set, the squad starts at x0 and needs time to get to x.
  function evalGroup(g, xTarget, group, N, W, zFrom, cfg, x0) {
    let bonus = 0;
    const pairsSeen = {};
    const reach = C.STEER_SPEED * 0.8;
    for (const e of group.ents) {
      const r = formationRadius(N);
      const tArrive = Math.max(0.05, (e.z - zFrom) / C.RUN_SPEED);
      const tMe = Math.max(0.02, (e.z - g.z) / C.RUN_SPEED);
      const x = x0 === undefined ? xTarget : x0 + clamp(xTarget - x0, -reach * tMe, reach * tMe);
      const dps = weaponDps(N, W) * (g.rapidT > tArrive ? 2 : 1);
      switch (e.kind) {
        case 'gate': {
          if (pairsSeen[e.pair] || x < e.x0 || x > e.x1) break;
          pairsSeen[e.pair] = true;
          let v = e.v;
          if (e.op === 'add' && cfg.pump) {
            const cost = e.hpPerPoint * (1 + Math.max(0, e.v) / e.soft);
            v += (dps * Math.min(tArrive, 4) * 0.6) / cost;
          }
          N = gateResult(N, { op: e.op, v: Math.round(v) });
          break;
        }
        case 'barrel': {
          const bdps = ZGR.targetDps(N, W, x, e.x - 21, e.x + 21, g.rapidT > tArrive);
          if (bdps <= 0) break;
          const t = Math.min(tArrive, C.BULLET_RANGE / C.RUN_SPEED) - 0.35;
          if (bdps * t * 0.85 < e.hp) break;
          if (e.type === 'troops') N += e.amount;
          else if (e.type === 'weapon') {
            if (W < MAX_WEAPON) bonus += 25 + N * 1.2;
            W = Math.min(MAX_WEAPON, W + 1);
          } else bonus += 4 + N * 0.08;
          break;
        }
        case 'horde': {
          const hr = hordeRadius(e.count);
          const closing = C.RUN_SPEED + (e.style === 'static' ? 0 : e.speed);
          const tc = Math.max(0.05, (e.z - g.z) / closing);
          const reach = ZGR.moverReach(e, e.z - g.z, tc, closing);
          const hx = e.style === 'static' ? e.x : e.x + clamp(x - e.x, -reach, reach);
          if (Math.abs(hx - x) >= (hr + r) * C.CONTACT + cfg.margin) break; // clearly dodged
          const tShoot = Math.min(Math.max(0.05, (e.z - zFrom) / closing), C.BULLET_RANGE / closing);
          const cover = Math.min(1, overlapFrac(x, r * 0.9, hx - hr - 4, hx + hr + 4) * 1.15);
          const killed = (dps * cover * tShoot * 0.8) / e.zh;
          N -= Math.max(0, e.count - killed);
          bonus += Math.min(e.count, killed) * 0.01;
          break;
        }
        case 'brute': {
          const closing = C.RUN_SPEED + e.speed;
          const tc = Math.max(0.05, (e.z - g.z) / closing);
          const reach = ZGR.moverReach(e, e.z - g.z, tc, closing);
          const hx = e.x + clamp(x - e.x, -reach, reach);
          if (Math.abs(hx - x) >= (25 + r) * C.CONTACT + cfg.margin * 0.7) break;
          const tShoot = Math.min(Math.max(0.05, (e.z - zFrom) / closing), C.BULLET_RANGE / closing);
          const cover = Math.min(1, overlapFrac(x, r * 0.9, hx - 25, hx + 25) * 1.15);
          const left = Math.max(0, e.hp - dps * cover * tShoot * 0.8);
          if (left > 0) N -= Math.max(3, Math.ceil(left / e.killPer));
          break;
        }
        case 'tires': {
          const ov = overlapFrac(x, r, e.x - e.halfW, e.x + e.halfW);
          if (ov <= 0) break;
          const cover = overlapFrac(x, r * 0.9, e.x - e.halfW, e.x + e.halfW);
          const left = Math.max(0, e.hp - dps * cover * Math.min(tArrive, 4) * 0.8);
          if (left > 0) N -= Math.max(1, Math.ceil(left / e.hpPerSoldier));
          break;
        }
        case 'spikes': {
          const ov = overlapFrac(x, r, e.x0 - 4, e.x1 + 4);
          if (ov > 0) N -= Math.ceil(0.35 * N * ov) + 1;
          break;
        }
        case 'saw': {
          const sx = cfg.predictSaw ? sawX(e, g.t + (e.z - g.z) / C.RUN_SPEED) : e.cx;
          const pad = cfg.predictSaw ? 8 : 0;
          const ov = overlapFrac(x, r, sx - e.halfW - pad, sx + e.halfW + pad);
          if (ov > 0) N -= Math.ceil(0.4 * N * ov) + 1;
          break;
        }
      }
      if (N <= 0) return { N: 0, W, bonus, dead: true };
    }
    return { N, W, bonus, dead: false };
  }

  function scoreLane(g, x, groups, cfg) {
    if (!groups.length) return -Math.abs(x - g.x) * 0.01; // nothing ahead: hold the lane
    const r1 = evalGroup(g, x, groups[0], g.count, g.weapon, g.z, cfg, g.x);
    if (r1.dead) return -1e6;
    let score = r1.N + r1.bonus;
    if (groups[1]) {
      // Gates in the first group soak up bullets; otherwise we can already shoot the second group.
      let blocked = false;
      for (const e of groups[0].ents) if (e.kind === 'gate') blocked = true;
      const zLate = groups[0].zEnd;
      let best = -1e6;
      for (const x2 of COARSE) {
        const r2 = evalGroup(g, x2, groups[1], r1.N, r1.W, zLate, cfg);
        const s2 = r2.dead ? -1e5 : r2.N + r2.bonus;
        if (s2 > best) best = s2;
      }
      if (!blocked) {
        // staying in this lane lets us start on the second group right away
        const r2 = evalGroup(g, x, groups[1], r1.N, r1.W, g.z, cfg);
        const s2 = r2.dead ? -1e5 : r2.N + r2.bonus;
        if (s2 > best) best = s2;
      }
      score = score * 0.5 + best * 0.5;
    }
    return score;
  }

  // The next gate pair that has not been reached yet.
  function nextPair(g) {
    let best = null;
    for (const e of g.ents) {
      if (e.kind !== 'gate' || !e.alive || e.passed || e.z <= g.z) continue;
      if (!best || e.z < best[0].z) best = [e];
      else if (e.z === best[0].z && e.pair === best[0].pair) best.push(e);
    }
    return best;
  }

  function makeBot(kind, seed) {
    const cfg = PROFILES[kind] || PROFILES.expert;
    const rng = new ZGR.Rng((seed || 1234) >>> 0);
    let tx = 0;
    let tick = 0;
    let pending = null;
    let lastPair = -1;

    function randomPolicy(g) {
      if (g.boss && g.boss.alive) return { targetX: tx };
      const pair = nextPair(g);
      if (pair && pair[0].pair !== lastPair && pair[0].z - g.z < 450) {
        lastPair = pair[0].pair;
        const pickGate = rng.pick(pair);
        tx = clamp((pickGate.x0 + pickGate.x1) / 2 + rng.f(-20, 20), -C.MOVE_LIMIT, C.MOVE_LIMIT);
      }
      return { targetX: tx };
    }

    return function (g) {
      tick++;
      if (cfg.random) return randomPolicy(g);

      if (cfg.ad && g.def.trapZ && g.z > g.def.trapZ - 700 && g.z < g.def.trapZ) {
        // steer into the worst door, like the ads do
        const pair = nextPair(g);
        if (pair) {
          let worst = pair[0];
          for (const e of pair) if (gateResult(g.count, e) < gateResult(g.count, worst)) worst = e;
          tx = clamp((worst.x0 + worst.x1) / 2, -C.MOVE_LIMIT, C.MOVE_LIMIT);
          return { targetX: tx };
        }
      }

      if (g.boss && g.boss.alive) {
        // keep the boss centred on the formation so every bullet lands
        tx = clamp(g.boss.x + (cfg.noise ? rng.f(-cfg.noise, cfg.noise) * 0.5 : 0), -C.MOVE_LIMIT, C.MOVE_LIMIT);
        return { targetX: tx };
      }

      if (tick % cfg.every === 0) {
        const groups = upcomingGroups(g, cfg);
        const scored = LANES.map((x) => ({ x, s: scoreLane(g, x, groups, cfg) - Math.abs(x - g.x) * 0.003 }));
        scored.sort((a, b) => b.s - a.s);
        let choice = scored[0];
        const current = scored.find((c) => Math.abs(c.x - tx) < 1);
        if (current && current.s >= choice.s - Math.max(0.5, Math.abs(choice.s) * 0.01)) choice = current;
        if (cfg.mistake && rng.chance(cfg.mistake)) choice = scored[1];
        const target = clamp(choice.x + (cfg.noise ? rng.f(-cfg.noise, cfg.noise) : 0), -C.MOVE_LIMIT, C.MOVE_LIMIT);
        if (cfg.react > 0) {
          if (!pending || Math.abs(pending.x - target) > 30) pending = { x: target, at: g.t + cfg.react };
        } else {
          tx = target;
        }
      }
      if (pending && g.t >= pending.at) {
        tx = pending.x;
        pending = null;
      }
      return { targetX: tx };
    };
  }

  function playOut(def, kind, seed, maxTicks) {
    const g = ZGR.createGame(def);
    const bot = makeBot(kind, seed);
    const limit = maxTicks || 60 * 60 * 5;
    while (!g.over && g.tick < limit) {
      ZGR.step(g, bot(g));
      g.events.length = 0;
    }
    return { g, res: ZGR.result(g) };
  }

  ZGR.Bot = { make: makeBot, scoreLane, playOut, PROFILES };
})(typeof window !== 'undefined' ? window : globalThis);
