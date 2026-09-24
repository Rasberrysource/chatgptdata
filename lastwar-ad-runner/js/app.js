/*
 * app.js — screens, input, main loop and saving.
 */
(function (root) {
  'use strict';
  const ZGR = root.ZGR;
  const { C, Stages, Bot, Renderer, Sfx, WEAPONS, clamp } = ZGR;
  const SAVE_KEY = 'zgr_save_v1';

  const $ = (id) => document.getElementById(id);
  const el = {
    view: $('view'),
    hud: $('hud'),
    hudStage: $('hud-stage'),
    hudScore: $('hud-score'),
    progress: $('hud-progress'),
    progressFill: $('hud-progress-fill'),
    weapon: $('hud-weapon'),
    weaponLv: $('hud-weapon-lv'),
    weaponName: $('hud-weapon-name'),
    buffs: $('buffs'),
    buffRapid: $('buff-rapid'),
    buffFreeze: $('buff-freeze'),
    bossbar: $('bossbar'),
    bossName: $('boss-name'),
    bossHp: $('boss-hp'),
    bossFill: $('boss-fill'),
    hint: $('hint'),
    caption: $('caption'),
    grid: $('stage-grid'),
    starsTotal: $('stars-total'),
    resultEyebrow: $('result-eyebrow'),
    resultTitle: $('result-title'),
    resultStars: $('result-stars'),
    resultStats: $('result-stats'),
    resultNote: $('result-note'),
    btnNext: $('btn-next'),
    btnRetry: $('btn-retry'),
    btnToStages: $('btn-to-stages'),
    btnSound: $('btn-sound'),
  };
  const screens = {
    title: $('screen-title'),
    stages: $('screen-stages'),
    help: $('screen-help'),
    pause: $('screen-pause'),
    result: $('screen-result'),
  };

  // ---------- saving ----------
  function loadSave() {
    const s = { unlocked: 1, stars: {}, best: 0, muted: false };
    try {
      const raw = root.localStorage.getItem(SAVE_KEY);
      if (raw) Object.assign(s, JSON.parse(raw));
    } catch (e) {
      /* storage unavailable: play without saving */
    }
    return s;
  }
  function writeSave() {
    try {
      root.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (e) {
      /* ignore */
    }
  }
  let save = loadSave();

  // ---------- state ----------
  const renderer = new Renderer(el.view);
  let game = null;
  let demo = null;
  let mode = 'title';
  let stageId = 1;
  let acc = 0;
  let last = performance.now();
  let overAt = 0;
  const input = { targetX: 0, dragging: false, startPx: 0, startTarget: 0, left: false, right: false };
  const hints = { shown: new Set(), queue: [], until: 0 };
  let captionUntil = 0;
  const hudCache = {};

  function show(name) {
    for (const key of Object.keys(screens)) screens[key].hidden = key !== name;
  }

  function setText(node, key, text) {
    if (hudCache[key] !== text) {
      hudCache[key] = text;
      node.textContent = text;
    }
  }

  // ---------- title demo: the "wrong door" ad on loop ----------
  function startDemo() {
    game = ZGR.createGame(Stages.attract());
    demo = { bot: Bot.make('ad', 7 + Math.floor(Math.random() * 1000)), endAt: 0 };
    renderer.reset();
    acc = 0;
    hideCaption();
  }

  function caption(text, bad, ms) {
    el.caption.textContent = text;
    el.caption.classList.toggle('bad', !!bad);
    el.caption.hidden = false;
    captionUntil = performance.now() + (ms || 2200);
  }
  function hideCaption() {
    el.caption.hidden = true;
    captionUntil = 0;
  }

  function goTitle() {
    mode = 'title';
    el.hud.hidden = true;
    el.buffs.hidden = true;
    el.bossbar.hidden = true;
    hideHint();
    show('title');
    startDemo();
  }

  // ---------- stages ----------
  function renderStages() {
    el.grid.textContent = '';
    let total = 0;
    for (let i = 1; i <= Stages.COUNT; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stage-btn';
      const st = save.stars[i] || 0;
      total += st;
      if (i > save.unlocked) {
        b.disabled = true;
        b.innerHTML = `<span class="num">${i}</span><span class="st">잠김</span>`;
        b.setAttribute('aria-label', `스테이지 ${i}, 잠김`);
      } else {
        b.innerHTML = `<span class="num">${i}</span><span class="st">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i></span>`;
        if (st) b.classList.add('cleared');
        if (i === save.unlocked && !st) b.classList.add('current');
        b.setAttribute('aria-label', `스테이지 ${i}, 별 ${st}개`);
        b.addEventListener('click', () => {
          Sfx.unlock();
          Sfx.click();
          startStage(i);
        });
      }
      el.grid.appendChild(b);
    }
    el.starsTotal.textContent = `★ ${total} / ${Stages.COUNT * 3}`;
  }

  function startStage(id) {
    stageId = id;
    const def = id === 'endless' ? Stages.endless() : Stages.get(id);
    game = ZGR.createGame(def);
    demo = null;
    renderer.reset();
    acc = 0;
    overAt = 0;
    input.targetX = 0;
    input.dragging = false;
    hints.shown.clear();
    hints.queue.length = 0;
    hideHint();
    hideCaption();
    for (const k of Object.keys(hudCache)) delete hudCache[k];
    mode = 'play';
    show(null);
    el.hud.hidden = false;
    el.buffs.hidden = false;
    el.bossbar.hidden = true;
    setText(el.hudStage, 'stage', id === 'endless' ? '무한 모드' : 'STAGE ' + id);
    el.progress.hidden = id === 'endless';
    el.hudScore.hidden = id !== 'endless';
    if (id === 1) queueHint('화면을 좌우로 드래그해서 부대를 움직이세요. 사격은 자동입니다.');
    if (id === 'endless') queueHint('끝없이 달립니다. 5,000m마다 보스가 나와요. 얼마나 멀리 갈 수 있을까요?');
  }

  // ---------- hints ----------
  function queueHint(text, urgent) {
    if (urgent) hints.queue.unshift(text);
    else hints.queue.push(text);
    if (!hints.until) nextHint();
  }
  function nextHint() {
    const text = hints.queue.shift();
    if (!text) {
      hideHint();
      return;
    }
    el.hint.textContent = text;
    el.hint.hidden = false;
    hints.until = performance.now() + 3800;
  }
  function hideHint() {
    el.hint.hidden = true;
    hints.until = 0;
  }
  function scanHints() {
    for (const e of game.ents) {
      const src = e.src;
      if (!src || !src.hint || hints.shown.has(src)) continue;
      if (e.z - game.z < 950) {
        hints.shown.add(src);
        queueHint(src.hint);
      }
    }
  }

  // ---------- input ----------
  function playerInput() {
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir) input.targetX = clamp(input.targetX + dir * 340 * C.DT, -C.MOVE_LIMIT, C.MOVE_LIMIT);
    return { targetX: input.targetX };
  }

  el.view.addEventListener('pointerdown', (e) => {
    if (mode !== 'play') return;
    Sfx.unlock();
    input.dragging = true;
    input.startPx = e.clientX;
    input.startTarget = input.targetX;
    try {
      el.view.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
  });
  el.view.addEventListener('pointermove', (e) => {
    if (!input.dragging || mode !== 'play') return;
    let t = input.startTarget + (e.clientX - input.startPx) * renderer.worldPerCssPx * 1.2;
    if (t > C.MOVE_LIMIT || t < -C.MOVE_LIMIT) {
      // re-anchor at the edge so dragging back responds at once
      t = clamp(t, -C.MOVE_LIMIT, C.MOVE_LIMIT);
      input.startTarget = t;
      input.startPx = e.clientX;
    }
    input.targetX = t;
  });
  const endDrag = () => {
    input.dragging = false;
  };
  el.view.addEventListener('pointerup', endDrag);
  el.view.addEventListener('pointercancel', endDrag);

  root.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') input.left = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') input.right = true;
    else if ((k === 'Escape' || k === 'p' || k === 'P') && (mode === 'play' || mode === 'paused')) {
      if (mode === 'play') pause();
      else resume();
      return;
    } else return;
    if (mode === 'play') e.preventDefault();
  });
  root.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') input.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') input.right = false;
  });

  function pause() {
    if (mode !== 'play' || !game || game.over) return;
    mode = 'paused';
    input.left = input.right = input.dragging = false;
    show('pause');
  }
  function resume() {
    if (mode !== 'paused') return;
    mode = 'play';
    show(null);
    last = performance.now();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  root.addEventListener('resize', () => renderer.resize());

  // ---------- simulation events ----------
  function handleEvents() {
    const evs = game.events;
    const live = !demo;
    for (const ev of evs) {
      renderer.onEvent(ev, game);
      switch (ev.t) {
        case 'fire':
          if (live) Sfx.shot(ev.lv);
          break;
        case 'gate':
          if (live) Sfx.gate(ev.good);
          else if (!ev.good) caption('앗! 잘못된 문…', true, 1800);
          break;
        case 'barrel':
          if (live) {
            Sfx.barrel(ev.type);
            if (ev.type === 'bomb') Sfx.bomb();
          }
          break;
        case 'weapon':
          if (live) {
            el.weapon.classList.remove('pop');
            void el.weapon.offsetWidth;
            el.weapon.classList.add('pop');
          }
          break;
        case 'clash':
          if (live) Sfx.clash();
          break;
        case 'smash':
          if (live) Sfx.smash();
          break;
        case 'boss':
          if (live) {
            Sfx.boss();
            caption(ev.name + ' 등장!', true, 1600);
            if (game.def.bossHint) queueHint(game.def.bossHint, true);
          }
          break;
        case 'bossDown':
          if (live) Sfx.bossDown();
          break;
        case 'win':
          if (demo) {
            caption('돌파 성공!', false, 2000);
            demo.endAt = performance.now() + 2200;
          } else {
            Sfx.win();
            overAt = performance.now() + 1500;
          }
          break;
        case 'lose':
          if (demo) {
            caption('전멸! 당신이라면 깰 수 있을까?', true, 2800);
            demo.endAt = performance.now() + 3000;
          } else {
            Sfx.lose();
            overAt = performance.now() + 1300;
          }
          break;
      }
    }
    evs.length = 0;
  }

  // ---------- HUD ----------
  function fmt(n) {
    return Math.round(n).toLocaleString('ko-KR');
  }

  function updateHud() {
    const g = game;
    if (stageId === 'endless') {
      setText(el.hudScore, 'score', `${fmt(g.z / 10)}m · ${fmt(Math.floor(g.z / 10) + g.kills)}점`);
    } else {
      const p = clamp(g.z / g.def.length, 0, 1);
      const w = (p * 100).toFixed(1) + '%';
      if (hudCache.prog !== w) {
        hudCache.prog = w;
        el.progressFill.style.width = w;
      }
    }
    const wpn = WEAPONS[g.weapon];
    setText(el.weaponLv, 'wlv', 'Lv.' + g.weapon);
    setText(el.weaponName, 'wname', wpn.name);

    const rapid = g.rapidT > 0;
    if (el.buffRapid.hidden === rapid) el.buffRapid.hidden = !rapid;
    if (rapid) setText(el.buffRapid.querySelector('b'), 'rapid', Math.ceil(g.rapidT) + '초');
    const frz = g.freezeT > 0;
    if (el.buffFreeze.hidden === frz) el.buffFreeze.hidden = !frz;
    if (frz) setText(el.buffFreeze.querySelector('b'), 'freeze', Math.ceil(g.freezeT) + '초');

    const b = g.boss;
    const bossOn = !!(b && b.alive);
    if (el.bossbar.hidden === bossOn) el.bossbar.hidden = !bossOn;
    if (bossOn) {
      setText(el.bossName, 'bname', b.name);
      setText(el.bossHp, 'bhp', fmt(Math.ceil(b.hp)));
      const w = ((b.hp / b.hpMax) * 100).toFixed(1) + '%';
      if (hudCache.bfill !== w) {
        hudCache.bfill = w;
        el.bossFill.style.width = w;
      }
    }
  }

  // ---------- result ----------
  const CAUSE = {
    horde: '좀비 무리에 부대가 삼켜졌어요. 무리가 다가오기 전에 정면에서 쏘세요.',
    gate: '손해 게이트가 부대를 날려 버렸어요. 빨간 숫자는 쏴서 키울 수 있어요.',
    boss: '보스를 쓰러뜨리지 못했어요. 무기 배럴과 곱셈 게이트로 화력을 키우세요.',
    brute: '거대 좀비에게 짓밟혔어요. 부딪히기 전에 최대한 쏴 두세요.',
    saw: '톱날에 부대가 무너졌어요. 톱날이 반대편으로 갈 때 지나가세요.',
    spikes: '가시 바리케이드에 걸렸어요. 비어 있는 쪽으로 돌아가세요.',
    tires: '타이어 더미에 부딪혔어요. 쏴서 부수거나 피하세요.',
  };

  function statRows(rows) {
    el.resultStats.textContent = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      el.resultStats.append(dt, dd);
    }
  }

  function showResult() {
    const r = ZGR.result(game);
    mode = 'result';
    el.hud.hidden = true;
    el.buffs.hidden = true;
    el.bossbar.hidden = true;
    hideHint();
    hideCaption();
    const secs = Math.round(r.time);
    if (stageId === 'endless') {
      const isNew = r.score > (save.best || 0);
      save.best = Math.max(save.best || 0, r.score);
      writeSave();
      el.resultEyebrow.textContent = '무한 모드';
      el.resultTitle.textContent = '게임 오버';
      el.resultTitle.className = 'result-title lose';
      el.resultStars.hidden = true;
      statRows([
        ['점수', fmt(r.score)],
        ['이동 거리', fmt(r.distance / 10) + 'm'],
        ['처치한 좀비', fmt(r.kills)],
        ['최대 병력', fmt(r.peak)],
        ['최고 기록', fmt(save.best)],
      ]);
      el.resultNote.textContent = isNew ? '새 최고 기록입니다!' : '';
      el.btnNext.hidden = true;
      el.btnToStages.textContent = '메뉴로';
    } else {
      const def = game.def;
      if (r.won) {
        save.stars[stageId] = Math.max(save.stars[stageId] || 0, r.stars);
        save.unlocked = Math.max(save.unlocked, Math.min(Stages.COUNT, stageId + 1));
        writeSave();
      }
      el.resultEyebrow.textContent = 'STAGE ' + stageId;
      el.resultTitle.textContent = r.won ? '클리어!' : '전멸…';
      el.resultTitle.className = 'result-title ' + (r.won ? 'win' : 'lose');
      el.resultStars.hidden = false;
      el.resultStars.innerHTML = [1, 2, 3].map((i) => `<span class="${i <= r.stars ? 'on' : ''}">★</span>`).join('');
      el.resultStars.setAttribute('aria-label', `별 ${r.stars}개`);
      statRows([
        ['남은 병사', fmt(r.survivors)],
        ['최대 병력', fmt(r.peak)],
        ['처치한 좀비', fmt(r.kills)],
        ['걸린 시간', secs + '초'],
      ]);
      if (r.won) {
        el.resultNote.textContent = r.stars >= 3 ? '완벽한 돌파!' : `병사 ${fmt(def.stars[r.stars === 1 ? 0 : 1])}명 이상 남기면 별 ${r.stars + 1}개`;
      } else {
        el.resultNote.textContent = CAUSE[r.cause] || '';
      }
      el.btnNext.hidden = !(r.won && stageId < Stages.COUNT);
      el.btnToStages.textContent = '스테이지 선택';
    }
    show('result');
  }

  // ---------- buttons ----------
  function on(id, fn) {
    $(id).addEventListener('click', () => {
      Sfx.unlock();
      Sfx.click();
      fn();
    });
  }
  on('btn-play', () => {
    renderStages();
    show('stages');
  });
  on('btn-endless', () => startStage('endless'));
  on('btn-help', () => show('help'));
  on('btn-help-close', () => show('title'));
  on('btn-stages-back', () => show('title'));
  on('btn-pause', pause);
  on('btn-resume', resume);
  on('btn-restart', () => startStage(stageId));
  on('btn-quit', goTitle);
  on('btn-next', () => startStage(stageId + 1));
  on('btn-retry', () => startStage(stageId));
  on('btn-to-stages', () => {
    if (stageId === 'endless') {
      goTitle();
      return;
    }
    goTitle();
    renderStages();
    show('stages');
  });
  function syncSound() {
    Sfx.setMuted(!!save.muted);
    el.btnSound.textContent = save.muted ? '소리 꺼짐' : '소리 켜짐';
    el.btnSound.setAttribute('aria-pressed', String(!save.muted));
  }
  el.btnSound.addEventListener('click', () => {
    save.muted = !save.muted;
    writeSave();
    Sfx.unlock();
    syncSound();
    Sfx.click();
  });

  // ---------- main loop ----------
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (game) {
      const simulate = demo ? true : mode === 'play';
      if (simulate && !game.over) {
        acc += dt;
        let steps = 0;
        while (acc >= C.DT && steps < 8 && !game.over) {
          ZGR.step(game, demo ? demo.bot(game) : playerInput());
          handleEvents();
          acc -= C.DT;
          steps++;
        }
        if (steps >= 8) acc = 0;
      }
      if (!demo && mode === 'play') {
        scanHints();
        updateHud();
      }
      renderer.draw(game, mode === 'paused' ? 0 : dt);
    }
    if (hints.until && now > hints.until) nextHint();
    if (captionUntil && now > captionUntil) hideCaption();
    if (demo && demo.endAt && now >= demo.endAt) startDemo();
    if (!demo && mode === 'play' && overAt && now >= overAt) {
      overAt = 0;
      showResult();
    }
    root.requestAnimationFrame(frame);
  }

  function boot(data) {
    if (data && data.save && save.unlocked <= 1 && Object.keys(save.stars).length === 0) {
      Object.assign(save, data.save);
    }
    syncSound();
    goTitle();
    root.requestAnimationFrame((t) => {
      last = t;
      frame(t);
    });
  }

  // keep progress across live reloads of the published page
  const hot = root.claude && root.claude.hot;
  try {
    if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ save }));
  } catch (e) {
    /* optional */
  }
  if (hot && typeof hot.ready === 'function') hot.ready(boot);
  else boot((hot && hot.data) || {});

  ZGR.App = { startStage, goTitle, get game() { return game; }, get mode() { return mode; }, input };
})(typeof window !== 'undefined' ? window : globalThis);
