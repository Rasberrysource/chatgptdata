#!/usr/bin/env node
/*
 * Plays every stage with the bots and prints a difficulty table.
 *
 *   node tools/balance.js              table for all stages
 *   node tools/balance.js 1 5          stages 1..5 only
 *   node tools/balance.js --calibrate  search per-stage factors, then print a CALIB table for js/stages.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
  const ctx = { console, Math, Object, Array, Number, Map, Set, JSON };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['core.js', 'stages.js', 'bot.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    vm.runInContext(src, ctx, { filename: f });
  }
  return ctx.ZGR;
}

const ZGR = load();
const args = process.argv.slice(2);
const calibrate = args.includes('--calibrate');
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const from = nums[0] || 1;
const to = nums[1] || nums[0] || ZGR.Stages.COUNT;

const pad = (v, n) => String(v).padStart(n);

function runStage(def, kinds, seeds) {
  const out = {};
  for (const kind of kinds) {
    const runs = [];
    for (const seed of seeds) runs.push(ZGR.Bot.playOut(def, kind, seed).res);
    out[kind] = runs;
  }
  return out;
}

function summary(runs) {
  const wins = runs.filter((r) => r.won);
  const surv = wins.map((r) => r.survivors).sort((a, b) => a - b);
  const med = surv.length ? surv[Math.floor(surv.length / 2)] : 0;
  return { winRate: wins.length / runs.length, med, peak: Math.max(...runs.map((r) => r.peak)), time: runs[0].time };
}

function table() {
  console.log('stage | len  | start | estN | boss hp  | expert win surv peak | normal win surv | random win | time');
  for (let s = from; s <= to; s++) {
    const def = ZGR.Stages.get(s);
    const r = runStage(def, ['expert', 'normal', 'random'], [1, 2, 3, 4, 5, 6]);
    const e = summary(r.expert);
    const n = summary(r.normal);
    const x = summary(r.random);
    console.log(
      `${pad(s, 5)} | ${pad(def.length, 4)} | ${pad(def.startCount, 5)} | ${pad(def.est.N, 4)} | ${pad(def.boss.hp, 8)} | ` +
        `${pad(Math.round(e.winRate * 100) + '%', 10)} ${pad(e.med, 4)} ${pad(e.peak, 4)} | ` +
        `${pad(Math.round(n.winRate * 100) + '%', 10)} ${pad(n.med, 4)} | ${pad(Math.round(x.winRate * 100) + '%', 10)} | ${pad(e.time.toFixed(0), 3)}s`
    );
  }
}

// Calibration: hazard pressure follows a fixed curve (ZGR.Stages.hazardFactor); the boss factor is
// searched so the expert bot ends with a set share of its peak squad, shrinking from 80% at stage 1
// to 35% at stage 30. The normal bot's win rate is printed for reference.
function keepTarget(s) {
  return 0.8 - (0.45 * (s - 1)) / 29;
}

function evalStage(s, kH, kB, seedsE, seedsN) {
  ZGR.Stages.CALIB[s - 1] = [kH, kB, 0, 0];
  ZGR.Stages.clearCache();
  const def = ZGR.Stages.get(s);
  const e = summary(runStage(def, ['expert'], seedsE).expert);
  const n = seedsN ? summary(runStage(def, ['normal'], seedsN).normal) : null;
  return { e, n, keep: e.med / Math.max(1, e.peak) };
}

function calibrateAll() {
  const rows = [];
  const E = [1, 2, 3, 4, 5];
  const NS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (let s = from; s <= to; s++) {
    const kH = ZGR.Stages.hazardFactor(s);
    const target = keepTarget(s);
    let lo = 0.6;
    let hi = 7;
    let kB = 2;
    for (let i = 0; i < 14; i++) {
      const r = evalStage(s, kH, kB, E);
      if (r.e.winRate < 1 || r.keep < target - 0.05) hi = kB;
      else if (r.keep > target + 0.05) lo = kB;
      else break;
      kB = (lo + hi) / 2;
    }
    let final = evalStage(s, kH, kB, E, NS);
    for (let i = 0; i < 8 && final.e.winRate < 1; i++) {
      kB *= 0.92;
      final = evalStage(s, kH, kB, E, NS);
    }
    const star3 = Math.max(3, Math.round(final.e.med * 0.7));
    const star2 = Math.max(2, Math.round(final.e.med * 0.35));
    const row = [+kH.toFixed(3), +kB.toFixed(3), star2, star3];
    ZGR.Stages.CALIB[s - 1] = row;
    rows.push(row);
    console.error(
      `stage ${s}: kH=${row[0]} kB=${row[1]} expert ${Math.round(final.e.winRate * 100)}% keep ${final.keep.toFixed(2)}/${target.toFixed(2)} ` +
        `peak ${final.e.peak} normal ${Math.round(final.n.winRate * 100)}% stars ${star2}/${star3}`
    );
  }
  console.log('  const CALIB = [');
  rows.forEach((r, i) => console.log(`    [${r.join(', ')}], // ${from + i}`));
  console.log('  ];');
}

if (calibrate) calibrateAll();
else table();
