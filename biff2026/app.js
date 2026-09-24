/* BIFF 2026 개인 일정 앱: 화면 로직
 * 일정 데이터는 schedule.js(window.TRIP)에 있고, 이 파일은 그 데이터를 읽어 화면만 그립니다.
 * 모든 시각은 한국 시간(KST) 기준으로 계산합니다. */
(() => {
  'use strict';

  const MIN = 60 * 1000;
  const KST = 9 * 60 * MIN;
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const MEALS = [
    { name: '아침', from: 7 * 60, to: 10 * 60 },
    { name: '점심', from: 11 * 60, to: 14 * 60 + 30 },
    { name: '저녁', from: 17 * 60, to: 20 * 60 + 30 },
  ];
  const DAY_START = 8 * 60;              // 오전 자유 시간은 08:00부터 셈
  const MORNING_MIN_END = 10 * 60 + 30;  // 숙소 출발이 이보다 늦을 때만 '오전 자유 시간' 표시
  const EVENING_CUTOFF = 19 * 60;        // 마지막 일정이 이보다 늦게 끝나면 '숙소로' 카드를 붙임
  const DAY_END = 22 * 60;               // '이후 자유 시간'의 끝
  const KEY_KINDS = ['film', 'train', 'checkin', 'checkout'];
  const MODE_ICON = { 도보: '🚶', 택시: '🚕', 지하철: '🚇', 버스: '🚌' };

  /* ---------- 저장소 (localStorage) ---------- */
  const PREFIX = 'biff26.';
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(PREFIX + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
  };

  /* ---------- 작은 도구 ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const num = (v, d) => {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v;
    return d;
  };

  function toIso(y, mo, d) {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCMonth() !== mo - 1) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  // "10-07", "10/7", "10.7", "10월 7일", "2026-10-07" → "2026-10-07"
  function parseDate(v, year) {
    if (v == null) return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})$/);
    if (m) return toIso(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*일?$/);
    if (m) return toIso(year, +m[1], +m[2]);
    return null;
  }
  // "13:30", "9:00", "13시 30분" → 하루 시작부터의 분
  function parseTime(v) {
    if (v == null) return null;
    const m = String(v).trim().match(/^(\d{1,2})\s*[:시]\s*(\d{1,2})\s*분?$/);
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 29 || mi > 59) return null;
    return h * 60 + mi;
  }
  // 72 또는 "96+17" → { total, text }
  function parseRuntime(v) {
    if (typeof v === 'number' && isFinite(v) && v > 0) return { total: Math.round(v), text: `${Math.round(v)}분` };
    if (typeof v === 'string') {
      const parts = v.replace(/분/g, '').split('+').map((x) => parseInt(x, 10));
      if (parts.length && parts.every((x) => isFinite(x) && x > 0)) {
        const total = parts.reduce((a, b) => a + b, 0);
        return { total, text: parts.length > 1 ? `${parts.join('+')}분` : `${total}분` };
      }
    }
    return null;
  }

  const at = (iso, minutes) => {
    const [y, mo, d] = iso.split('-').map(Number);
    return Date.UTC(y, mo - 1, d) - KST + minutes * MIN;
  };
  const kst = (ms) => {
    const t = new Date(ms + KST);
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
  };
  const isoOf = (ms) => { const p = kst(ms); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; };
  const hm = (ms) => { const p = kst(ms); return `${pad(p.h)}:${pad(p.mi)}`; };
  const minOfDay = (ms) => { const p = kst(ms); return p.h * 60 + p.mi; };
  const dowOf = (iso) => { const [y, mo, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); };
  const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
  const dateShort = (iso) => `${md(iso)} (${DOW[dowOf(iso)]})`;
  const dateLong = (iso) => `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 (${DOW[dowOf(iso)]})`;
  const addDays = (iso, n) => {
    const [y, mo, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, mo - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  };
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  function dur(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return `${m}분`;
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }
  const about = (min) => dur(Math.floor(min / 10) * 10);   // "약 N"용: 10분 단위로 내림
  function remain(ms) {
    const min = Math.ceil(ms / MIN);
    if (min <= 0) return '지금';
    if (min < 24 * 60) return dur(min);
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60);
    return h ? `${d}일 ${h}시간` : `${d}일`;
  }
  const range = (m) => (m.lo === m.hi ? `${m.lo}분` : `${m.lo}~${m.hi}분`);

  /* ---------- 지금 시각 (미리보기: ?now=2026-10-08T08:30) ---------- */
  const sim = (() => {
    const q = new URLSearchParams(location.search).get('now');
    const m = q && q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const iso = toIso(+m[1], +m[2], +m[3]);
    return iso ? { base: at(iso, +m[4] * 60 + +m[5]), loaded: Date.now() } : null;
  })();
  const now = () => (sim ? sim.base + (Date.now() - sim.loaded) : Date.now());

  /* ================================================================
   *  schedule.js 읽기
   * ================================================================ */
  function load(raw) {
    const errors = [];
    if (!raw || typeof raw !== 'object') {
      return { T: null, errors: ['schedule.js를 읽지 못했습니다. 마지막으로 고친 곳의 쉼표(,), 따옴표("), 괄호를 확인하세요.'] };
    }
    const year = num(raw.연도, 2026);
    const start = parseDate(raw.시작일, year);
    const end = parseDate(raw.종료일, year);
    if (!start || !end || end < start) {
      return { T: null, errors: ['시작일·종료일 형식을 확인하세요 (예: "10-07").'] };
    }
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

    const S = raw.설정 || {};
    const cfg = {
      movieBuf: num(S.영화입장여유, 15),
      trainBuf: num(S.기차여유, 15),
      gv: num(S.GV예상시간, 30),
      mealMin: num(S.최소식사시간, 30),
      mealOk: num(S.여유식사시간, 60),
      slackWarn: num(S.이동여유경고, 15),
    };

    const byDate = (obj) => {
      const out = {};
      Object.entries(obj || {}).forEach(([k, v]) => {
        const d = parseDate(k, year);
        if (d) out[d] = String(v); else errors.push(`날짜 "${k}" 형식을 확인하세요.`);
      });
      return out;
    };
    const holidays = byDate(raw.휴일);
    const dayMemo = byDate(raw.날짜메모);

    const places = {};
    Object.entries(raw.장소목록 || {}).forEach(([key, p]) => {
      p = p || {};
      places[key] = {
        key,
        name: p.이름 || key,
        kind: p.종류 || '',
        addr: p.주소 || '',
        lat: num(p.위도, null),
        lng: num(p.경도, null),
        query: p.지도검색어 || p.이름 || key,
        access: p.가는법 || '',
        memo: p.메모 || '',
        phone: p.전화 || '',
      };
    });
    const placeKey = (key, where) => {
      if (!key) return '';
      if (places[key]) return key;
      errors.push(`${where}: 장소 "${key}"가 장소목록에 없습니다.`);
      return '';
    };

    const L = raw.숙소 || {};
    const lodging = {
      place: placeKey(L.장소 || '숙소', '숙소'),
      checkInDate: parseDate(L.체크인날짜, year) || start,
      checkInFrom: parseTime(L.입실가능) ?? 15 * 60,
      checkOutDate: parseDate(L.체크아웃날짜, year) || end,
      checkOutBy: parseTime(L.퇴실마감) ?? 11 * 60,
      confirmed: L.시간확인됨 === true,
    };

    const trains = [];
    (raw.기차 || []).forEach((t, i) => {
      t = t || {};
      const where = `기차 ${i + 1}번째 줄`;
      const date = parseDate(t.날짜, year), dep = parseTime(t.출발), arr = parseTime(t.도착);
      if (!date || dep == null || arr == null) { errors.push(`${where}: 날짜·시각 형식을 확인하세요.`); return; }
      const s = at(date, dep);
      let e = at(date, arr);
      if (e <= s) e += 1440 * MIN;
      trains.push({
        id: `train-${date}-${dep}`, date, start: s, end: e,
        fromName: t.출발역 || '', toName: t.도착역 || '',
        from: placeKey(t.출발장소, where), to: placeKey(t.도착장소, where),
        memo: t.메모 || '',
      });
    });

    const films = [];
    const ids = new Set();
    (raw.영화 || []).forEach((f, i) => {
      f = f || {};
      const label = f.제목 ? `영화 "${f.제목}"` : `영화 ${i + 1}번째 줄`;
      const date = parseDate(f.날짜, year), t = parseTime(f.시작), rt = parseRuntime(f.러닝타임);
      if (!date) { errors.push(`${label}: 날짜 형식을 확인하세요 (예: "10-07").`); return; }
      if (t == null) { errors.push(`${label}: 시작 시각 형식을 확인하세요 (예: "13:30").`); return; }
      if (!rt) { errors.push(`${label}: 러닝타임은 숫자(예: 72) 또는 "96+17" 형식이어야 합니다.`); return; }
      const code = String(f.코드 == null ? '' : f.코드).trim();
      let id = code || `${date}-${t}`;
      if (ids.has(id)) id = `${id}-${i}`;
      ids.add(id);
      const s = at(date, t);
      const gv = f.GV === true;
      const endFilm = s + rt.total * MIN;
      films.push({
        id, code, date, start: s, endFilm, end: endFilm + (gv ? cfg.gv * MIN : 0),
        title: String(f.제목 || '(제목 없음)'), en: f.영문 || '',
        runtime: rt.total, runtimeText: rt.text,
        place: placeKey(f.장소, label), hall: f.관 || '', gv,
        bookedDefault: f.예매 === true, buf: num(f.입장여유, null), memo: f.메모 || '',
      });
    });
    films.sort((a, b) => a.start - b.start);

    const travel = {};
    (raw.이동시간 || []).forEach((row, i) => {
      const where = `이동시간 ${i + 1}번째 줄`;
      if (!Array.isArray(row) || row.length < 3) { errors.push(`${where}: 형식을 확인하세요.`); return; }
      const [a, b, obj] = row;
      if (!places[a] || !places[b]) { errors.push(`${where}: 장소 "${places[a] ? b : a}"가 장소목록에 없습니다.`); return; }
      const modes = [];
      Object.entries(obj || {}).forEach(([name, r]) => {
        const lo = Array.isArray(r) ? num(r[0], null) : num(r, null);
        const hi = Array.isArray(r) ? num(r[1], lo) : lo;
        if (lo == null || hi == null) { errors.push(`${where}: "${name}" 시간은 [최소, 최대] 숫자여야 합니다.`); return; }
        modes.push({ name, lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
      });
      if (modes.length) travel[`${a}|${b}`] = travel[`${b}|${a}`] = { modes, estimated: false };
    });
    const routeNotes = {};
    Object.entries(raw.이동경로메모 || {}).forEach(([k, v]) => {
      const [a, b] = k.split('|');
      routeNotes[`${a}|${b}`] = routeNotes[`${b}|${a}`] = String(v);
    });

    return {
      T: {
        name: raw.여행이름 || 'BIFF 2026', year, start, end, days, cfg, holidays, dayMemo,
        places, lodging, trains, films, travel, routeNotes,
        checklistDefault: (raw.체크리스트기본 || []).map(String),
      },
      errors,
    };
  }

  const loaded = load(window.TRIP);
  const T = loaded.T;
  const loadErrors = loaded.errors;

  /* ---------- 사용자 상태 ---------- */
  let userBooked = store.get('booked', {});     // 후보를 '현장 예매함'으로 켠 것 { id: true }
  let watched = store.get('watched', {});       // { id: 'seen' | 'missed' }
  const candOpen = {};                          // 날짜별 '미예매 후보' 펼침 상태
  let pastOpen = false;                         // 오늘 화면 '지난 일정' 펼침 상태

  const isBooked = (f) => f.bookedDefault || userBooked[f.id] === true;

  /* ================================================================
   *  이동 시간
   * ================================================================ */
  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const round5 = (x, up) => (up ? Math.ceil(x / 5) : Math.floor(x / 5)) * 5;

  // 표에 있으면 표 값, 없으면 좌표로 대략 추정
  function travelBetween(a, b) {
    if (!a || !b || a === b) return null;
    if (T.travel[`${a}|${b}`]) return T.travel[`${a}|${b}`];
    const pa = T.places[a], pb = T.places[b];
    if (!pa || !pb || pa.lat == null || pa.lng == null || pb.lat == null || pb.lng == null) return { modes: [], estimated: false };
    const m = haversine(pa, pb);
    const walk = (m * 1.3) / 75;
    const modes = [];
    if (walk <= 35) modes.push({ name: '도보', lo: Math.max(5, round5(walk * 0.9)), hi: Math.max(5, round5(walk * 1.2, true)) });
    if (m > 800) modes.push({ name: '택시', lo: Math.max(5, Math.round((m * 1.35) / 500 + 3)), hi: Math.max(8, Math.round((m * 1.35) / 330 + 6)) });
    return { modes, estimated: true };
  }

  /* ================================================================
   *  하루 타임라인 만들기
   *  이벤트(기차·예매 영화) 사이에 이동, 자유/식사 시간, 체크인·아웃을 끼워 넣습니다.
   * ================================================================ */
  const bufOf = (ev) => (ev.kind === 'film' ? (ev.f.buf != null ? ev.f.buf : T.cfg.movieBuf) : T.cfg.trainBuf);

  function mealOverlaps(from, to) {
    const d = isoOf(from);
    return MEALS.map((m) => {
      const a = Math.max(from, at(d, m.from)), b = Math.min(to, at(d, m.to));
      return { name: m.name, min: Math.max(0, (b - a) / MIN) };
    });
  }
  function mealName(from, to) {
    const best = mealOverlaps(from, to).sort((x, y) => y.min - x.min)[0];
    return best && best.min >= 30 ? best.name : '';
  }
  const mealNames = (from, to) => mealOverlaps(from, to).filter((m) => m.min >= 30).map((m) => m.name);

  function makeTravel(cur, ev, toPlace) {
    const to = ev ? ev.from : toPlace;
    const info = travelBetween(cur.place, to) || { modes: [] };
    const modes = info.modes || [];
    const buf = ev ? bufOf(ev) : 0;
    const it = {
      kind: 'travel', from: cur.place, to, modes, estimated: !!info.estimated, home: !ev,
      note: T.routeNotes[`${cur.place}|${to}`] || '', toEvent: ev || null, fromTime: cur.time, buf,
    };
    if (ev) {
      it.arriveBy = ev.start - buf * MIN;
      if (modes.length) {
        it.latest = it.arriveBy - modes[0].hi * MIN;
        it.alts = modes.map((m) => ({ name: m.name, latest: it.arriveBy - m.hi * MIN }));
        if (cur.time != null) {
          it.slack = Math.floor((it.latest - cur.time) / MIN);
          it.alts.forEach((a) => { a.slack = Math.floor((a.latest - cur.time) / MIN); });
          it.level = it.slack < 0 ? 'danger' : it.slack < T.cfg.slackWarn ? 'warn' : 'ok';
          if (cur.ev && cur.ev.kind === 'film' && cur.ev.f.gv) it.slackNoGV = it.slack + T.cfg.gv;
        }
      }
      it.start = cur.time != null ? cur.time : (it.latest != null ? it.latest : it.arriveBy);
      it.end = ev.start;
    } else {
      it.start = cur.time;
      it.end = cur.time + (modes.length ? modes[0].hi : 0) * MIN;
    }
    return it;
  }

  function makeFree(from, usableEnd, nextStart, note, showShort) {
    const gap = Math.floor((nextStart - from) / MIN);
    const usable = Math.floor((usableEnd - from) / MIN);
    if (gap <= 0) return null;
    const verdict = usable >= T.cfg.mealOk ? 'meal' : usable >= T.cfg.mealMin ? 'light' : 'short';
    if (verdict === 'short' && !showShort && !note) return null;
    return {
      kind: 'free', start: from, end: Math.max(from, usableEnd), nextStart, gap, usable: Math.max(0, usable),
      verdict, meal: mealName(from, usableEnd), note: note || '',
    };
  }

  function makeOpenFree(from, to, mode) {
    if (mode === 'before' && minOfDay(to) < MORNING_MIN_END) return null;
    const len = Math.floor((to - from) / MIN);
    if (len < 30) return null;
    return { kind: 'open', mode, start: from, end: to, len, meals: mealNames(from, to) };
  }

  function makeCheckout(iso, leaveAt) {
    const by = at(iso, T.lodging.checkOutBy);
    const t = Math.min(by, leaveAt);
    return { kind: 'checkout', id: 'checkout', start: t, end: t + 10 * MIN, by, early: leaveAt < by };
  }

  function buildDay(iso) {
    const L = T.lodging;
    const events = [];
    T.trains.forEach((t) => {
      if (t.date === iso) events.push({ kind: 'train', id: t.id, start: t.start, end: t.end, from: t.from, to: t.to, t });
    });
    T.films.forEach((f) => {
      if (f.date === iso && isBooked(f)) events.push({ kind: 'film', id: f.id, start: f.start, end: f.end, from: f.place, to: f.place, f });
    });
    events.sort((a, b) => a.start - b.start);

    const items = [];
    const hotel = L.place;
    const wakeAtHotel = !!hotel && iso > L.checkInDate && iso <= L.checkOutDate;
    let cur = { place: wakeAtHotel ? hotel : null, time: null, ev: null };
    let needCheckout = !!hotel && iso === L.checkOutDate;

    events.forEach((ev) => {
      const buf = bufOf(ev);
      const arriveBy = ev.start - buf * MIN;
      let pre = null;
      if (cur.place && ev.from && cur.place !== ev.from) {
        const tr = makeTravel(cur, ev);
        const leaveAt = tr.latest != null ? tr.latest : arriveBy;
        if (cur.time != null) {
          const fr = makeFree(cur.time, leaveAt, ev.start);
          if (fr) items.push(fr);
        } else if (needCheckout) {
          items.push(makeCheckout(iso, leaveAt));
          needCheckout = false;
        } else {
          const of = makeOpenFree(at(iso, DAY_START), leaveAt, 'before');
          if (of) items.push(of);
        }
        items.push(tr);
        pre = tr;
      } else if (cur.time != null && cur.place && cur.place === ev.from) {
        const hallMove = ev.kind === 'film' && cur.ev && cur.ev.kind === 'film' && cur.ev.f.hall !== ev.f.hall;
        const note = hallMove ? `${T.places[ev.from].name} 안에서 ${cur.ev.f.hall} → ${ev.f.hall} 이동 약 5분` : '';
        const fr = makeFree(cur.time, arriveBy - (hallMove ? 5 : 0) * MIN, ev.start, note, true);
        if (fr) items.push(fr);
      }
      items.push(Object.assign({}, ev, { pre, buf }));
      cur = { place: ev.to || null, time: ev.end, ev };
    });

    if (needCheckout) items.unshift(makeCheckout(iso, at(iso, L.checkOutBy)));

    if (hotel && iso === L.checkInDate) {
      let arrive = null;
      if (cur.place && cur.place !== hotel && cur.time != null) {
        const tr = makeTravel(cur, null, hotel);
        items.push(tr);
        arrive = Math.ceil(tr.end / (5 * MIN)) * 5 * MIN;   // 추정치라 5분 단위로 올림
      }
      const ciAt = Math.max(at(iso, L.checkInFrom), arrive || 0);
      items.push({ kind: 'checkin', id: 'checkin', start: ciAt, end: ciAt + 15 * MIN, arrive });
      if (minOfDay(ciAt) < 20 * 60) {
        const of = makeOpenFree(ciAt, at(iso, DAY_END), 'after');
        if (of) items.push(of);
      }
    } else if (!(hotel && iso === L.checkOutDate)) {
      if (!events.length) {
        items.push({ kind: 'freeday', start: at(iso, DAY_START), end: at(iso, DAY_END) });
      } else if (cur.time != null) {
        if (isoOf(cur.time) === iso && minOfDay(cur.time) < EVENING_CUTOFF) {
          const of = makeOpenFree(cur.time, at(iso, DAY_END), 'after');
          if (of) items.push(of);
        } else if (cur.place && hotel && cur.place !== hotel) {
          items.push(makeTravel(cur, null, hotel));
        }
      }
    }
    return { iso, items, events };
  }

  function buildAll() {
    const days = T.days.map(buildDay);
    const keys = [];
    days.forEach((d) => d.items.forEach((it) => { if (KEY_KINDS.includes(it.kind)) keys.push(it); }));
    keys.sort((a, b) => a.start - b.start);
    return { days, keys };
  }

  /* ================================================================
   *  화면 조각
   * ================================================================ */
  const placeName = (key) => (T.places[key] ? T.places[key].name : key || '');
  const filmWhere = (f) => {
    const name = placeName(f.place);
    return f.hall && !name.includes(f.hall) ? `${name} ${f.hall}`.trim() : name || f.hall;
  };

  function keyTitle(k) {
    if (k.kind === 'film') return k.f.title;
    if (k.kind === 'train') return `기차 ${k.t.fromName} → ${k.t.toName}`;
    if (k.kind === 'checkin') return '숙소 체크인';
    return '숙소 체크아웃';
  }
  function keyPlace(k) {
    if (k.kind === 'film') return filmWhere(k.f);
    if (k.kind === 'train') return k.t.from ? placeName(k.t.from) : `${k.t.fromName}역`;
    return placeName(T.lodging.place);
  }
  function whenLabel(ms, nowMs) {
    const d = isoOf(ms), today = isoOf(nowMs);
    if (d === today) return '오늘';
    if (d === addDays(today, 1)) return `내일 ${dateShort(d)}`;
    return dateShort(d);
  }

  function modesText(tr) {
    if (!tr.modes.length) return '이동 시간 미확인 (schedule.js 이동시간에 추가하세요)';
    const t = tr.modes.map((m) => `${MODE_ICON[m.name] || ''}${esc(m.name)} 약 ${range(m)}`).join(' · ');
    return tr.estimated ? `${t} <span class="small">(좌표로 추정)</span>` : t;
  }

  function seenButtons(f) {
    const w = watched[f.id];
    return `<div class="seen" role="group" aria-label="관람 여부">
      <button type="button" class="seen-yes ${w === 'seen' ? 'on' : ''}" data-seen="${esc(f.id)}" data-v="seen" aria-pressed="${w === 'seen'}">봄</button>
      <button type="button" class="seen-no ${w === 'missed' ? 'on' : ''}" data-seen="${esc(f.id)}" data-v="missed" aria-pressed="${w === 'missed'}">못 봄</button>
    </div>`;
  }

  function stateOf(it, nowMs) {
    if (it.end != null && nowMs >= it.end) return 'past';
    if ((it.kind === 'film' || it.kind === 'train') && nowMs >= it.start) return 'now';
    return '';
  }

  function renderItem(it, nowMs, nextId) {
    const st = stateOf(it, nowMs);
    const isNext = KEY_KINDS.includes(it.kind) && it.id === nextId && st !== 'past';
    const cls = `tl-item ${it.kind} ${st} ${isNext && st !== 'now' ? 'next' : ''}`;
    const tag = st === 'now' ? `<span class="chip accent">${it.kind === 'film' ? '상영 중' : '이동 중'}</span>`
      : isNext ? '<span class="chip accent">다음</span>' : '';

    if (it.kind === 'film') {
      const f = it.f;
      const w = watched[f.id];
      const chips = [
        tag,
        f.bookedDefault ? '<span class="chip ok">✓ 예매</span>' : '<span class="chip ok">✓ 현장 예매</span>',
        f.gv ? '<span class="chip">GV</span>' : '',
        st === 'past' && w ? `<span class="chip">${w === 'seen' ? '봄' : '못 봄'}</span>` : '',
      ].join('');
      return `<li class="${cls}">
        <div class="tl-time"><b>${hm(f.start)}</b><span>${hm(f.endFilm)}</span></div>
        <div class="card">
          <div class="chips">${chips}</div>
          <h3 class="film-title">${esc(f.title)}</h3>
          ${f.en ? `<p class="film-en">${esc(f.en)}</p>` : ''}
          <p class="meta"><b>${esc(filmWhere(f))}</b></p>
          <p class="meta">${hm(f.start)} → ${hm(f.endFilm)} 종료 예상 · ${esc(f.runtimeText)}</p>
          ${f.gv ? `<p class="meta">GV 포함 약 ${hm(f.end)}까지 <span class="small">(GV ${T.cfg.gv}분 추정)</span></p>` : ''}
          ${f.memo || f.code ? `<p class="memo">${[f.code ? `상영코드 ${esc(f.code)}` : '', esc(f.memo)].filter(Boolean).join(' · ')}</p>` : ''}
          ${nowMs >= f.endFilm ? seenButtons(f) : ''}
        </div>
      </li>`;
    }

    if (it.kind === 'train') {
      const t = it.t;
      const leavingBusan = !!t.from && !t.to;
      return `<li class="${cls}">
        <div class="tl-time"><b>${hm(t.start)}</b><span>${hm(t.end)}</span></div>
        <div class="card">
          <div class="chips">${tag}<span class="chip">🚄 기차</span></div>
          <h3>${esc(t.fromName)} ${hm(t.start)} → ${esc(t.toName)} ${hm(t.end)}</h3>
          <p class="meta">${dur((t.end - t.start) / MIN)} · ${leavingBusan ? '부산 출발' : t.to ? '부산 도착' : ''}</p>
          ${leavingBusan ? `<p class="meta">출발 ${it.buf}분 전(${hm(t.start - it.buf * MIN)})까지 역 도착 권장</p>` : ''}
          ${t.memo ? `<p class="memo">${esc(t.memo)}</p>` : ''}
        </div>
      </li>`;
    }

    if (it.kind === 'travel') {
      const lines = [];
      if (it.home) {
        lines.push(`<p class="route">🏨 ${esc(placeName(it.from))} → ${esc(placeName(it.to))}</p>`);
        lines.push(`<p>${modesText(it)}</p>`);
      } else {
        lines.push(`<p class="route">${esc(placeName(it.from))} → ${esc(placeName(it.to))}</p>`);
        lines.push(`<p>${modesText(it)}</p>`);
        if (it.note) lines.push(`<p class="small">${esc(it.note)}</p>`);
        if (it.latest != null) {
          const target = it.toEvent.kind === 'train' ? '기차 출발' : '상영';
          const main = it.modes[0];
          lines.push(`<p class="strong">늦어도 <b>${hm(it.latest)}</b> 출발${it.modes.length > 1 ? ` (${esc(main.name)})` : ''}</p>`);
          lines.push(`<p class="small">${hm(it.arriveBy)}까지 도착 · ${target} ${it.buf}분 전</p>`);
          const other = (it.alts || []).slice(1).filter((a) => a.slack == null || a.slack > (it.slack == null ? -1e9 : it.slack));
          if (it.level === 'danger' || it.level === 'warn') {
            const head = it.level === 'danger' ? `⚠ 시간 부족 · ${-it.slack}분 모자람` : `⚠ 이동 여유 ${it.slack}분`;
            const alt = other.length ? ` · ${esc(other[0].name)}면 여유 ${other[0].slack}분 (${hm(other[0].latest)} 출발)` : '';
            const gv = it.slackNoGV != null ? ` · GV 생략 시 여유 ${it.slackNoGV}분` : '';
            lines.push(`<p class="alert ${it.level}">${head}${alt}${gv}</p>`);
          } else if (other.length && it.slack == null) {
            lines.push(`<p class="small">${other.map((a) => `${esc(a.name)}면 ${hm(a.latest)} 출발`).join(' · ')}</p>`);
          }
          if (st !== 'past' && it.toEvent) {
            const left = it.latest - nowMs;
            if (left < 0 && nowMs < it.toEvent.start) {
              const alt = (it.alts || []).find((a) => a.latest > nowMs);
              lines.push(`<p class="alert danger">⏰ 출발 시각이 지났어요${alt ? ` · ${esc(alt.name)}(으)로 ${hm(alt.latest)}까지 출발` : ''}</p>`);
            } else if (left >= 0 && left <= 20 * MIN) {
              lines.push(`<p class="alert info">⏰ ${remain(left)} 후 출발</p>`);
            }
          }
        }
      }
      const timeCol = it.home ? '<span>숙소로</span>' : it.latest != null ? `<span>출발</span><b>${hm(it.latest)}</b>` : '';
      return `<li class="${cls}"><div class="tl-time">${timeCol}</div><div class="conn">${lines.join('')}</div></li>`;
    }

    if (it.kind === 'free') {
      let body;
      if (it.verdict === 'short') {
        body = `<p>쉬는 시간 ${it.gap}분 <span class="small">(식사 어려움)</span></p>`;
      } else {
        const meal = it.verdict === 'meal'
          ? `<p class="meal ok">🍚 ${it.meal ? `${it.meal} ` : ''}식사 가능: 약 ${about(it.usable)}</p>`
          : `<p class="meal light">🍙 간단한 식사만 가능 (약 ${about(it.usable)})</p>`;
        body = `<p class="strong">${hm(it.start)}–${hm(it.end)} 자유 시간</p>${meal}`;
      }
      if (it.note) body += `<p class="small">${esc(it.note)}</p>`;
      return `<li class="${cls}"><div class="tl-time"><span>${hm(it.start)}</span></div><div class="conn">${body}</div></li>`;
    }

    if (it.kind === 'open') {
      const title = it.mode === 'before' ? `${hm(it.end)} 출발 전까지 자유 시간` : `${hm(it.start)} 이후 자유 시간`;
      const meals = it.meals.length
        ? `<p class="meal ok">🍚 ${it.len >= 180 ? `식사 자유 (${it.meals.join('·')})` : `${it.meals.join('·')} 식사 가능`}</p>` : '';
      const sub = it.mode === 'after' ? '<p class="small">이후 예매한 일정 없음</p>' : '';
      return `<li class="${cls}"><div class="tl-time"><span>${hm(it.start)}</span></div><div class="conn"><p class="strong">${title}</p>${meals}${sub}</div></li>`;
    }

    if (it.kind === 'freeday') {
      return `<li class="${cls}"><div class="tl-time"></div><div class="card">
        <h3>종일 자유 시간</h3>
        <p class="meta">예매한 영화가 없는 날이에요. 식사·휴식 자유.</p>
        <p class="memo">현장 판매나 취소표를 노린다면 아래 '미예매 후보'를 보세요.</p>
      </div></li>`;
    }

    if (it.kind === 'checkin' || it.kind === 'checkout') {
      const L = T.lodging;
      const unconfirmed = L.confirmed ? '' : ' <span class="small">(미확인 · 예약 확인)</span>';
      const hotelName = esc(placeName(L.place));
      let body;
      if (it.kind === 'checkin') {
        body = `<h3>🏨 숙소 체크인</h3><p class="meta">${hotelName}</p>
          <p class="meta">입실 ${pad(Math.floor(L.checkInFrom / 60))}:${pad(L.checkInFrom % 60)}부터 가능${unconfirmed}</p>
          ${it.arrive ? `<p class="meta">숙소 도착 예상 약 ${hm(it.arrive)}</p>` : ''}`;
      } else {
        body = `<h3>🏨 숙소 체크아웃 · 짐 챙기기</h3><p class="meta">${hotelName}</p>
          <p class="meta">퇴실 ${hm(it.by)}까지${unconfirmed}</p>
          ${it.early ? `<p class="memo warn">첫 일정 때문에 ${hm(it.start)} 전에 나가야 해요. 짐을 맡길지 들고 나갈지 미리 정하기</p>` : ''}`;
      }
      return `<li class="${cls}"><div class="tl-time"><b>${hm(it.start)}</b></div><div class="card"><div class="chips">${tag}</div>${body}</div></li>`;
    }
    return '';
  }

  function conflictsOf(f) {
    const out = [];
    T.trains.forEach((t) => { if (f.start < t.end && t.start < f.end) out.push('기차 이동 시간'); });
    T.films.forEach((g) => {
      if (g !== f && isBooked(g) && f.start < g.end && g.start < f.end) out.push(g.title);
    });
    return out;
  }

  function renderCands(iso) {
    const list = T.films.filter((f) => f.date === iso && !f.bookedDefault);
    if (!list.length) return '';
    const on = list.filter((f) => userBooked[f.id]).length;
    const rows = list.map((f) => {
      const conflicts = conflictsOf(f);
      return `<div class="cand ${userBooked[f.id] ? 'on' : ''}">
        <div class="cand-main">
          <p class="cand-time"><b>${hm(f.start)}</b>–${hm(f.endFilm)}</p>
          <p class="cand-title">${esc(f.title)}</p>
          <p class="meta">${esc(filmWhere(f))} · ${esc(f.runtimeText)}${f.gv ? ' · GV' : ''}${f.code ? ` · ${esc(f.code)}` : ''}</p>
          ${f.memo ? `<p class="meta">${esc(f.memo)}</p>` : ''}
          ${conflicts.length ? `<p class="conflict">⚠ 겹침: ${conflicts.map(esc).join(', ')}</p>` : ''}
        </div>
        <label class="switch"><input type="checkbox" data-book="${esc(f.id)}" ${userBooked[f.id] ? 'checked' : ''} aria-label="${esc(f.title)} 예매함"><span>예매함</span></label>
      </div>`;
    }).join('');
    return `<details class="cands" data-cands="${iso}" ${candOpen[iso] ? 'open' : ''}>
      <summary><span>미예매 후보 ${list.length}편 <small>${on ? `${on}편 일정에 추가됨` : '일정에 포함 안 됨'}</small></span></summary>
      <p class="hint">예매하지 못한 후보입니다. 현장 판매나 취소표로 예매했다면 스위치를 켜세요. 켜면 일정과 식사·이동 계산에 들어갑니다.</p>
      ${rows}
    </details>`;
  }

  function daySummary(day) {
    const films = day.events.filter((e) => e.kind === 'film');
    const parts = [];
    day.events.filter((e) => e.kind === 'train').forEach((e) => {
      if (e.to && !e.from) parts.push(`부산 도착 ${hm(e.end)}`);
      else if (e.from && !e.to) parts.push(`부산 출발 ${hm(e.start)}`);
      else parts.push(`기차 ${hm(e.start)}`);
    });
    parts.push(films.length ? `영화 ${films.length}편` : '예매 영화 없음');
    return parts.join(' · ');
  }

  function daybar(active) {
    const today = isoOf(now());
    const chips = T.days.map((d) => {
      const cls = [d === active ? 'on' : '', d === today ? 'today' : '', T.holidays[d] || dowOf(d) === 0 ? 'hol' : ''].join(' ');
      return `<a href="#/day/${d}" class="${cls}" aria-label="${esc(dateLong(d))}"><b>${+d.slice(8)}</b><small>${DOW[dowOf(d)]}</small></a>`;
    }).join('');
    return `<nav class="daybar" aria-label="날짜 선택"><a href="#/all" class="all ${active === 'all' ? 'on' : ''}"><b>전체</b><small>한눈에</small></a>${chips}</nav>`;
  }

  /* ================================================================
   *  화면: 오늘
   * ================================================================ */
  function renderToday() {
    const nowMs = now();
    const today = isoOf(nowMs);
    const { days, keys } = buildAll();
    const idx = T.days.indexOf(today);
    const current = keys.find((k) => (k.kind === 'film' || k.kind === 'train') && k.start <= nowMs && nowMs < k.end);
    const next = keys.find((k) => k.start > nowMs);
    const nextFilm = keys.find((k) => k.kind === 'film' && k.start > nowMs);

    let dayno;
    if (idx >= 0) dayno = `부산 여행 ${idx + 1}일차 <small>/ ${T.days.length}일</small>`;
    else if (today < T.start) dayno = `여행 D-${daysBetween(today, T.start)}`;
    else dayno = '여행 끝';

    let currentHtml = '';
    if (current) {
      if (current.kind === 'film') {
        const f = current.f;
        const filmLeft = f.endFilm - nowMs;
        currentHtml = `<p class="current">▶ 상영 중 · <b>${esc(f.title)}</b> · ${filmLeft > 0 ? `${hm(f.endFilm)} 종료 (${remain(filmLeft)} 남음)` : `GV 중 · 약 ${hm(f.end)}까지`}</p>`;
      } else {
        currentHtml = `<p class="current">🚄 기차 이동 중 · ${hm(current.end)} ${esc(current.t.toName)} 도착 예정</p>`;
      }
    }

    let nextHtml;
    if (next) {
      const leave = next.pre && next.pre.latest != null ? leaveLine(next.pre, nowMs) : '';
      nextHtml = `<div class="next-block">
        <p class="label">다음 일정 · ${esc(whenLabel(next.start, nowMs))}</p>
        <div class="next-line"><span class="big-time">${hm(next.start)}</span><span class="next-title">${esc(keyTitle(next))}</span></div>
        <p class="next-place">${esc(keyPlace(next))}</p>
        <p class="remain">${remain(next.start - nowMs)} 남음</p>
        ${leave}
        ${nextFilm && nextFilm !== next ? `<p class="nextfilm">🎬 다음 영화까지 <b>${remain(nextFilm.start - nowMs)}</b> · ${esc(whenLabel(nextFilm.start, nowMs))} ${hm(nextFilm.start)} ${esc(nextFilm.f.title)}</p>` : ''}
        ${!nextFilm ? '<p class="nextfilm">🎬 남은 영화 없음</p>' : ''}
      </div>`;
    } else {
      nextHtml = `<div class="next-block"><p class="next-title">모든 일정이 끝났어요</p>
        <p class="next-place">영화 탭에서 봄 / 못 봄을 체크할 수 있어요.</p></div>`;
    }

    const showDay = idx >= 0 ? today : today < T.start ? T.start : T.end;
    const day = days[T.days.indexOf(showDay)];
    const nextId = next ? next.id : null;
    const list = (items) => `<ol class="tl">${items.map((it) => renderItem(it, nowMs, nextId)).join('')}</ol>`;
    const detailLink = (d) => {
      const cands = T.films.filter((f) => f.date === d && !f.bookedDefault).length;
      return `<p class="link-row"><a href="#/day/${d}">${esc(dateShort(d))} 상세 보기${cands ? ` · 미예매 후보 ${cands}편` : ''} ›</a></p>`;
    };

    let body;
    if (idx < 0) {
      const title = today < T.start ? '첫날 미리보기' : '마지막 날';
      body = `<h2 class="sec">${title} <small>· ${esc(dateLong(showDay))}</small></h2>
        ${T.dayMemo[showDay] ? `<p class="day-memo">${esc(T.dayMemo[showDay])}</p>` : ''}
        ${list(day.items)}${detailLink(showDay)}`;
    } else {
      // 여행 중: 지난 일정은 접어 두고 남은 일정부터 보여 줌
      let pastN = 0;
      while (pastN < day.items.length && stateOf(day.items[pastN], nowMs) === 'past') pastN++;
      const past = pastN ? `<details class="past-wrap" data-past ${pastOpen ? 'open' : ''}>
          <summary>지난 일정 ${pastN}개</summary>${list(day.items.slice(0, pastN))}</details>` : '';
      const rest = day.items.slice(pastN);
      body = `<h2 class="sec">오늘 일정 <small>· ${esc(daySummary(day))}</small></h2>
        ${T.dayMemo[today] ? `<p class="day-memo">${esc(T.dayMemo[today])}</p>` : ''}
        ${past}${rest.length ? list(rest) : '<p class="empty-line">오늘 남은 일정이 없어요.</p>'}${detailLink(today)}`;
      const tomorrow = addDays(today, 1);
      if (!rest.length && T.days.includes(tomorrow)) {
        const tday = days[T.days.indexOf(tomorrow)];
        body += `<h2 class="sec">내일 미리보기 <small>· ${esc(dateLong(tomorrow))} · ${esc(daySummary(tday))}</small></h2>
          ${T.dayMemo[tomorrow] ? `<p class="day-memo">${esc(T.dayMemo[tomorrow])}</p>` : ''}
          ${list(tday.items)}${detailLink(tomorrow)}`;
      }
    }

    return `<section class="status" aria-label="오늘 요약">
        <div class="status-top"><span class="today-date">${esc(dateLong(today))}</span><span class="dayno">${dayno}</span></div>
        ${currentHtml}
        ${nextHtml}
      </section>
      ${body}`;
  }

  function leaveLine(tr, nowMs) {
    const left = tr.latest - nowMs;
    const main = tr.modes[0];
    const route = `${esc(placeName(tr.from))} → ${esc(placeName(tr.to))} ${MODE_ICON[main.name] || ''}${esc(main.name)} ${range(main)}`;
    const alts = (tr.alts || []).slice(1).filter((a) => a.latest > nowMs)
      .map((a) => `${esc(a.name)}면 ${hm(a.latest)}`).join(' · ');
    if (left < 0) {
      return `<p class="leave late">⏰ 출발 시각(<b>${hm(tr.latest)}</b>)이 지났어요${alts ? ` · ${alts}까지 출발` : ''}<br><span class="small">${route}</span></p>`;
    }
    const cls = left <= 20 * MIN ? 'soon' : '';
    const rel = left < 6 * 60 * MIN ? ` (${remain(left)} 후)` : '';
    return `<p class="leave ${cls}">늦어도 <b>${hm(tr.latest)}</b> 출발${rel}${alts ? ` · ${alts}` : ''}<br><span class="small">${route}</span></p>`;
  }

  /* ================================================================
   *  화면: 날짜별
   * ================================================================ */
  function renderDay(iso) {
    const nowMs = now();
    const { days, keys } = buildAll();
    const next = keys.find((k) => k.start > nowMs);
    const i = T.days.indexOf(iso);
    const day = days[i];
    const hol = T.holidays[iso];
    return `${daybar(iso)}
      <header class="day-head">
        <button type="button" class="navbtn" data-go="${i > 0 ? T.days[i - 1] : ''}" ${i > 0 ? '' : 'disabled'} aria-label="이전 날">‹</button>
        <div class="mid">
          <h2>${esc(dateLong(iso))}${hol ? `<span class="hol">${esc(hol)}</span>` : ''}</h2>
          <p>${i + 1}일차 · ${esc(daySummary(day))}</p>
        </div>
        <button type="button" class="navbtn" data-go="${i < T.days.length - 1 ? T.days[i + 1] : ''}" ${i < T.days.length - 1 ? '' : 'disabled'} aria-label="다음 날">›</button>
      </header>
      ${T.dayMemo[iso] ? `<p class="day-memo">${esc(T.dayMemo[iso])}</p>` : ''}
      <ol class="tl">${day.items.map((it) => renderItem(it, nowMs, next ? next.id : null)).join('')}</ol>
      ${renderCands(iso)}`;
  }

  /* ================================================================
   *  화면: 전체 일정
   * ================================================================ */
  function renderAll() {
    const nowMs = now();
    const today = isoOf(nowMs);
    const { days } = buildAll();
    const booked = T.films.filter(isBooked).length;
    const rows = days.map((day, i) => {
      const d = day.iso;
      const films = day.events.filter((e) => e.kind === 'film');
      const hol = T.holidays[d];
      const cls = [d === today ? 'today' : '', d < today ? 'past' : ''].join(' ');
      return `<li><a class="ov-row ${cls}" href="#/day/${d}">
        <div class="ov-date ${hol || dowOf(d) === 0 ? 'hol' : ''}"><b>${+d.slice(8)}</b><span>${DOW[dowOf(d)]}</span></div>
        <div class="ov-main">
          <p class="ov-sum">${md(d)} ${esc(daySummary(day))}<small>${i + 1}일차${hol ? ` · ${esc(hol)}` : ''}</small></p>
          ${films.length ? `<p class="ov-films">${films.map((e) => `${hm(e.start)} ${esc(e.f.title)}`).join(' · ')}</p>` : '<p class="ov-films muted">종일 자유</p>'}
        </div>
        <span class="ov-go" aria-hidden="true">›</span>
      </a></li>`;
    }).join('');
    return `${daybar('all')}
      <div class="trip-head">
        <h2>${esc(T.name)}</h2>
        <p>${esc(dateShort(T.start))} – ${esc(dateShort(T.end))} · ${T.days.length}일 · 예매 영화 ${booked}편</p>
        <p class="small">숙소: ${esc(placeName(T.lodging.place))}</p>
      </div>
      <ol class="ov">${rows}</ol>`;
  }

  /* ================================================================
   *  화면: 영화 목록
   * ================================================================ */
  function renderFilms() {
    const nowMs = now();
    const sort = store.get('filmSort', 'date') === 'title' ? 'title' : 'date';
    const list = T.films.filter(isBooked).slice();
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'ko') || a.start - b.start);
    const done = list.filter((f) => nowMs >= f.endFilm);
    const seenN = done.filter((f) => watched[f.id] === 'seen').length;
    const missedN = done.filter((f) => watched[f.id] === 'missed').length;
    const rows = list.map((f) => {
      const over = nowMs >= f.endFilm;
      const playing = !over && nowMs >= f.start;
      const status = over ? seenButtons(f)
        : `<div class="chips">${playing ? '<span class="chip accent">상영 중</span>' : '<span class="chip">관람 예정</span>'}${f.bookedDefault ? '' : '<span class="chip ok">현장 예매</span>'}${f.gv ? '<span class="chip">GV</span>' : ''}</div>`;
      return `<li class="film-row ${over ? 'done' : ''}">
        <div class="fr-date"><span>${esc(dateShort(f.date))}</span><b>${hm(f.start)}</b></div>
        <div class="fr-main">
          <p class="fr-title"><a href="#/day/${f.date}">${esc(f.title)}</a></p>
          <p class="meta">${esc(filmWhere(f))}</p>
          <p class="meta">${esc(f.runtimeText)} · ~${hm(f.endFilm)} 종료${f.gv ? ` · GV 포함 ~${hm(f.end)}` : ''}</p>
          ${status}
        </div>
      </li>`;
    }).join('');
    return `<div class="list-head">
        <h2>예매한 영화 ${list.length}편</h2>
        <div class="seg" role="group" aria-label="정렬">
          <button type="button" data-sort="date" class="${sort === 'date' ? 'on' : ''}" aria-pressed="${sort === 'date'}">날짜순</button>
          <button type="button" data-sort="title" class="${sort === 'title' ? 'on' : ''}" aria-pressed="${sort === 'title'}">제목순</button>
        </div>
      </div>
      <p class="small" style="margin-top:6px">${done.length ? `끝난 영화 ${done.length}편 중 봄 ${seenN} · 못 봄 ${missedN}` : '영화가 끝나면 봄 / 못 봄을 체크할 수 있어요.'}</p>
      <ul class="films">${rows || '<li class="empty">예매한 영화가 없습니다.</li>'}</ul>`;
  }

  /* ================================================================
   *  화면: 장소
   * ================================================================ */
  function usedPlaces() {
    const uses = {};   // key → [{date, text}]
    const add = (key, date, text) => {
      if (!key) return;
      const list = (uses[key] = uses[key] || []);
      if (!list.some((u) => u.text === text)) list.push({ date, text });
    };
    if (T.lodging.place) add(T.lodging.place, T.lodging.checkInDate, `${md(T.lodging.checkInDate)}–${md(T.lodging.checkOutDate)} 숙박`);
    T.trains.forEach((t) => { add(t.from, t.date, `${md(t.date)} ${hm(t.start)} 출발`); add(t.to, t.date, `${md(t.date)} ${hm(t.end)} 도착`); });
    T.films.filter(isBooked).forEach((f) => {
      const hall = f.hall && !placeName(f.place).includes(f.hall) ? ` ${f.hall}` : '';
      add(f.place, f.date, `${md(f.date)}${hall}`);
    });
    return uses;
  }

  function mapLinks(p) {
    const q = encodeURIComponent(p.query);
    const naver = `https://map.naver.com/p/search/${q}`;
    const hasXY = p.lat != null && p.lng != null;
    const kakao = hasXY ? `https://map.kakao.com/link/to/${encodeURIComponent(p.name)},${p.lat},${p.lng}` : `https://map.kakao.com/link/search/${q}`;
    const google = hasXY ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
    return `<div class="btns">
      <a class="btn primary" href="${naver}" target="_blank" rel="noopener">네이버지도</a>
      <a class="btn" href="${kakao}" target="_blank" rel="noopener">카카오 ${hasXY ? '길찾기' : '맵'}</a>
      <a class="btn" href="${google}" target="_blank" rel="noopener">구글 지도</a>
    </div>`;
  }

  function renderPlaces() {
    const uses = usedPlaces();
    const order = Object.keys(uses).sort((a, b) => {
      const rank = (k) => (k === T.lodging.place ? 0 : T.places[k].kind === '기차역' ? 2 : 1);
      return rank(a) - rank(b) || uses[a][0].date.localeCompare(uses[b][0].date);
    });
    const cards = order.map((key) => {
      const p = T.places[key];
      if (!p) return '';
      const u = uses[key];
      return `<article class="card place">
        <p class="kind">${esc(p.kind)}</p>
        <h3>${esc(p.name)}</h3>
        ${p.addr ? `<div class="addr"><p>${esc(p.addr)}</p><button type="button" class="btn small" data-copy="${esc(p.addr)}">주소 복사</button></div>` : '<p class="meta">주소 미확인</p>'}
        ${p.access ? `<p class="meta">${esc(p.access)}</p>` : ''}
        ${p.memo ? `<p class="memo">${esc(p.memo)}</p>` : ''}
        ${p.phone ? `<p class="meta"><a href="tel:${esc(p.phone.replace(/[^0-9+]/g, ''))}">📞 ${esc(p.phone)}</a></p>` : ''}
        <p class="uses"><b>일정:</b> ${u.map((x) => esc(x.text)).join(' · ')}</p>
        ${mapLinks(p)}
      </article>`;
    }).join('');
    return `<div class="list-head"><h2>장소</h2></div>
      <p class="small" style="margin-top:6px">일정에 있는 곳만 모았습니다. 지도 버튼은 온라인일 때만 열립니다.</p>
      <div class="places">${cards}</div>`;
  }

  /* ================================================================
   *  화면: 체크리스트
   * ================================================================ */
  let checklist = store.get('checklist', null);
  const defaultChecklist = () => T.checklistDefault.map((text, i) => ({ id: `d${i}`, text, done: false }));
  if (!Array.isArray(checklist)) checklist = defaultChecklist();
  const saveChecklist = () => store.set('checklist', checklist);

  function renderCheck() {
    const doneN = checklist.filter((c) => c.done).length;
    const rows = checklist.map((c) => `<li class="${c.done ? 'done' : ''}">
        <label><input type="checkbox" data-check="${esc(c.id)}" ${c.done ? 'checked' : ''}><span>${esc(c.text)}</span></label>
        <button type="button" class="del" data-del="${esc(c.id)}" aria-label="${esc(c.text)} 삭제">×</button>
      </li>`).join('');
    return `<div class="list-head"><h2>체크리스트</h2><span class="muted num">${doneN} / ${checklist.length}</span></div>
      <form class="add" id="addForm" autocomplete="off">
        <input id="addInput" type="text" placeholder="항목 추가 (예: 선크림)" maxlength="80" aria-label="추가할 항목">
        <button type="submit" class="btn primary">추가</button>
      </form>
      <ul class="checks">${rows || '<li class="empty">항목이 없습니다.</li>'}</ul>
      <div class="check-foot">
        <button type="button" class="btn small" data-uncheck-all>체크 모두 해제</button>
        <button type="button" class="btn small" data-reset-check>기본 목록으로 되돌리기</button>
      </div>`;
  }

  /* ================================================================
   *  라우팅 · 그리기
   * ================================================================ */
  const view = document.getElementById('view');
  const banners = document.getElementById('banners');
  let route = { name: 'today' };
  let schedHref = '#/all';

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, arg] = h.split('/');
    if (name === 'day') {
      const d = arg && parseDate(arg, T.year);
      return d && T.days.includes(d) ? { name: 'day', day: d } : { name: 'all' };
    }
    if (['today', 'all', 'films', 'places', 'check'].includes(name)) return { name };
    return { name: 'today' };
  }

  function render() {
    let html;
    switch (route.name) {
      case 'day': html = renderDay(route.day); break;
      case 'all': html = renderAll(); break;
      case 'films': html = renderFilms(); break;
      case 'places': html = renderPlaces(); break;
      case 'check': html = renderCheck(); break;
      default: html = renderToday();
    }
    view.innerHTML = html;
    const tab = route.name === 'day' || route.name === 'all' ? 'sched' : route.name;
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.classList.toggle('on', a.dataset.tab === tab);
      if (a.dataset.tab === 'sched') a.setAttribute('href', schedHref);
    });
  }

  function onRoute() {
    const prev = route;
    route = parseHash();
    if (route.name === 'day') schedHref = `#/day/${route.day}`;
    if (route.name === 'all') schedHref = '#/all';
    render();
    const sameScreen = prev.name === route.name && prev.day === route.day;
    if (!sameScreen) window.scrollTo(0, 0);
    if (route.name === 'day') {
      const on = view.querySelector('.daybar a.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  function goDay(delta) {
    if (route.name === 'all' && delta > 0) { location.hash = `#/day/${T.days[0]}`; return; }
    if (route.name !== 'day') return;
    const i = T.days.indexOf(route.day) + delta;
    if (i < 0) { location.hash = '#/all'; return; }
    if (i < T.days.length) location.hash = `#/day/${T.days[i]}`;
  }

  /* ---------- 토스트 ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* 아래 방식으로 재시도 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ---------- 이벤트 ---------- */
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.seen) {
      const id = t.dataset.seen, v = t.dataset.v;
      if (watched[id] === v) delete watched[id]; else watched[id] = v;
      store.set('watched', watched);
      render();
    } else if (t.dataset.sort) {
      store.set('filmSort', t.dataset.sort);
      render();
    } else if (t.dataset.copy) {
      toast((await copyText(t.dataset.copy)) ? '주소를 복사했어요' : '복사하지 못했어요. 주소를 길게 눌러 복사하세요');
    } else if (t.dataset.go !== undefined && t.dataset.go) {
      location.hash = `#/day/${t.dataset.go}`;
    } else if (t.dataset.del) {
      const item = checklist.find((c) => c.id === t.dataset.del);
      if (item && window.confirm(`"${item.text}" 항목을 삭제할까요?`)) {
        checklist = checklist.filter((c) => c !== item);
        saveChecklist();
        render();
      }
    } else if (t.hasAttribute('data-uncheck-all')) {
      checklist.forEach((c) => { c.done = false; });
      saveChecklist();
      render();
    } else if (t.hasAttribute('data-reset-check')) {
      if (window.confirm('체크리스트를 기본 목록으로 되돌릴까요? 추가한 항목은 사라집니다.')) {
        checklist = defaultChecklist();
        saveChecklist();
        render();
      }
    }
  });

  view.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.book) {
      if (t.checked) userBooked[t.dataset.book] = true; else delete userBooked[t.dataset.book];
      store.set('booked', userBooked);
      toast(t.checked ? '일정에 추가했어요' : '일정에서 뺐어요');
      render();
    } else if (t.dataset.check) {
      const item = checklist.find((c) => c.id === t.dataset.check);
      if (item) { item.done = t.checked; saveChecklist(); render(); }
    }
  });

  view.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.dataset && d.dataset.cands) candOpen[d.dataset.cands] = d.open;
    if (d.dataset && d.dataset.past !== undefined) pastOpen = d.open;
  }, true);

  view.addEventListener('submit', (e) => {
    if (e.target.id !== 'addForm') return;
    e.preventDefault();
    const input = document.getElementById('addInput');
    const text = input.value.trim();
    if (!text) return;
    checklist.push({ id: `u${Date.now().toString(36)}`, text, done: false });
    saveChecklist();
    render();
    const again = document.getElementById('addInput');
    if (again) again.focus();
  });

  // 좌우로 밀어서 날짜 이동
  let touch = null;
  view.addEventListener('touchstart', (e) => {
    if ((route.name !== 'day' && route.name !== 'all') || e.touches.length !== 1 || e.target.closest('.daybar')) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (!touch) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - touch.x, dy = p.clientY - touch.y, dt = Date.now() - touch.t;
    touch = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 700) goDay(dx < 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') goDay(1);
    if (e.key === 'ArrowLeft') goDay(-1);
  });

  /* ---------- 배너 ---------- */
  function renderBanners(extra) {
    const out = [];
    if (loadErrors.length) {
      out.push(`<div class="banner error"><p><b>schedule.js 확인 필요</b><ul>${loadErrors.slice(0, 6).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></p></div>`);
    }
    if (sim) {
      out.push(`<div class="banner sim"><p>⏱ 미리보기: <b>${esc(dateShort(isoOf(sim.base)))} ${hm(sim.base)}</b> 기준으로 보는 중 (실제 시각 아님)</p><a class="btn" href="${esc(location.pathname)}">해제</a></div>`);
    }
    if (extra) out.push(extra);
    banners.innerHTML = out.join('');
  }

  /* ---------- 오프라인 (서비스 워커) ---------- */
  function setupSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    // onmessage로 등록해야 화면이 뜨기 전에 온 알림도 받습니다.
    navigator.serviceWorker.onmessage = (e) => {
      if (e.data && e.data.type === 'updated') {
        renderBanners('<div class="banner update"><p>새 일정 데이터가 준비됐어요.</p><button type="button" data-reload>새로고침</button></div>');
      }
    };
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
  banners.addEventListener('click', (e) => {
    if (e.target.closest('[data-reload]')) location.reload();
  });

  /* ---------- 시작 ---------- */
  if (!T) {
    view.innerHTML = `<div class="banner error" style="margin-top:16px"><p><b>일정을 불러오지 못했어요.</b><br>${loadErrors.map(esc).join('<br>')}</p></div>`;
    return;
  }
  renderBanners();
  window.addEventListener('hashchange', onRoute);
  onRoute();
  setupSW();

  // 30초마다 시간 관련 화면 갱신 (입력 중인 체크리스트는 제외)
  const tick = () => { if (route.name !== 'check' && document.visibilityState === 'visible') render(); };
  setInterval(tick, 30 * 1000);
  document.addEventListener('visibilitychange', tick);
})();
