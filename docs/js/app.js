/* Oscar Race Lab — UI. Hash-routed static app; all numbers come from analysis.js. */
(function () {
  "use strict";
  const D = window.ORL_DATA;
  const A = window.ORL.build(D);
  const $app = document.getElementById("app");
  const $header = document.querySelector(".site-header");

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const BODY = { oscar: "오스카", pga: "PGA", dga: "DGA", sag: "SAG", bafta: "BAFTA", gg: "골든글로브", cc: "Critics Choice", wga: "WGA" };
  const BODY_WHAT = {
    pga: "작품(프로듀서)상", dga: "감독 개인상 → 해당 영화", sag: "출연진 앙상블상 → 해당 영화", bafta: "작품상(영국 개봉 기준)",
    gg: "작품상 2부문(드라마 / 뮤지컬·코미디)", cc: "작품상", wga: "각본상 2부문 — 별도 지표",
  };
  // what the denominator of an agreement rate means, per body (shown in tooltips and notes)
  const BODY_DEN = {
    pga: "공동 수상(2014)은 공동 수상작 중 하나가 작품상이면 일치로 셈",
    bafta: "2000 시즌 BAFTA는 오스카 이후 개최(‘오스카 이후 제외’ 시 분모에서 빠짐)",
    gg: "해마다 수상작 2편 — 둘 중 하나라도 작품상이면 일치",
    cc: "후보 수가 해마다 10~14편으로 다름",
    wga: "해마다 수상작 2편(각본·각색), 조합 관할 각본만 자격 — 2024 시즌은 오스카 이후 개최",
  };
  const CAT = {
    oscar_bp: "오스카 작품상", pga: "PGA 작품상(Zanuck)", dga: "DGA 장편 감독상", sag_ensemble: "SAG 앙상블(캐스트)상",
    bafta_film: "BAFTA 작품상", gg_drama: "골든글로브 작품상–드라마", gg_musical_comedy: "골든글로브 작품상–뮤지컬·코미디",
    cc_picture: "Critics Choice 작품상", wga_original: "WGA 오리지널 각본상", wga_adapted: "WGA 각색상",
  };
  const CAT_SHORT = {
    oscar_bp: "오스카 작품상", pga: "PGA", dga: "DGA", sag_ensemble: "SAG 앙상블", bafta_film: "BAFTA", gg_drama: "글로브 드라마",
    gg_musical_comedy: "글로브 뮤지컬·코미디", cc_picture: "Critics Choice", wga_original: "WGA 오리지널", wga_adapted: "WGA 각색",
  };
  const CAT_BODY = Object.fromEntries(D.categories.map((c) => [c.id, c.body]));
  const CORE = A.CORE;
  const SEASONS = A.seasons;
  const film = (id) => A.idx.film.get(id);
  const title = (id) => (film(id) ? film(id).title : id);
  const filmLink = (id) => `<a href="#/film/${id}">${esc(title(id))}</a>`;
  const seasonLink = (s) => `<a href="#/season/${s}">${s}</a>`;
  const fmtDate = (iso) => (iso ? iso.replace(/-/g, ".") : "–");
  const md = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : "");
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "–");
  const ordinalKo = (n) => `제${n}회`;
  const seasonInfo = (s) => A.idx.season.get(s);
  const STATUS_TEXT = { W: "수상", N: "후보", "-": "–", I: "자격X", U: "?" };
  const STATUS_LONG = { W: "수상", N: "후보(수상 못함)", "-": "후보 아님", I: "자격 없음(문서화된 규정)", U: "미확인" };
  const GG_TAG = { gg_drama: "D", gg_musical_comedy: "MC", wga_original: "O", wga_adapted: "A" };
  const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

  // layer badges: the same two words everywhere
  const FACT = (t = "사실") => `<span class="pill fact" title="원자료에 있는 수상·후보 기록, 또는 그 기록을 그대로 센 값">${t}</span>`;
  const DERIVED = (t = "분석") => `<span class="pill derived" title="공개된 규칙으로 계산한 해석 라벨 — 규칙(기준값)을 바꾸면 결과도 바뀜">${t}</span>`;
  const count = (t, tip) => `<span class="count"${tip ? ` title="${esc(tip)}"` : ""}>${t}</span>`;
  const th = (label, tip, cls = "") => `<th${cls ? ` class="${cls}"` : ""}${tip ? ` title="${esc(tip)}"` : ""}>${label}</th>`;

  /** core precursor wins as dots + explicit n/denominator */
  function coreWinsDots(n, total = 6) {
    const tip = `오스카 이전에 열린 핵심 전초전 ${total}개 중 ${n}개 수상 (골든글로브는 두 부문 중 하나를 1개로 셈, WGA 제외)`;
    let h = `<span class="wins" title="${tip}"><span class="wins-dots" aria-hidden="true">`;
    for (let i = 0; i < total; i++) h += `<i class="${i < n ? "on" : ""}"></i>`;
    return h + `</span><span class="num">${n}<span class="den">/${total}</span></span></span>`;
  }

  function chipTitle(cat, code, tie, post) {
    return `${CAT[cat]}: ${STATUS_LONG[code]}${tie ? " · 공동 수상" : ""}${post ? " · 오스카 이후 개최(수상 수·선두 집계 제외)" : ""} — 눌러서 출처 보기`;
  }
  /** chip for a single category */
  function catChip(season, cat, fid) {
    const st = A.catStatus(season, cat, fid);
    const code = st.code === "-" ? "D" : st.code;
    const tie = !!(st.nom && st.nom.tie);
    const cer = A.ceremonyOf(season, CAT_BODY[cat]);
    const post = !!(cer && cer.after_oscars);
    return `<button type="button" class="st ${code}${tie ? " tie" : ""}${post ? " post" : ""}" data-rec="${season}|${cat}|${fid}" title="${esc(chipTitle(cat, st.code, tie, post))}">${STATUS_TEXT[st.code]}</button>`;
  }
  /** chip for a body (Golden Globes / WGA merge their two categories) */
  function bodyChip(season, body, fid) {
    const cats = A.BODY_CATS[body];
    if (cats.length === 1) return catChip(season, cats[0], fid);
    const st = A.bodyStatus(season, body, fid);
    const code = st.code === "-" ? "D" : st.code;
    const cer = A.ceremonyOf(season, body);
    const post = !!(cer && cer.after_oscars);
    const tag = st.code === "W" || st.code === "N" ? `<span class="sub">${GG_TAG[st.cat]}</span>` : "";
    return `<button type="button" class="st ${code}${post ? " post" : ""}" data-rec="${season}|${st.cat}|${fid}" title="${esc(chipTitle(st.cat, st.code, false, post))}">${STATUS_TEXT[st.code]}${tag}</button>`;
  }

  function legendStatus() {
    return `<div class="legend" aria-label="표 기호 설명">
      <span><span class="st W">수상</span> 수상</span>
      <span><span class="st N">후보</span> 후보(수상 못함)</span>
      <span><span class="st D">–</span> 후보 아님 (후보 목록 전체 확인)</span>
      <span><span class="st I">자격X</span> 규정상 자격 없음(근거 있음)</span>
      <span><span class="st W tie">수상</span> 공동 수상</span>
      <span><span class="st W post">수상</span> 오스카 이후 개최</span>
      <span class="muted">D/MC = 글로브 드라마/뮤지컬·코미디 · O/A = WGA 오리지널/각색 · 칸을 누르면 원자료·출처</span>
    </div>`;
  }

  // ---------------------------------------------------------------- popover (record & source inspector)
  const $pop = document.getElementById("pop");
  const $back = document.getElementById("pop-back");
  let lastFocus = null;
  function openPop(html) {
    lastFocus = document.activeElement;
    $pop.innerHTML = `<button type="button" class="close" data-close>닫기</button>` + html;
    $pop.classList.add("open");
    $back.classList.add("open");
    $pop.scrollTop = 0;
    $pop.querySelector("[data-close]").focus();
  }
  function closePop() {
    if (!$pop.classList.contains("open")) return;
    $pop.classList.remove("open");
    $back.classList.remove("open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $back.addEventListener("click", closePop);
  $pop.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closePop();
    else if (e.target.closest("a[href^='#/']")) closePop();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $pop.classList.contains("open")) closePop(); });

  const VERIF = {
    match: "위키백과 목록 페이지와 회차별 문서가 일치(수상작·후보 목록)",
    not_found: "회차별 문서의 형식 차이로 자동 대조하지 못함 — 목록 페이지 값 사용",
    winner_mismatch: "자동 대조에서 불일치 표시 → 수동 확인 필요",
    nominee_mismatch: "자동 대조에서 후보 목록 불일치 표시 → 수동 확인 필요",
    manual_ok: "자동 대조 도구의 오탐 → 수동 확인 결과 충돌 없음(데이터·출처 페이지의 해결 메모)",
    not_checked: "대조하지 않음",
  };
  // verification badges: solid = checked, dotted = not checked (미확인)
  const VB = { match: ["ok", "대조 일치"], manual_ok: ["man", "수동 확인"], not_found: ["unk", "대조 미확인"],
    winner_mismatch: ["man", "확인 필요"], nominee_mismatch: ["man", "확인 필요"], not_checked: ["unk", "미확인"] };
  const vbadge = (k) => { const [c, t] = VB[k] || ["unk", k]; return `<span class="vb ${c}">${t}</span>`; };

  function srcLine(sid) {
    const s = A.idx.source.get(sid);
    if (!s) return "";
    const rev = s.revid ? ` <span class="muted">· 리비전 ${s.revid}${s.rev_timestamp ? " (" + s.rev_timestamp.slice(0, 10) + ")" : ""}</span>` : "";
    return `<li>${esc(s.publisher)} — <a href="${esc(s.permalink || s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${rev}</li>`;
  }
  function refsList(refs) {
    if (!refs || !refs.length) return "";
    const off = refs.filter((r) => r.official), other = refs.filter((r) => !r.official);
    const li = (r) => `<li>${r.official ? '<span class="tag-official">공식</span>' : ""}<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></li>`;
    return `<h4 class="pop-sec">위키백과가 이 시상식 행에 인용한 자료 · ${refs.length}개 (공식 ${off.length})</h4><ul class="src-list">${off.concat(other).map(li).join("")}</ul>`;
  }

  function openRecord(season, cat, fid) {
    const body = CAT_BODY[cat];
    const st = A.catStatus(season, cat, fid);
    const cer = A.ceremonyOf(season, body);
    const si = seasonInfo(season);
    let h = `<p class="pop-kicker">${season} 시즌 · ${ordinalKo(si.oscar_ordinal)} 아카데미 · ${si.film_year}년 영화 ${FACT()}</p>
      <h3 id="pop-title">${esc(title(fid))}</h3>
      <p class="pop-cat">${esc(CAT[cat])}</p>
      <dl class="kv">
        <dt>결과</dt><dd><span class="st ${st.code === "-" ? "D" : st.code}${st.nom && st.nom.tie ? " tie" : ""}">${STATUS_TEXT[st.code]}</span> <b>${esc(STATUS_LONG[st.code])}</b>${st.nom && st.nom.tie ? " (공동 수상)" : ""}</dd>
        <dt>시상식</dt><dd>${esc(cer.name)} · ${fmtDate(cer.date)}${cer.after_oscars ? ' <span class="warn-text">† 오스카 이후 개최</span>' : ""}</dd>`;
    if (cer.date_note) h += `<dt>날짜 메모</dt><dd>${esc(cer.date_note)}</dd>`;
    if (st.nom) {
      h += `<dt>원자료 표기</dt><dd>“${esc(st.nom.shown_title)}”${st.nom.people ? " — " + esc(st.nom.people) : ""}</dd>
        <dt>검증</dt><dd>${vbadge(st.nom.verification.ceremony_page)} ${esc(VERIF[st.nom.verification.ceremony_page] || st.nom.verification.ceremony_page)}</dd>
        <dt>레코드 ID</dt><dd><code>${esc(st.nom.id)}</code></dd></dl>
        <h4 class="pop-sec">출처</h4><ul class="src-list">${srcLine(st.nom.source_id)}${srcLine(cer.source_id)}</ul>${refsList(st.nom.cited_refs)}`;
    } else if (st.code === "I") {
      h += `<dt>규정</dt><dd>${esc(st.elig.rule)}</dd><dt>근거</dt><dd>${esc(st.elig.evidence)}</dd></dl>
        <h4 class="pop-sec">출처</h4><ul class="src-list">${st.elig.source_ids.map(srcLine).join("")}</ul>`;
    } else {
      const list = A.noms(season, cat);
      h += `<dt>판정 방식</dt><dd>이 부문 후보 ${list.length}편 전체가 원자료에 있고 이 영화는 없음 → “후보 아님”으로 도출</dd></dl>`;
      if (body === "wga") h += `<p class="small warn-text">WGA는 조합 관할 각본만 자격이 있습니다. 후보에 없다는 것이 탈락인지 자격 없음인지는 확인하지 않았습니다(<span class="vb unk">미확인</span>).</p>`;
      h += `<h4 class="pop-sec">이 부문 후보 목록</h4><ul class="src-list plain">${list.map((n) => `<li>${n.result === "won" ? '<span class="st W">수상</span> ' : '<span class="st N">후보</span> '}${filmLink(n.film_id)}</li>`).join("")}</ul>
        <h4 class="pop-sec">출처</h4><ul class="src-list">${list.length ? srcLine(list[0].source_id) : ""}${srcLine(cer.source_id)}</ul>`;
    }
    openPop(h);
  }

  function openBodySeason(season, body) {
    const cer = A.ceremonyOf(season, body);
    const bp = A.bpWinner(season);
    let h = `<p class="pop-kicker">${season} 시즌 · ${fmtDate(cer.date)}${cer.after_oscars ? ' · <span class="warn-text">† 오스카 이후 개최</span>' : ""} ${FACT()}</p>
      <h3 id="pop-title">${esc(BODY[body])}</h3><p class="pop-cat">${esc(cer.name)}</p><dl class="kv">`;
    for (const cat of A.BODY_CATS[body]) {
      const ws = A.winners(season, cat);
      h += `<dt>${esc(CAT[cat])}</dt><dd>${ws.map(filmLink).join(" / ")}${ws.length > 1 ? " (공동)" : ""}</dd>`;
    }
    const st = A.bodyStatus(season, body, bp);
    h += `<dt>작품상 수상작</dt><dd>${filmLink(bp)} — 이 시상식에서 <b>${esc(STATUS_LONG[st.code])}</b></dd></dl>`;
    if (cer.date_note) h += `<p class="small dim">${esc(cer.date_note)}</p>`;
    h += `<p><a href="#/season/${season}">${season} 시즌 전체 보기 →</a></p>`;
    const n = A.noms(season, A.BODY_CATS[body][0])[0];
    h += `<h4 class="pop-sec">출처</h4><ul class="src-list">${A.BODY_CATS[body].map((c) => srcLine((A.noms(season, c)[0] || {}).source_id)).join("")}${srcLine(cer.source_id)}</ul>${n ? refsList(n.cited_refs) : ""}`;
    openPop(h);
  }

  document.addEventListener("click", (e) => {
    const r = e.target.closest("[data-rec]");
    if (r) { const [s, c, f] = r.dataset.rec.split("|"); openRecord(+s, c, f); return; }
    const b = e.target.closest("[data-bs]");
    if (b) { const [s, body] = b.dataset.bs.split("|"); openBodySeason(+s, body); }
  });

  // ---------------------------------------------------------------- table layout (sticky header / first column)
  // A table that fits its container lets its header stick to the page; a table that has to
  // scroll sideways becomes a scroll box (long ones get a max height) so both its header and
  // its first column(s) stay visible while scrolling.
  function layoutTables() {
    const stickyHeader = getComputedStyle($header).position === "sticky";
    document.documentElement.style.setProperty("--sticky-top", (stickyHeader ? $header.offsetHeight : 0) + "px");
    document.querySelectorAll("#app .table-wrap").forEach((w) => {
      const t = w.querySelector("table");
      if (!t) return;
      w.classList.remove("fits", "boxed");
      const fits = t.offsetWidth <= w.clientWidth + 1;
      w.classList.toggle("fits", fits);
      w.classList.toggle("boxed", !fits && t.tBodies[0] && t.tBodies[0].rows.length > 12);
      w.classList.toggle("scrolls", !fits);
    });
  }
  let redrawTimeline = null;
  function afterRender() {
    requestAnimationFrame(layoutTables);
  }
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { layoutTables(); if (redrawTimeline) redrawTimeline(); }, 120);
  });

  // ---------------------------------------------------------------- routing
  function parseHash() {
    const h = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = h.split("?");
    // "#/patterns#q-weak" style in-page anchors: keep only the route part
    return { parts: path.split("#")[0].split("/").filter(Boolean), q: new URLSearchParams((qs || "").split("#")[0]) };
  }
  function setQuery(q) {
    const { parts } = parseHash();
    const s = q.toString();
    history.replaceState(null, "", "#/" + parts.join("/") + (s ? "?" + s : ""));
  }
  const VIEWS = { home: viewHome, season: viewSeason, explore: viewExplore, agreement: viewAgreement, patterns: viewPatterns, film: viewFilm, data: viewData };
  function render() {
    const { parts, q } = parseHash();
    const name = VIEWS[parts[0]] ? parts[0] : "home";
    document.querySelectorAll("nav.main a").forEach((a) => {
      const on = a.dataset.nav === name;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    closePop();
    redrawTimeline = null;
    VIEWS[name](parts.slice(1), q);
    afterRender();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", render);

  const ERAS = [["전체", 2000, 2026], ["2000–09", 2000, 2009], ["2010–19", 2010, 2019], ["2020–26", 2020, 2026]];
  function seasonRangeControls(q) {
    const [from, to] = range(q);
    const opt = (sel) => SEASONS.map((s) => `<option value="${s}"${s === sel ? " selected" : ""}>${s}</option>`).join("");
    return `<label>시즌 <select data-k="from" aria-label="시작 시즌">${opt(from)}</select> – <select data-k="to" aria-label="끝 시즌">${opt(to)}</select></label>
      <span class="chips" role="group" aria-label="시대">${ERAS.map(([l, a, b]) => `<a href="#" data-era="${a}-${b}" class="${a === from && b === to ? "on" : ""}">${l}</a>`).join("")}</span>`;
  }
  function bindControls(root, q, onChange) {
    const syncEras = () => {
      const [from, to] = range(q);
      root.querySelectorAll("[data-era]").forEach((el) => { const [a, b] = el.dataset.era.split("-").map(Number); el.classList.toggle("on", a === from && b === to); });
    };
    root.querySelectorAll("[data-k]").forEach((el) => {
      el.addEventListener("change", () => {
        const v = el.type === "checkbox" ? (el.checked ? "1" : "") : el.value;
        if (v) q.set(el.dataset.k, v); else q.delete(el.dataset.k);
        setQuery(q); syncEras(); onChange(); afterRender();
      });
    });
    root.querySelectorAll("[data-era]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const [a, b] = el.dataset.era.split("-");
        q.set("from", a); q.set("to", b);
        root.querySelector('[data-k="from"]').value = a; root.querySelector('[data-k="to"]').value = b;
        setQuery(q); syncEras(); onChange(); afterRender();
      });
    });
  }
  function range(q) {
    let from = +q.get("from") || SEASONS[0], to = +q.get("to") || SEASONS[SEASONS.length - 1];
    if (from > to) [from, to] = [to, from];
    return [from, to];
  }

  // ---------------------------------------------------------------- HOME
  const LABEL_SHORT = { converged: "수렴", split: "분산", leader_lost: "최다 수상작 패배", early_changed: "초반 선두 교체", co_leader_won: "공동 선두 중 수상", leader_won: "" };
  function labelBadges(ss) {
    return ss.labels.filter((l) => LABEL_SHORT[l.id]).map((l) => `<span class="pill derived" title="${esc(l.text)}">${LABEL_SHORT[l.id]}</span>`).join(" ");
  }
  function viewHome() {
    const nNom = D.nominations.length;
    const wpSources = D.sources.filter((s) => s.revid).length;
    const sums = SEASONS.map((s) => A.seasonSummary(s)).reverse();
    let rows = "";
    for (const ss of sums) {
      const s = ss.season;
      let cells = "";
      for (const b of CORE.concat(["wga"])) {
        const g = A.agreement(b, { from: s, to: s }).rows[0];
        const cer = A.ceremonyOf(s, b);
        const post = cer.after_oscars ? " post" : "";
        const tie = g.match && g.winners.length > 1 && b !== "gg" && b !== "wga" ? " tie" : "";
        const tip = `${BODY[b]} 수상: ${g.winners.map(title).join(" / ")}${g.match ? " → 작품상과 일치" : " → 작품상과 다름"}${cer.after_oscars ? " (오스카 이후 개최)" : ""}`;
        cells += `<td class="c${b === "wga" ? " div-l" : ""}"><button type="button" class="st ${g.match ? "match" : "miss"}${post}${tie}" data-bs="${s}|${b}" title="${esc(tip)}" aria-label="${esc(tip)}">${g.match ? "✓" : "✗"}</button></td>`;
      }
      rows += `<tr><th scope="row">${seasonLink(s)}</th><td class="film-cell">${filmLink(ss.bp)}</td>
        <td>${coreWinsDots(ss.bpWins, ss.counted)}</td>${cells}<td class="div-l labels-cell">${labelBadges(ss)}</td></tr>`;
    }
    const agg = CORE.concat(["wga"]).map((b) => ({ b, g: A.agreement(b) }));
    $app.innerHTML = `
      <header class="page-head">
        <h1>작품상 레이스는 어떻게 형성되고 뒤집혔나</h1>
        <p class="lede">2000–2026년(제72–98회) 아카데미 작품상 레이스 27개 시즌을 주요 전초전 결과의 <b>누적</b>으로 탐색합니다.
        수상 결과는 ${FACT()} 레이어로, “선두·수렴·이변” 같은 해석은 규칙을 공개한 ${DERIVED()} 레이어로 분리했습니다. 예측 확률은 만들지 않습니다.</p>
      </header>
      <div class="grid cols-4 tiles">
        <div class="card tile"><div class="v">27</div><div class="k">시즌 (2000–2026)</div></div>
        <div class="card tile"><div class="v">6 + 1</div><div class="k">핵심 전초전 6개 + 각본 지표 WGA</div></div>
        <div class="card tile"><div class="v">${nNom.toLocaleString()}</div><div class="k">후보·수상 기록 (${D.films.length}편)</div></div>
        <div class="card tile"><div class="v">${wpSources}</div><div class="k">리비전 고정 출처 문서</div></div>
      </div>

      <div class="section-head"><h2>시즌 × 전초전: 그 상의 수상작이 작품상을 받았나</h2>${FACT()}${DERIVED("라벨은 분석")}</div>
      <p class="note">✓ = 그 시상식 수상작이 그해 작품상 수상작. 골든글로브는 두 부문 중 하나, WGA는 두 각본상 중 하나라도 같으면 ✓.
        <b>전초전 수상</b> = 작품상 수상작이 받은 핵심 6개 기관 수 / 오스카 전에 열린 핵심 기관 수(2000 시즌은 BAFTA가 오스카 이후라 5). 칸을 누르면 수상작과 출처가 열립니다.</p>
      <div class="table-wrap"><table class="data sticky-2 heat">
        <thead><tr>${th("시즌")}${th("작품상 수상작")}${th("전초전 수상", "작품상 수상작이 받은 핵심 전초전 수 / 오스카 이전에 열린 핵심 전초전 수. 골든글로브는 두 부문 중 하나를 1개로 셈. WGA 제외.")}
          ${CORE.map((b) => th(BODY[b], `${BODY_WHAT[b]} — ✓ = 수상작이 그해 작품상.${BODY_DEN[b] ? " " + BODY_DEN[b] : ""}`, "c")).join("")}
          ${th("WGA", `${BODY_WHAT.wga} — 전초전 수상 수에 포함하지 않음. ${BODY_DEN.wga}`, "c div-l")}${th("분석 라벨", "규칙 기반 해석 — 패턴 페이지에서 기준값 조정", "div-l")}</tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="legend"><span><span class="st match">✓</span> 일치</span><span><span class="st miss">✗</span> 다른 영화가 수상</span><span><span class="st match tie">✓</span> 공동 수상 중 하나</span><span><span class="st match post">✓</span> 오스카 이후 개최</span>
        <span>${DERIVED("라벨")} 규칙 기반 해석 — <a href="#/patterns">규칙 보기</a></span></div>

      <div class="section-head"><h2>기관별 작품상 일치율</h2>${FACT("사실 · 집계")}</div>
      <div class="card">${barsHTML(agg)}</div>
      <p class="note"><a href="#/agreement">시대별·조건별 일치율 자세히 →</a></p>

      <div class="section-head"><h2>바로 가기: 데이터로 답하는 질문</h2></div>
      <div class="q-list">
        <a href="#/explore?mode=won_lost&award=pga">PGA 수상작이 작품상을 놓친 해<span>탐색 → PGA 수상 · 작품상 실패</span></a>
        <a href="#/explore?mode=won_lost&award=dga">DGA와 작품상 결과가 갈린 해<span>탐색 → DGA 수상 · 작품상 실패</span></a>
        <a href="#/explore?mode=won_lost&award=bafta">BAFTA가 다른 방향을 가리킨 시즌<span>탐색 → BAFTA 수상 · 작품상 실패</span></a>
        <a href="#/explore?mode=without&award=sag">SAG 앙상블 없이 작품상을 받은 영화<span>탐색 → SAG 미수상 · 작품상 수상</span></a>
        <a href="#/patterns#q-converge">전초전이 수렴한 해 / 끝까지 갈린 해<span>패턴 → 수렴도</span></a>
        <a href="#/patterns#q-early">초반 선두와 최종 수상작이 달라진 시즌<span>패턴 → 초반 선두</span></a>
        <a href="#/patterns#q-sweep">전초전을 거의 휩쓸고도 작품상을 놓친 영화<span>패턴 → 근접 석권</span></a>
        <a href="#/patterns#q-weak">전초전 성적이 약했는데 작품상을 받은 영화<span>패턴 → 약세 수상</span></a>
        <a href="#/agreement">각 시상식의 역사적 일치율<span>일치율</span></a>
      </div>`;
  }

  function barsHTML(list) {
    let h = `<div class="bars" role="table" aria-label="기관별 작품상 일치율">`;
    const row = (label, g, sub, tip) => `<div class="lab${sub ? " sub" : ""}" role="cell">${label}</div>
      <div class="track" role="cell" title="${esc(tip)}"><div class="fill${sub ? " sub" : ""}" style="width:${g.n ? (100 * g.match) / g.n : 0}%"></div></div>
      <div class="val" role="cell" title="${esc(tip)}"><b>${g.match}</b>/${g.n} <span class="muted">· ${pct(g.match, g.n)}</span></div>`;
    let wgaStarted = false;
    for (const { b, g, opts } of list) {
      if (b === "wga" && !wgaStarted) { h += `<div class="group">각본 지표 — 별도 성격, 전초전 수상 수에 포함 안 함</div>`; wgaStarted = true; }
      const tip = `${BODY[b]}: 비교한 ${g.n}개 시즌 중 ${g.match}개 시즌에서 수상작 = 작품상 수상작.${BODY_DEN[b] ? " " + BODY_DEN[b] + "." : ""}`;
      h += row(`${BODY[b]} <span class="lab-what">${esc(BODY_WHAT[b])}</span>`, g, false, tip);
      if (b === "gg" || b === "wga") {
        for (const c of A.BODY_CATS[b]) {
          const gc = A.agreement(b, { ...(opts || {}), cats: [c] });
          const t2 = `${CAT[c]}: 분모 ${gc.n} = 비교한 전체 시즌. 작품상 수상작이 이 부문 후보였던 시즌은 ${gc.bpNominated}개뿐 — 나머지 해에는 이 부문 수상작이 작품상과 일치할 수 없었음.`;
          h += row(`└ ${CAT_SHORT[c].replace(/^글로브 |^WGA /, "")}`, gc, true, t2);
        }
      }
    }
    return h + `</div>
      <p class="note den-note"><b>분모 읽는 법</b> — 분모는 비교한 시즌 수입니다. ‘오스카 이후 개최 제외’를 켜면 BAFTA(2000)·WGA(2024)만 한 시즌씩 빠집니다.
      골든글로브·WGA는 해마다 수상작이 2편이라 ‘둘 중 하나’ 기준은 단일 수상 기관보다 높게 나오기 쉽고,
      부문별(└) 분모에는 작품상 수상작이 그 부문 후보가 아니었던 해도 들어 있습니다(예: 뮤지컬·코미디 부문 후보였던 작품상 수상작은 27시즌 중 7편).</p>`;
  }

  // ---------------------------------------------------------------- SEASON
  function viewSeason(args, q) {
    const s = SEASONS.includes(+args[0]) ? +args[0] : SEASONS[SEASONS.length - 1];
    const si = seasonInfo(s);
    const ss = A.seasonSummary(s, { earlyK: +q.get("k") || 2 });
    const all = q.get("all") === "1";
    const films = A.seasonFilms(s, { includeAllNominees: all });
    const bp = ss.bp;
    const den = ss.counted;
    const ceremonies = D.ceremonies.filter((c) => c.season === s && c.body !== "oscar").sort((a, b) => (a.date < b.date ? -1 : 1));
    const factRows = ceremonies.map((c) => `<tr><td class="num">${fmtDate(c.date)}</td><td>${esc(BODY[c.body])}${c.after_oscars ? ' <span class="warn-text" title="오스카 이후 개최">†</span>' : ""}</td>
        <td class="wrap">${A.BODY_CATS[c.body].map((cat) => `${A.BODY_CATS[c.body].length > 1 ? `<span class="tag">${GG_TAG[cat]}</span> ` : ""}${A.winners(s, cat).map(filmLink).join(" / ")}`).join("<br>")}</td>
        <td class="r"><button type="button" class="src-btn" data-bs="${s}|${c.body}" aria-label="${esc(BODY[c.body])} 출처">출처</button></td></tr>`).join("");

    // colors follow films (order of first counted win), stable within the season
    const tl = ss.timeline;
    const colorOrder = [];
    for (const ev of tl) if (ev.counted) for (const w of ev.winners) for (const f of w.films) if (!colorOrder.includes(f)) colorOrder.push(f);
    const color = (f) => SERIES[colorOrder.indexOf(f) % SERIES.length];

    const head = `<tr>${th("영화")}${th("오스카<br>작품상", "", "c")}${th("오스카<br>전체 후보", "이 영화가 받은 오스카 전 부문 후보 수(맥락 정보, 전초전 아님)", "r")}
      ${CORE.map((b) => th(BODY[b], `${BODY_WHAT[b]}.${BODY_DEN[b] ? " " + BODY_DEN[b] : ""}`, "c")).join("")}
      ${th("핵심<br>수상", `핵심 전초전 수상 수 / 오스카 이전에 열린 핵심 전초전 수(${den})`, "c")}${th('WGA<br><span class="muted">각본</span>', `${BODY_WHAT.wga} — 핵심 수상 수에 포함 안 함`, "c div-l")}</tr>`;
    const body = films.map((f) => {
      const tot = A.totalNoms(f, s);
      const wins = A.coreWins(s, f).length;
      return `<tr class="${f === bp ? "bp-winner" : ""}"><td class="film-cell">${colorOrder.includes(f) ? `<span class="swatch" style="background:${color(f)}" aria-hidden="true"></span>` : ""}${filmLink(f)}</td>
        <td class="c">${catChip(s, "oscar_bp", f)}</td><td class="r num">${tot ? tot.total_nominations : "–"}</td>
        ${CORE.map((b) => `<td class="c">${bodyChip(s, b, f)}</td>`).join("")}
        <td class="c">${coreWinsDots(wins, den)}</td><td class="c div-l">${bodyChip(s, "wga", f)}</td></tr>`;
    }).join("");

    const opt = SEASONS.map((x) => `<option value="${x}"${x === s ? " selected" : ""}>${x} · ${ordinalKo(seasonInfo(x).oscar_ordinal)} · ${esc(title(A.bpWinner(x)))}</option>`).join("");
    const prev = SEASONS[SEASONS.indexOf(s) - 1], next = SEASONS[SEASONS.indexOf(s) + 1];
    $app.innerHTML = `
      <div class="controls season-nav">
        <label>시즌 <select id="season-sel">${opt}</select></label>
        <span class="nav-btns">${prev ? `<a class="btn" href="#/season/${prev}">← ${prev}</a>` : ""}${next ? `<a class="btn" href="#/season/${next}">${next} →</a>` : ""}</span>
      </div>
      <header class="page-head"><h1>${s} 시즌<span class="h-sub">${ordinalKo(si.oscar_ordinal)} 아카데미 · ${si.film_year}년 영화</span></h1></header>
      <div class="grid cols-2">
        <section class="card">
          <div class="card-head"><h3>시즌 결과</h3>${FACT()}</div>
          <div class="hero-fact"><span class="k">작품상</span><span class="v">${filmLink(bp)}</span></div>
          <dl class="kv">
            <dt>작품상 후보</dt><dd>${si.bp_nominee_count}편</dd>
            <dt>오스카 후보 발표</dt><dd class="num">${fmtDate(si.oscar_nominations_date)}</dd>
            <dt>오스카 시상식</dt><dd class="num">${fmtDate(si.oscar_date)}</dd>
          </dl>
          <div class="table-wrap inset"><table class="data compact"><thead><tr>${th("날짜")}${th("시상식")}${th("수상작")}${th('<span class="sr">출처</span>')}</tr></thead><tbody>${factRows}</tbody></table></div>
          ${si.notes.length ? `<ul class="notes small">${si.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        </section>
        <section class="card derived-card">
          <div class="card-head"><h3>레이스 해석</h3>${DERIVED("분석 · 규칙 기반")}</div>
          <dl class="kv">
            <dt>작품상 수상작의 전초전 수상</dt><dd>${coreWinsDots(ss.bpWins, den)}</dd>
            <dt>최다 수상작 (수렴도)</dt><dd>${ss.topFilms.map(filmLink).join(" / ")} — <b>${ss.consensus}</b>/${den}개 기관</dd>
            <dt>오스카 직전 선두</dt><dd>${ss.finalLeaders.map(filmLink).join(" / ") || "–"}</dd>
            <dt>초반 선두 (첫 ${ss.earlyK}개)</dt><dd>${ss.earlyLeaders.map(filmLink).join(" / ") || "–"}</dd>
            <dt>핵심 기관 수상작 수</dt><dd>${ss.distinct}편 <span class="muted">(글로브 2부문 포함)</span></dd>
          </dl>
          <ul class="labels">${ss.labels.map((l) => `<li>${esc(l.text)}</li>`).join("")}</ul>
          <p class="layer-note">선두 = 그 시점까지 열린 핵심 6개 기관(PGA·DGA·SAG·BAFTA·골든글로브·Critics Choice) 수상 수가 가장 많은 영화(동률은 공동).
            오스카 이후 개최된 시상식과 WGA는 세지 않습니다. 확률이나 여론이 아니라 실제 수상 결과의 누적입니다.</p>
          <div class="controls tight"><label>초반 기준 <select id="k-sel">${[1, 2, 3, 4].map((k) => `<option${k === ss.earlyK ? " selected" : ""}>${k}</option>`).join("")}</select> 개 전초전</label></div>
        </section>
      </div>

      <div class="section-head"><h2>영화별 전초전 성적</h2>${FACT()}</div>
      <div class="controls"><label><input type="checkbox" id="all-chk"${all ? " checked" : ""}> 핵심 전초전 후보작 전부 보기</label>
        <span class="small muted">기본: 작품상 후보 + 핵심 전초전 수상작</span></div>
      <div class="table-wrap"><table class="data sticky-1"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      ${legendStatus()}

      <div class="section-head"><h2>시즌 타임라인</h2>${FACT("사실 · 누적")}</div>
      <p class="note">전초전 수상이 날짜순으로 쌓이는 과정. 선은 핵심 6개 기관 수상이 1개 이상인 영화만 그립니다. 세로선을 가리키거나 눌러 보거나, 아래 표를 보세요.</p>
      <div class="card chart" id="tl-chart"></div>
      <div class="table-wrap spaced">${timelineTable(s, tl)}</div>`;
    document.getElementById("season-sel").addEventListener("change", (e) => { location.hash = `#/season/${e.target.value}`; });
    document.getElementById("all-chk").addEventListener("change", (e) => { if (e.target.checked) q.set("all", "1"); else q.delete("all"); setQuery(q); viewSeason(args, q); afterRender(); });
    document.getElementById("k-sel").addEventListener("change", (e) => { q.set("k", e.target.value); setQuery(q); viewSeason(args, q); afterRender(); });
    const el = document.getElementById("tl-chart");
    redrawTimeline = () => { if (document.body.contains(el)) drawTimeline(el, s, tl, colorOrder, color, bp); };
    redrawTimeline();
  }

  function timelineTable(s, tl) {
    const rows = tl.map((ev) => {
      if (ev.type === "oscar_noms") {
        const bpN = A.noms(s, "oscar_bp");
        const withTot = bpN.map((n) => ({ f: n.film_id, t: (A.totalNoms(n.film_id, s) || {}).total_nominations || 0 })).sort((a, b) => b.t - a.t);
        const top = withTot.filter((x) => x.t === withTot[0].t);
        return `<tr class="oscar-row"><td class="num">${fmtDate(ev.date)}</td><td><b>오스카 후보 발표</b></td><td class="wrap">작품상 후보 ${bpN.length}편 · 최다 후보: ${top.map((x) => `${filmLink(x.f)} (${x.t})`).join(", ")}</td><td class="muted">—</td></tr>`;
      }
      if (ev.type === "oscar") {
        return `<tr class="bp-winner oscar-row"><td class="num">${fmtDate(ev.date)}</td><td><b>오스카 시상식</b></td><td class="wrap">작품상: <b>${filmLink(ev.winners[0].films[0])}</b></td><td class="muted">—</td></tr>`;
      }
      const w = ev.winners.map((x) => `${ev.winners.length > 1 ? `<span class="tag">${GG_TAG[x.cat]}</span> ` : ""}${x.films.map(filmLink).join(" / ")}`).join("<br>");
      const lead = ev.counted ? `${ev.leaders.map(filmLink).join(" / ")} <span class="muted">(${ev.leadCount})</span>` : `<span class="muted">${ev.body === "wga" ? "각본 지표 — 집계 제외" : "오스카 이후 — 집계 제외"}</span>`;
      return `<tr><td class="num">${fmtDate(ev.date)}</td><td>${esc(BODY[ev.body])}${ev.ceremony.after_oscars ? ' <span class="warn-text" title="오스카 이후 개최">†</span>' : ""}</td><td class="wrap">${w}</td><td class="wrap">${lead}</td></tr>`;
    }).join("");
    return `<table class="data sticky-1"><thead><tr>${th("날짜")}${th("이벤트")}${th("수상작 / 내용")}${th("이 시점 선두 (누적 수상 수)", "그 날짜까지 열린 핵심 전초전의 누적 수상 수가 가장 많은 영화. 동률은 공동.")}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function drawTimeline(el, s, tl, films, color, bp) {
    // the viewBox follows the container width, so text renders at its real size on phones too
    const W = Math.max(320, Math.min(960, Math.round(el.clientWidth - 32)));
    const narrow = W < 620;
    const H = narrow ? 300 : 310;
    const m = narrow ? { l: 26, r: 46, t: 24, b: 74 } : { l: 34, r: 210, t: 26, b: 64 };
    const t0 = new Date(tl[0].date).getTime(), t1 = new Date(tl[tl.length - 1].date).getTime();
    const pad = Math.max((t1 - t0) * 0.03, 86400000 * 2);
    const x = (iso) => m.l + ((new Date(iso).getTime() - (t0 - pad)) / (t1 - t0 + 2 * pad)) * (W - m.l - m.r);
    const counted = tl.filter((e) => e.counted);
    const maxY = Math.max(1, ...counted.map((e) => e.leadCount));
    const y = (v) => H - m.b - (v / maxY) * (H - m.t - m.b);
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${s} 시즌 누적 전초전 수상 수 타임라인 — 같은 내용이 아래 표에 있습니다">`;
    for (let v = 0; v <= maxY; v++) svg += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    svg += `<text x="${m.l - 8}" y="${m.t - 12}" text-anchor="start">누적 수상 수</text>`;
    // event verticals + labels (three alternating rows; on narrow screens rotated, and events
    // that land within a few pixels of each other share one label so the text never overlaps)
    const evLabel = (ev) => (ev.type === "oscar" ? "오스카" : ev.type === "oscar_noms" ? "오스카 후보" : ev.body === "cc" ? "CC" : ev.body === "gg" ? "GG" : BODY[ev.body]) + (ev.type === "ceremony" && !ev.counted ? "*" : "");
    const groups = [];
    tl.forEach((ev, i) => {
      const xx = x(ev.date);
      svg += `<line class="${ev.type !== "ceremony" ? "oscar-line" : "event-line"}" x1="${xx}" x2="${xx}" y1="${m.t}" y2="${H - m.b}"/>`;
      const g = groups[groups.length - 1];
      if (narrow && g && xx - g.x < 14) g.labels.push(evLabel(ev));
      else groups.push({ x: xx, i, labels: [evLabel(ev)], oscar: ev.type !== "ceremony" });
    });
    groups.forEach((g, gi) => {
      const label = esc(g.labels.join("·"));
      if (narrow) {
        const yy = H - m.b + 12;
        svg += `<text x="${g.x}" y="${yy}" text-anchor="end" transform="rotate(-45 ${g.x} ${yy})" class="${g.oscar ? "lbl2" : ""}">${label}</text>`;
      } else {
        svg += `<text x="${g.x}" y="${H - m.b + 15 + (gi % 3) * 12}" text-anchor="middle" class="${g.oscar ? "lbl2" : ""}">${label}</text>`;
        const ev = tl[g.i];
        if (g.i === 0 || ev.type === "oscar") svg += `<text x="${g.x}" y="${H - m.b + 52}" text-anchor="middle">${md(ev.date)}</text>`;
      }
    });
    // step lines
    const endX = x(seasonInfo(s).oscar_date);
    const ends = [];
    films.forEach((f) => {
      let v = 0;
      const pts = [[m.l, y(0)]];
      const marks = [];
      for (const ev of counted) {
        const nv = ev.tally.get(f) || 0;
        if (nv !== v) { const xx = x(ev.date); pts.push([xx, y(v)], [xx, y(nv)]); marks.push([xx, y(nv)]); v = nv; }
      }
      pts.push([endX, y(v)]);
      svg += `<polyline fill="none" stroke="${color(f)}" stroke-width="2" stroke-linejoin="round" points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}"/>`;
      for (const [mx, my] of marks) svg += `<circle cx="${mx}" cy="${my}" r="4.5" fill="${color(f)}" stroke="var(--surface)" stroke-width="2"/>`;
      ends.push({ f, v, y: y(v) });
    });
    // direct labels at the right end, nudged apart (names only where there is room)
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
    for (const e of ends) {
      const t = title(e.f);
      const name = narrow ? "" : ` ${esc(t.length > 24 ? t.slice(0, 23) + "…" : t)}`;
      svg += `<text class="lbl" x="${endX + 6}" y="${e.y + 4}"><tspan fill="${color(e.f)}">■</tspan>${name} ${e.v}${e.f === bp ? " ★" : ""}</text>`;
    }
    // hover / tap columns
    tl.forEach((ev, i) => {
      const xx = x(ev.date);
      const prevX = i ? x(tl[i - 1].date) : m.l, nextX = i < tl.length - 1 ? x(tl[i + 1].date) : W - m.r;
      const a = Math.max(m.l, (prevX + xx) / 2), b = Math.min(W - m.r + 10, (xx + nextX) / 2);
      svg += `<rect class="hit" data-i="${i}" x="${a}" y="${m.t}" width="${Math.max(6, b - a)}" height="${H - m.t - m.b}"/>`;
    });
    svg += `</svg>`;
    const legend = films.length >= 1 ? `<div class="legend chart-legend">${films.map((f) => `<span><span class="swatch" style="background:${color(f)}"></span>${esc(title(f))}${f === bp ? " ★ 작품상" : ""}</span>`).join("")}<span class="muted">* 집계 제외(WGA·오스카 이후 개최)</span></div>` : "";
    el.innerHTML = legend + `<div class="chart-body">${svg}</div><div class="tooltip" hidden></div>`;
    const tip = el.querySelector(".tooltip");
    el.querySelectorAll(".hit").forEach((r) => {
      const show = () => {
        const ev = tl[+r.dataset.i];
        let h = `<b>${fmtDate(ev.date)} · ${ev.type === "oscar" ? "오스카 시상식" : ev.type === "oscar_noms" ? "오스카 후보 발표" : esc(BODY[ev.body])}</b><br>`;
        if (ev.winners) h += ev.winners.map((w) => w.films.map(title).map(esc).join(" / ")).join(" · ") + "<br>";
        if (ev.type === "ceremony" && !ev.counted) h += `<span class="muted">집계 제외</span><br>`;
        const tally = [...ev.tally.entries()].sort((a, b) => b[1] - a[1]);
        if (tally.length) h += `<span class="muted">누적:</span> ` + tally.map(([f, v]) => `${esc(title(f))} ${v}`).join(", ");
        tip.innerHTML = h;
        tip.hidden = false;
        const box = el.getBoundingClientRect(), rb = r.getBoundingClientRect();
        const tw = Math.min(280, box.width - 16);
        let left = rb.left - box.left + rb.width / 2 + 12;
        if (left + tw > box.width) left = Math.max(8, rb.left - box.left - tw - 10);
        tip.style.left = left + "px";
        tip.style.top = "44px";
        el.querySelectorAll(".hit").forEach((o) => o.classList.toggle("on", o === r));
      };
      r.addEventListener("mouseenter", show);
      r.addEventListener("click", show);
    });
    el.addEventListener("mouseleave", () => { tip.hidden = true; el.querySelectorAll(".hit.on").forEach((o) => o.classList.remove("on")); });
  }

  // ---------------------------------------------------------------- EXPLORE
  const AWARDS = [
    ["pga", "PGA", "pga", null], ["dga", "DGA", "dga", null], ["sag", "SAG 앙상블", "sag", null], ["bafta", "BAFTA", "bafta", null],
    ["gg", "골든글로브 (두 부문 중 하나)", "gg", null], ["gg_drama", "골든글로브 드라마", "gg", ["gg_drama"]], ["gg_musical_comedy", "골든글로브 뮤지컬·코미디", "gg", ["gg_musical_comedy"]],
    ["cc", "Critics Choice", "cc", null], ["wga", "WGA (두 각본상 중 하나) — 각본 지표", "wga", null],
    ["wga_original", "WGA 오리지널 각본", "wga", ["wga_original"]], ["wga_adapted", "WGA 각색", "wga", ["wga_adapted"]],
  ];
  const awardBy = Object.fromEntries(AWARDS.map((a) => [a[0], a]));
  const WANTS = [["", "상관없음"], ["won", "수상"], ["notwon", "수상 못함"], ["nominated_lost", "후보였으나 패배"], ["not_nominated", "후보 아님"], ["nominated_any", "후보(수상 포함)"]];

  function viewExplore(args, q) {
    const mode = q.get("mode") === "without" ? "without" : "won_lost";
    const award = awardBy[q.get("award")] ? q.get("award") : "pga";
    $app.innerHTML = `
      <header class="page-head"><h1>탐색</h1>
      <p class="lede">특정 전초전의 결과와 작품상 결과가 어긋난 경우를 찾습니다. 모든 결과는 실제 수상 기록의 조합이며, 칸을 누르면 출처가 열립니다.</p></header>
      <section class="card">
        <div class="controls">
          <span class="seg" role="group" aria-label="모드">
            <button type="button" data-mode="won_lost" aria-pressed="${mode === "won_lost"}">이 상을 받고도 작품상을 놓친 영화</button>
            <button type="button" data-mode="without" aria-pressed="${mode === "without"}">이 상 없이 작품상을 받은 영화</button>
          </span>
        </div>
        <div class="controls">
          <label>상 <select data-k="award">${AWARDS.map((a) => `<option value="${a[0]}"${a[0] === award ? " selected" : ""}>${esc(a[1])}</option>`).join("")}</select></label>
          ${seasonRangeControls(q)}
        </div>
        <div id="ex-out"></div>
      </section>
      <div class="section-head"><h2>조건 조합 필터</h2>${FACT()}</div>
      <p class="note">여러 전초전 조건을 동시에 걸어 작품상 후보(또는 레이스 전체 영화)를 거릅니다. 예: PGA 수상 + DGA 수상 못함 + 작품상 실패. 시즌 범위는 위 설정을 따릅니다.</p>
      <section class="card" id="adv"></section>`;
    const card = $app.querySelector(".card");
    const refresh = () => {
      const m = q.get("mode") === "without" ? "without" : "won_lost";
      const aw = awardBy[q.get("award")] || awardBy.pga;
      const [from, to] = range(q);
      document.getElementById("ex-out").innerHTML = m === "won_lost" ? exploreWonLost(aw, from, to) : exploreWithout(aw, from, to);
      renderAdvanced(q);
    };
    card.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
      q.set("mode", b.dataset.mode); setQuery(q);
      card.querySelectorAll("[data-mode]").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      refresh(); afterRender();
    }));
    bindControls(card, q, refresh);
    refresh();
  }

  function exploreWonLost(aw, from, to) {
    const [, label, body, cats] = aw;
    const useCats = cats || A.BODY_CATS[body];
    const rows = A.wonButLost(body, { cats, from, to });
    const ag = A.agreement(body, { cats, from, to });
    const missSeasons = ag.n - ag.match;
    // rows from seasons where another winner of the same award (co-winner / other category) did win Best Picture
    const otherWon = (r) => useCats.flatMap((c) => A.winners(r.season, c)).includes(r.bp);
    const nOther = rows.filter(otherWon).length;
    const tr = rows.map((r) => {
      let note = "";
      if (otherWon(r)) {
        const oc = useCats.find((c) => A.winners(r.season, c).includes(r.bp));
        note = `<div class="row-note">↳ ${oc === r.cat ? "공동 수상작" : CAT_SHORT[oc] + " 수상작"}이 작품상(일치로 집계)</div>`;
      }
      return `<tr><td>${seasonLink(r.season)}</td><td class="film-cell">${filmLink(r.film)}${note}</td>
        <td>${catChip(r.season, r.cat, r.film)} <span class="small muted">${esc(CAT_SHORT[r.cat])}</span>${r.afterOscars ? ' <span class="warn-text small">† 오스카 이후</span>' : ""}</td>
        <td class="c">${catChip(r.season, "oscar_bp", r.film)}</td><td class="film-cell">${filmLink(r.bp)}</td><td>${coreWinsDots(r.coreWins, A.coreCounted(r.season))}</td></tr>`;
    }).join("");
    return `<p class="result-line"><b>${esc(label)}</b> 수상작이 작품상을 받지 못한 경우 ${count(`${rows.length}건`)}
      · 이 상의 수상작이 <b>모두</b> 작품상을 놓친 시즌 ${count(`${missSeasons}/${ag.n}`, "일치율 페이지의 불일치 시즌 수와 같은 기준")}</p>
      ${nOther ? `<p class="note">${nOther}건은 같은 해 이 상의 다른 수상작(${useCats.length > 1 ? "다른 부문" : "공동 수상"})이 작품상을 받은 경우라, 일치율 계산에서는 그 시즌을 ‘일치’로 셉니다.</p>` : ""}
      <div class="table-wrap"><table class="data sticky-2"><thead><tr>${th("시즌")}${th("영화")}${th("받은 상")}${th("작품상", "이 영화의 작품상 결과: 후보 = 후보였으나 패배, – = 작품상 후보에도 오르지 못함", "c")}${th("그해 작품상 수상작")}${th("핵심 전초전 수상", "그 영화의 핵심 전초전 수상 수 / 오스카 전에 열린 핵심 전초전 수")}</tr></thead>
      <tbody>${tr || `<tr><td colspan="6" class="muted">해당 없음</td></tr>`}</tbody></table></div>
      <p class="note small">작품상 칸: “후보” = 작품상 후보였으나 패배, “–” = 작품상 후보에도 오르지 못함.</p>`;
  }

  function exploreWithout(aw, from, to) {
    const [, label, body, cats] = aw;
    const rows = A.bpWithout(body, { cats, from, to });
    const nSeasons = SEASONS.filter((s) => s >= from && s <= to).length;
    const cnt = (c) => rows.filter((r) => r.status === c).length;
    const tr = rows.map((r) => {
      const chips = (cats || A.BODY_CATS[body]).map((c) => catChip(r.season, c, r.film)).join(" ");
      return `<tr><td>${seasonLink(r.season)}</td><td class="film-cell">${filmLink(r.film)}</td><td>${chips}${r.afterOscars ? ' <span class="warn-text small">† 오스카 이후</span>' : ""}</td>
        <td class="wrap">${r.bodyWinners.map(filmLink).join(" / ")}</td><td>${coreWinsDots(r.coreWins, A.coreCounted(r.season))}</td></tr>`;
    }).join("");
    return `<p class="result-line"><b>${esc(label)}</b>을(를) 받지 않고 작품상을 받은 영화 ${count(`${rows.length}/${nSeasons} 시즌`, "선택한 범위의 시즌 수가 분모")}
      <span class="muted">— 후보였으나 패배 ${cnt("N")} · 후보 아님 ${cnt("-")}${cnt("I") ? ` · 자격 없음 ${cnt("I")}` : ""}</span></p>
      ${(cats || A.BODY_CATS[body]).length > 1 ? `<p class="note">‘두 부문 중 하나’ 기준: 작품상 수상작이 두 부문 어디에서도 수상하지 못한 시즌만 셉니다.</p>` : ""}
      ${body === "wga" ? '<p class="note warn-text">WGA “후보 아님”에는 조합 관할 밖이라 자격이 없던 경우가 섞여 있을 수 있습니다(개별 자격 미확인).</p>' : ""}
      <div class="table-wrap"><table class="data sticky-2"><thead><tr>${th("시즌")}${th("작품상 수상작")}${th("이 상에서의 결과")}${th("이 상의 수상작")}${th("핵심 전초전 수상", "작품상 수상작의 핵심 전초전 수상 수 / 오스카 전에 열린 핵심 전초전 수")}</tr></thead>
      <tbody>${tr || `<tr><td colspan="5" class="muted">해당 없음 — 이 기간 작품상 수상작은 모두 이 상을 받았습니다.</td></tr>`}</tbody></table></div>`;
  }

  function renderAdvanced(q) {
    const el = document.getElementById("adv");
    const bodies = [["pga", null], ["dga", null], ["sag", null], ["bafta", null], ["gg", null], ["gg_drama", ["gg_drama"]], ["gg_musical_comedy", ["gg_musical_comedy"]], ["cc", null], ["wga", null]];
    if (!el.dataset.ready) {
      const sel = (k) => `<select data-f="${k}">${WANTS.map(([v, l]) => `<option value="${v}"${(q.get("f_" + k) || "") === v ? " selected" : ""}>${l}</option>`).join("")}</select>`;
      el.innerHTML = `<div class="filter-grid">${bodies.map(([k]) => `<label><span>${esc((awardBy[k] || [0, BODY[k]])[1].replace(" (두 부문 중 하나)", "").replace(" (두 각본상 중 하나) — 각본 지표", ""))}</span> ${sel(k)}</label>`).join("")}</div>
        <div class="controls"><label>작품상 결과 <select data-f="bp">${[["any", "상관없음"], ["won", "수상"], ["lost", "수상 못함"]].map(([v, l]) => `<option value="${v}"${(q.get("f_bp") || "any") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>대상 <select data-f="scope">${[["bp_nominees", "작품상 후보만"], ["all", "레이스 전체 영화(핵심 전초전 후보 포함)"]].map(([v, l]) => `<option value="${v}"${(q.get("f_scope") || "bp_nominees") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <button type="button" id="adv-reset">초기화</button></div><div id="adv-out"></div>`;
      el.dataset.ready = "1";
      el.querySelectorAll("[data-f]").forEach((s) => s.addEventListener("change", () => {
        if (s.value && s.value !== "any" && !(s.dataset.f === "scope" && s.value === "bp_nominees")) q.set("f_" + s.dataset.f, s.value); else q.delete("f_" + s.dataset.f);
        setQuery(q); renderAdvanced(q); afterRender();
      }));
      el.querySelector("#adv-reset").addEventListener("click", () => {
        [...q.keys()].filter((k) => k.startsWith("f_")).forEach((k) => q.delete(k));
        setQuery(q); el.dataset.ready = ""; renderAdvanced(q); afterRender();
      });
    }
    const conds = bodies.filter(([k]) => q.get("f_" + k)).map(([k, cats]) => (cats ? { cat: cats[0], want: q.get("f_" + k) } : { body: k, want: q.get("f_" + k) }));
    const [from, to] = range(q);
    const res = A.query(conds, { scope: q.get("f_scope") === "all" ? "all" : "bp_nominees", bpResult: q.get("f_bp") || "any", from, to });
    const out = el.querySelector("#adv-out");
    if (!conds.length && (q.get("f_bp") || "any") === "any") { out.innerHTML = `<p class="muted small">조건을 하나 이상 고르세요. (시즌 범위: ${from}–${to})</p>`; return; }
    const shown = res.slice(0, 400);
    out.innerHTML = `<p class="result-line">${count(`${res.length}편`)} <span class="muted">시즌 ${from}–${to}${res.length > shown.length ? ` — 처음 ${shown.length}편 표시` : ""}</span></p>
      <div class="table-wrap"><table class="data sticky-2"><thead><tr>${th("시즌")}${th("영화")}${th("작품상", "", "c")}${CORE.map((b) => th(BODY[b], BODY_WHAT[b], "c")).join("")}${th("WGA", BODY_WHAT.wga, "c div-l")}${th("핵심 수상", "핵심 전초전 수상 수 / 오스카 전에 열린 핵심 전초전 수")}</tr></thead>
      <tbody>${shown.map((r) => `<tr class="${r.bpStatus === "W" ? "bp-winner" : ""}"><td>${seasonLink(r.season)}</td><td class="film-cell">${filmLink(r.film)}</td><td class="c">${catChip(r.season, "oscar_bp", r.film)}</td>
        ${CORE.map((b) => `<td class="c">${bodyChip(r.season, b, r.film)}</td>`).join("")}<td class="c div-l">${bodyChip(r.season, "wga", r.film)}</td><td>${coreWinsDots(r.coreWins, A.coreCounted(r.season))}</td></tr>`).join("")}</tbody></table></div>${legendStatus()}`;
  }

  // ---------------------------------------------------------------- AGREEMENT
  function viewAgreement(args, q) {
    $app.innerHTML = `<header class="page-head"><h1>각 시상식은 작품상과 얼마나 자주 일치했나</h1>
      <p class="lede">“일치” = 그 시상식의 수상작이 그해 오스카 작품상 수상작인 경우. 결론을 먼저 정하지 않고 시즌 범위를 바꿔 직접 확인할 수 있습니다.</p></header>
      <section class="card"><div class="controls">${seasonRangeControls(q)}<label><input type="checkbox" data-k="post"${q.get("post") ? " checked" : ""}> 오스카 이후 개최된 시상식 제외</label></div><div id="ag-out"></div></section>`;
    const refresh = () => {
      const [from, to] = range(q);
      const post = !!q.get("post");
      const opts = { from, to, excludeAfterOscars: post };
      const list = CORE.concat(["wga"]).map((b) => ({ b, g: A.agreement(b, opts), opts }));
      // rank core bodies by rate; ties share a place
      const core = list.filter((x) => x.b !== "wga").slice().sort((a, b) => b.g.rate - a.g.rate);
      const rates = [...new Set(core.map((x) => x.g.rate))];
      const group = (r) => core.filter((x) => x.g.rate === r).map((x) => `<b>${BODY[x.b]}</b>(${x.g.match}/${x.g.n})`).join(", ");
      const topGroup = core.filter((x) => x.g.rate === rates[0]);
      let sentence = topGroup.length > 1
        ? `이 범위(${from}–${to})에서 작품상과 가장 자주 일치한 핵심 전초전은 ${group(rates[0])}로 공동 1위입니다. `
        : `이 범위(${from}–${to})에서 작품상과 가장 자주 일치한 핵심 전초전은 ${group(rates[0])}이고, 다음은 ${group(rates[1])}입니다. `;
      const a0 = topGroup[0].g, b0 = (core.find((x) => x.g.rate === rates[topGroup.length > 1 ? 0 : 1]) || topGroup[0]).g;
      if (topGroup.length > 1) sentence += "순위를 가를 수 없습니다.";
      else if (a0.n === b0.n) sentence += a0.match - b0.match <= 1 ? "차이는 1시즌이라 표본이 작은 만큼 순위를 확정적으로 읽기는 어렵습니다." : `차이는 ${a0.match - b0.match}시즌입니다.`;
      else sentence += `분모가 달라(${a0.n} vs ${b0.n}) 시즌 수가 아닌 비율로 비교했습니다.`;
      const eras = [[2000, 2009], [2010, 2019], [2020, 2026]];
      const eraRows = CORE.concat(["wga"]).map((b) => `<tr><th scope="row">${BODY[b]}</th>${eras.map(([a, z]) => { const g = A.agreement(b, { from: a, to: z, excludeAfterOscars: post }); return `<td class="r num"><b>${g.match}</b>/${g.n} <span class="muted">${pct(g.match, g.n)}</span></td>`; }).join("")}</tr>`).join("");
      const mismatchChips = (g) => `<span class="chips">${g.rows.filter((r) => !r.match).map((r) => `<a href="#/season/${r.season}" title="${esc(r.winners.map(title).join(" / "))} 수상, 작품상 ${esc(title(r.bp))}">${r.season}</a>`).join("")}</span>`;
      const detail = list.map(({ b, g, opts: o }) => {
        let h = `<tr><th scope="row">${BODY[b]}</th><td class="r num"><b>${g.match}</b>/${g.n}</td><td class="r num">${pct(g.match, g.n)}</td>
          <td class="r num">${g.bpNominated}/${g.n}${g.bpIneligible ? ` <span class="muted">(자격X ${g.bpIneligible})</span>` : ""}</td><td class="wrap chips-cell">${mismatchChips(g)}</td>
          <td class="wrap dim">${esc(BODY_WHAT[b])}${BODY_DEN[b] ? `<div class="row-note">${esc(BODY_DEN[b])}</div>` : ""}</td></tr>`;
        if (A.BODY_CATS[b].length > 1) {
          for (const c of A.BODY_CATS[b]) {
            const gc = A.agreement(b, { ...o, cats: [c] });
            h += `<tr class="sub-row"><th scope="row">└ ${esc(CAT_SHORT[c])}</th><td class="r num"><b>${gc.match}</b>/${gc.n}</td><td class="r num">${pct(gc.match, gc.n)}</td>
              <td class="r num">${gc.bpNominated}/${gc.n}${gc.bpIneligible ? ` <span class="muted">(자격X ${gc.bpIneligible})</span>` : ""}</td><td class="muted small">위 행 참고</td>
              <td class="wrap dim">부문별 — 분모에 작품상 수상작이 이 부문 후보가 아니었던 해도 포함</td></tr>`;
          }
        }
        return h;
      }).join("");
      document.getElementById("ag-out").innerHTML = `<p class="result-line">${sentence}</p>${barsHTML(list)}
        <div class="section-head sub"><h3>상세</h3>${FACT("사실 · 집계")}</div>
        <div class="table-wrap"><table class="data sticky-1"><thead><tr>${th("기관")}${th("일치", "수상작 = 작품상 수상작인 시즌 / 비교한 시즌", "r")}${th("%", "", "r")}${th("작품상 수상작이<br>이 상 후보였던 시즌", "그해 작품상 수상작이 이 상(부문)의 후보였던 시즌 / 비교한 시즌. 후보도 아니었던 해에는 일치할 수 없었음.", "r")}${th("불일치 시즌")}${th("시상 대상 · 분모 메모")}</tr></thead><tbody>${detail}</tbody></table></div>
        <div class="section-head sub"><h3>시대별</h3>${FACT("사실 · 집계")}</div>
        <div class="table-wrap"><table class="data sticky-1"><thead><tr>${th("기관")}${th("2000–2009", "", "r")}${th("2010–2019", "", "r")}${th("2020–2026", "", "r")}</tr></thead><tbody>${eraRows}</tbody></table></div>
        <ul class="notes small"><li>PGA 2014는 공동 수상(12 Years a Slave / Gravity) — 공동 수상작 중 하나가 작품상이면 일치로 셉니다.</li>
        <li>오스카 이후 개최: BAFTA 2000, WGA 2024. 체크박스로 제외하면 그 기관의 분모만 1 줄어듭니다.</li>
        <li>작품상 후보 수가 시대마다 다릅니다(5편 → 10편 → 5~10편 → 10편). 무작위 선택 기준선이 시대마다 달라지므로 시대별 비교는 참고용입니다.</li>
        <li>27개 시즌의 작은 표본입니다. 1~2시즌 차이로 순위가 바뀔 수 있습니다.</li></ul>`;
    };
    bindControls($app.querySelector(".card"), q, refresh);
    refresh();
  }

  // ---------------------------------------------------------------- PATTERNS
  function viewPatterns(args, q) {
    const P = { k: +q.get("k") || 2, conv: +q.get("conv") || 5, split: +q.get("split") || 3, sweep: +q.get("sweep") || 4, weak: q.has("weak") ? +q.get("weak") : 1 };
    const num = (key, lab, vals) => `<label>${lab} <select data-k="${key}">${vals.map((v) => `<option${v === P[key] ? " selected" : ""}>${v}</option>`).join("")}</select></label>`;
    $app.innerHTML = `<header class="page-head"><h1>패턴</h1>
      <p class="lede">질문별로 실제 수상 기록을 조합한 결과입니다. “수렴·선두·약세” 같은 말은 아래 기준값으로 정의한 ${DERIVED("분석")} 라벨이며, 기준을 바꾸면 결과도 바뀝니다.</p></header>
      <section class="card derived-card"><div class="card-head"><h3>분석 기준값</h3>${DERIVED("규칙")}</div><div class="controls params">
        ${num("k", "초반 = 첫", [1, 2, 3, 4])}<span class="unit">개 전초전</span>
        ${num("conv", "수렴 = 한 영화가 ≥", [4, 5, 6])}<span class="unit">개 기관</span>
        ${num("split", "분산 = 최다 수상작 ≤", [2, 3])}<span class="unit">개 기관</span>
        ${num("sweep", "근접 석권 = ≥", [3, 4, 5])}<span class="unit">개 기관 수상</span>
        ${num("weak", "약세 수상 = ≤", [0, 1, 2])}<span class="unit">개 기관 수상</span>
      </div><p class="layer-note">핵심 6개 기관: PGA · DGA · SAG 앙상블 · BAFTA · 골든글로브(두 부문 중 하나) · Critics Choice. WGA와 오스카 이후 개최된 시상식(BAFTA 2000)은 세지 않으므로 2000 시즌의 분모는 5입니다.</p></section>
      <div id="pt-out"></div>`;
    const refresh = () => {
      const P2 = { k: +q.get("k") || 2, conv: +q.get("conv") || 5, split: +q.get("split") || 3, sweep: +q.get("sweep") || 4, weak: q.has("weak") ? +q.get("weak") : 1 };
      document.getElementById("pt-out").innerHTML = patternsHTML(P2);
    };
    bindControls($app.querySelector(".card"), q, refresh);
    refresh();
    const anchor = (location.hash.match(/#(q-[a-z]+)$/) || [])[1];
    if (anchor) setTimeout(() => { const t = document.getElementById(anchor); if (t) t.scrollIntoView(); }, 30);
  }

  function mismatchTable(body) {
    const rows = A.wonButLost(body);
    return `<div class="table-wrap"><table class="data sticky-2"><thead><tr>${th("시즌")}${th(`${BODY[body]} 수상`)}${th("그 영화의 작품상", "", "c")}${th("작품상 수상작")}${th(`작품상 수상작의 ${BODY[body]}`, "", "c")}</tr></thead><tbody>
      ${rows.map((r) => {
        const co = A.bodyWinners(r.season, body).includes(r.bp);
        return `<tr><td>${seasonLink(r.season)}</td><td class="film-cell">${filmLink(r.film)}${r.afterOscars ? ' <span class="warn-text small">† 오스카 이후</span>' : ""}${co ? `<div class="row-note">공동 수상 — 다른 공동 수상작이 작품상(일치율에선 ‘일치’)</div>` : ""}</td><td class="c">${catChip(r.season, "oscar_bp", r.film)}</td><td class="film-cell">${filmLink(r.bp)}</td><td class="c">${bodyChip(r.season, body, r.bp)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function missHeading(g, body) {
    const tieRows = A.wonButLost(body).filter((r) => A.bodyWinners(r.season, body).includes(r.bp)).length;
    return `${count(`${g.n - g.match}/${g.n} 시즌`, `수상작이 작품상을 받지 못한 시즌 / 전체 시즌`)}${tieRows ? `<span class="h-note">표에는 공동 수상 ${tieRows}건 포함</span>` : ""}`;
  }

  function patternsHTML(P) {
    const sums = SEASONS.map((s) => A.seasonSummary(s, { earlyK: P.k, convergedMin: P.conv, splitMax: P.split }));
    const pga = A.agreement("pga"), dga = A.agreement("dga"), bafta = A.agreement("bafta");
    const noSag = A.bpWithout("sag");
    const converged = sums.filter((x) => x.consensus >= P.conv), split = sums.filter((x) => x.consensus <= P.split);
    const early = sums.filter((x) => x.earlyLeaders.length && !x.earlyLeaders.includes(x.bp));
    const sweepLosers = [];
    for (const s of SEASONS) for (const f of A.seasonFilms(s)) { const w = A.coreWins(s, f).length; if (w >= P.sweep && f !== A.bpWinner(s)) sweepLosers.push({ s, f, w }); }
    const weak = sums.filter((x) => x.bpWins <= P.weak);
    const strip = sums.slice().sort((a, b) => b.consensus - a.consensus || a.season - b.season);
    const agg = CORE.map((b) => ({ b, g: A.agreement(b) })).sort((a, b) => b.g.match - a.g.match);
    const wd = (n, s) => coreWinsDots(n, A.coreCounted(s));

    return `
      <div class="section-head"><h2 id="q-pga">PGA 수상작이 작품상을 놓친 해</h2>${missHeading(pga, "pga")}${FACT()}</div>
      ${mismatchTable("pga")}
      <div class="section-head"><h2 id="q-dga">DGA와 작품상 결과가 갈린 해</h2>${missHeading(dga, "dga")}${FACT()}</div>
      <p class="note">DGA는 감독 개인상입니다. 여기서는 DGA 수상 감독의 영화와 작품상 수상작을 비교합니다.</p>
      ${mismatchTable("dga")}
      <div class="section-head"><h2 id="q-bafta">BAFTA가 오스카와 다른 방향을 가리킨 시즌</h2>${missHeading(bafta, "bafta")}${FACT()}</div>
      <p class="note">BAFTA 자격은 영국 개봉일 기준입니다. 2000 시즌 BAFTA는 오스카 이후에 열렸지만 결과가 같아 이 표에는 없습니다.</p>
      ${mismatchTable("bafta")}
      <div class="section-head"><h2 id="q-sag">SAG 앙상블을 못 받고도 작품상을 받은 영화</h2>${count(`${noSag.length}/${SEASONS.length} 시즌`)}${FACT()}</div>
      <div class="table-wrap"><table class="data sticky-2"><thead><tr>${th("시즌")}${th("작품상 수상작")}${th("SAG 앙상블", "후보 = 앙상블 후보였으나 패배, – = 앙상블 후보에도 오르지 못함", "c")}${th("SAG 앙상블 수상작")}${th("핵심 전초전 수상", "작품상 수상작의 핵심 전초전 수상 수 / 오스카 전에 열린 핵심 전초전 수")}</tr></thead><tbody>
        ${noSag.map((r) => `<tr><td>${seasonLink(r.season)}</td><td class="film-cell">${filmLink(r.film)}</td><td class="c">${catChip(r.season, "sag_ensemble", r.film)}</td><td class="film-cell">${r.bodyWinners.map(filmLink).join(" / ")}</td><td>${wd(r.coreWins, r.season)}</td></tr>`).join("")}</tbody></table></div>
      <p class="note small">후보 = 앙상블 후보였으나 패배, – = 앙상블 후보에도 오르지 못함.</p>

      <div class="section-head"><h2 id="q-converge">전초전이 한 작품으로 수렴한 해 vs 끝까지 갈린 해</h2>${DERIVED()}</div>
      <p class="note">수렴도 = 한 영화가 받은 핵심 기관 수의 최댓값(분모 = 오스카 전에 열린 핵심 기관 수). ${DERIVED(`수렴 ≥ ${P.conv}`)} ${count(`${converged.length}시즌`)} · ${DERIVED(`분산 ≤ ${P.split}`)} ${count(`${split.length}시즌`)}</p>
      <div class="table-wrap"><table class="data sticky-2"><thead><tr>${th("시즌")}${th("수렴도", "최다 수상작의 핵심 기관 수 / 오스카 전에 열린 핵심 기관 수")}${th("최다 수상작")}${th("핵심 기관 수상작 수", "핵심 6개 기관의 수상작이 모두 몇 편인지(글로브는 2부문 각각)", "r")}${th("작품상 수상작 (전초전 수상)")}${th("라벨")}</tr></thead><tbody>
        ${strip.map((x) => `<tr><td>${seasonLink(x.season)}</td><td>${coreWinsDots(x.consensus, x.counted)}</td><td class="film-cell">${x.topFilms.map(filmLink).join(" / ")}</td><td class="r num">${x.distinct}편</td><td class="film-cell">${filmLink(x.bp)} <span class="muted">(${x.bpWins})</span></td>
          <td>${x.consensus >= P.conv ? DERIVED("수렴") : x.consensus <= P.split ? DERIVED("분산") : ""}</td></tr>`).join("")}</tbody></table></div>

      <div class="section-head"><h2 id="q-early">시즌 초반의 선두와 최종 작품상 수상작이 달랐던 사례</h2>${count(`${early.length}시즌`)}${DERIVED()}</div>
      <p class="note">초반 선두 = 시즌 첫 ${P.k}개 핵심 전초전(날짜순) 이후 누적 수상 수 최다 영화(동률은 공동). 공동 선두에 작품상 수상작이 들어 있으면 “달랐다”로 보지 않습니다.</p>
      <div class="table-wrap"><table class="data sticky-2"><thead><tr>${th("시즌")}${th(`첫 ${P.k}개 전초전`)}${th("초반 선두")}${th("오스카 직전 선두")}${th("작품상 수상작 (전초전 수상)")}</tr></thead><tbody>
        ${early.map((x) => `<tr><td>${seasonLink(x.season)}</td><td class="small">${x.leaderPath.slice(0, P.k).map((e) => `${BODY[e.body]} ${md(e.date)}`).join(" → ")}</td><td class="film-cell">${x.earlyLeaders.map(filmLink).join(" / ")}</td><td class="film-cell">${x.finalLeaders.map(filmLink).join(" / ")}</td><td class="film-cell">${filmLink(x.bp)} <span class="muted">(${x.bpWins})</span></td></tr>`).join("") || `<tr><td colspan="5" class="muted">해당 없음</td></tr>`}</tbody></table></div>

      <div class="section-head"><h2 id="q-sweep">주요 전초전을 거의 휩쓸고도 작품상을 잃은 영화</h2>${count(`≥ ${P.sweep}개 기관 · ${sweepLosers.length}편`)}${DERIVED()}</div>
      <div class="table-wrap"><table class="data sticky-2"><thead><tr>${th("시즌")}${th("영화")}${th("핵심 전초전 수상", "수상 수 / 오스카 전에 열린 핵심 전초전 수")}${th("작품상", "", "c")}${th("작품상 수상작 (전초전 수상)")}</tr></thead><tbody>
        ${sweepLosers.map((r) => `<tr><td>${seasonLink(r.s)}</td><td class="film-cell">${filmLink(r.f)}</td><td>${wd(r.w, r.s)} <span class="small muted">${A.coreWins(r.s, r.f).map((b) => BODY[b]).join(", ")}</span></td><td class="c">${catChip(r.s, "oscar_bp", r.f)}</td><td class="film-cell">${filmLink(A.bpWinner(r.s))} <span class="muted">(${A.coreWins(r.s, A.bpWinner(r.s)).length})</span></td></tr>`).join("") || `<tr><td colspan="5" class="muted">해당 없음</td></tr>`}</tbody></table></div>

      <div class="section-head"><h2 id="q-weak">전초전 성적이 상대적으로 약했는데 작품상을 받은 영화</h2>${count(`≤ ${P.weak}개 기관 · ${weak.length}편`)}${DERIVED()}</div>
      <div class="table-wrap"><table class="data sticky-2"><thead><tr>${th("시즌")}${th("작품상 수상작")}${th("받은 핵심 전초전", "수상 수 / 오스카 전에 열린 핵심 전초전 수")}${th("그해 최다 수상작")}</tr></thead><tbody>
        ${weak.map((x) => `<tr><td>${seasonLink(x.season)}</td><td class="film-cell">${filmLink(x.bp)}</td><td>${coreWinsDots(x.bpWins, x.counted)} <span class="small muted">${A.coreWins(x.season, x.bp).map((b) => BODY[b]).join(", ") || "없음"}</span></td><td class="film-cell">${x.topFilms.map(filmLink).join(" / ")} <span class="muted">(${x.consensus})</span></td></tr>`).join("") || `<tr><td colspan="4" class="muted">해당 없음</td></tr>`}</tbody></table></div>

      <div class="section-head"><h2 id="q-agree">각 시상식의 역사적 일치율 (2000–2026)</h2>${FACT("사실 · 집계")}</div>
      <div class="table-wrap"><table class="data"><thead><tr>${th("순위")}${th("기관")}${th("일치", "수상작 = 작품상 수상작인 시즌 / 전체 시즌", "r")}${th("%", "", "r")}</tr></thead><tbody>
        ${agg.map((x) => `<tr><td>${agg.findIndex((y) => y.g.match === x.g.match) + 1}</td><td>${BODY[x.b]} <span class="small muted">${esc(BODY_WHAT[x.b])}</span></td><td class="r num"><b>${x.g.match}</b>/${x.g.n}</td><td class="r num">${pct(x.g.match, x.g.n)}</td></tr>`).join("")}</tbody></table></div>
      <p class="note"><a href="#/agreement">기간·조건을 바꿔 보기 →</a> · 골든글로브는 두 부문 중 하나 기준이라 구조적으로 유리합니다(부문별 수치는 일치율 페이지).</p>`;
  }

  // ---------------------------------------------------------------- FILM
  function viewFilm(args) {
    const fid = args[0];
    const f = film(fid);
    if (!f) { $app.innerHTML = `<h1>영화를 찾을 수 없음</h1><p><a href="#/">개요로</a></p>`; return; }
    const path = A.filmPath(fid);
    const bySeason = {};
    for (const r of path) (bySeason[r.season] = bySeason[r.season] || []).push(r);
    let h = `<header class="page-head"><h1>${esc(f.title)}<span class="h-sub">${f.seasons.map((s) => `${s} 시즌 · ${s - 1}년 영화`).join(" / ")}</span></h1>
      <p class="links"><a href="${esc(f.wiki_url)}" target="_blank" rel="noopener">Wikipedia</a> · <a href="${esc(f.wikidata_url)}" target="_blank" rel="noopener">Wikidata ${esc(f.id)}</a>
      ${f.aliases.length ? `<br><span class="small">원자료 표기: ${f.aliases.map((a) => `“${esc(a.title)}” <span class="muted">(${a.seen_in.map((c) => CAT_SHORT[c] || c).join(", ")})</span>`).join(" · ")}</span>` : ""}</p></header>`;
    for (const s of Object.keys(bySeason).map(Number).sort()) {
      const rs = bySeason[s];
      const bpSt = A.catStatus(s, "oscar_bp", fid);
      const tot = A.totalNoms(fid, s);
      const wins = A.coreWins(s, fid);
      const elig = D.eligibility.filter((e) => e.film_id === fid && e.season === s);
      h += `<div class="section-head"><h2>${seasonLink(s)} 시즌 경로</h2><span class="h-note">${ordinalKo(seasonInfo(s).oscar_ordinal)} 아카데미</span>${FACT()}</div>
        <dl class="kv"><dt>오스카 작품상</dt><dd><span class="st ${bpSt.code === "-" ? "D" : bpSt.code}">${STATUS_TEXT[bpSt.code]}</span> ${esc(STATUS_LONG[bpSt.code])}${tot ? ` <span class="muted">· 오스카 전체 후보 ${tot.total_nominations}개 부문</span>` : ""}</dd>
        <dt>핵심 전초전 수상</dt><dd>${coreWinsDots(wins.length, A.coreCounted(s))} <span class="muted">${wins.map((b) => BODY[b]).join(", ")}</span></dd></dl>
        ${elig.map((e) => `<p class="note small"><span class="st I">자격X</span> ${e.categories.map((c) => CAT_SHORT[c]).join(", ")} — ${esc(e.evidence)}</p>`).join("")}
        <ol class="path">`;
      const si = seasonInfo(s);
      const steps = rs.map((r) => ({ date: r.ceremony.date, html: `<li><button type="button" class="step" data-rec="${s}|${r.category}|${fid}">
          <span class="d">${fmtDate(r.ceremony.date)}${r.ceremony.after_oscars ? ' <span class="warn-text">†</span>' : ""}</span><span class="c">${esc(CAT[r.category])}</span><span class="st ${r.result === "won" ? "W" : "N"}${r.tie ? " tie" : ""}">${r.result === "won" ? "수상" : "후보"}</span></button></li>` }));
      steps.push({ date: si.oscar_nominations_date, html: `<li><div class="step event"><span class="d">${fmtDate(si.oscar_nominations_date)}</span><span class="c">오스카 후보 발표</span><span class="small muted">${bpSt.code === "-" ? "작품상 후보 아님" : "작품상 후보"}</span></div></li>` });
      steps.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      h += steps.map((x) => x.html).join("");
      h += `</ol><p class="note small">각 단계를 누르면 원자료 표기와 출처가 열립니다. 후보에 오르지 못한 핵심 전초전은 <a href="#/season/${s}">시즌 성적표</a>에서 “–”로 표시됩니다.</p>`;
    }
    $app.innerHTML = h;
  }

  // ---------------------------------------------------------------- DATA & SOURCES
  function viewData() {
    const byVer = {};
    for (const n of D.nominations) { const k = n.verification.ceremony_page; byVer[k] = (byVer[k] || 0) + 1; }
    const catRows = D.categories.map((c) => {
      const ns = D.nominations.filter((n) => n.category === c.id);
      const m = ns.filter((n) => n.verification.ceremony_page === "match").length;
      const src = A.idx.source.get(c.source_id);
      return `<tr><th scope="row">${esc(CAT[c.id])}</th><td class="r num">${ns.length}</td><td class="r num"><b>${m}</b>/${ns.length}</td><td class="wrap small src-cell"><a href="${esc(src.permalink)}" target="_blank" rel="noopener">${esc(src.title)}</a> <span class="muted">· rev ${src.revid}</span></td></tr>`;
    }).join("");
    const officialRefs = new Set();
    for (const n of D.nominations) for (const r of n.cited_refs) if (r.official) officialRefs.add(r.url);
    const SEV = { caveat: "해석 주의", info: "정보", warning: "경고" };
    const ceremonySources = D.ceremonies.slice().sort((a, b) => a.season - b.season || (a.date < b.date ? -1 : 1));
    const bySeason = {};
    for (const c of ceremonySources) (bySeason[c.season] = bySeason[c.season] || []).push(c);
    const verOrder = ["match", "manual_ok", "not_found", "winner_mismatch", "nominee_mismatch", "not_checked"].filter((k) => byVer[k]);
    $app.innerHTML = `<header class="page-head"><h1>데이터 · 출처</h1>
      <p class="lede">모든 값은 어디서 왔는지 추적할 수 있습니다. 확인되지 않은 값은 채우지 않았고, 해석은 사실과 분리했습니다.</p></header>
      <div class="section-head"><h2>구조</h2></div>
      <div class="grid cols-2">
        <section class="card"><div class="card-head"><h3>사실 레이어</h3>${FACT()}</div>
          <ul class="notes small"><li>시즌 27개, 시상식 ${D.ceremonies.length}회, 영화 ${D.films.length}편, 후보·수상 기록 ${D.nominations.length}건</li>
          <li>결과는 <code>won</code> / <code>nominated</code> 두 값만 저장. “후보 아님”은 해당 부문 후보 목록 전체가 있을 때만 화면에서 도출</li>
          <li>영화 식별: 위키백과 문서 → Wikidata QID. 제목 문자열로 연결하지 않음(리메이크·동명 영화 오연결 방지). 원 표기는 별칭으로 보존</li>
          <li>자격 없음: 문서화된 규정과 근거가 있을 때만(${D.eligibility.length}건, 골든글로브 외국어 규정)</li></ul></section>
        <section class="card derived-card"><div class="card-head"><h3>분석 레이어</h3>${DERIVED()}</div>
          <ul class="notes small"><li>핵심 6개 기관 수상 수, 시점별 선두, 수렴도, 초반 선두 — 모두 <code>js/analysis.js</code>의 공개 규칙으로 계산</li>
          <li>WGA는 각본 지표로 분리, 합계에 넣지 않음. 오스카 이후 개최된 시상식은 수상 수·선두 계산에서 제외(분모도 함께 줄어듦)</li>
          <li>확률·배당률·여론·예측 모델 없음</li></ul></section>
      </div>
      <div class="section-head"><h2>검증 상태</h2></div>
      <p class="note">1차: 부문별 위키백과 목록 페이지(리비전 고정) 파싱 · 2차: 같은 위키백과의 회차별 문서와 수상작·후보 목록 자동 대조 · 충돌 항목은 수동 확인.
        공식 사이트(oscars.org, bafta.org)는 이 작업 환경에서 자동 접근이 막혀(403) 직접 대조하지 않았고, 위키백과가 인용한 공식 자료 URL(${officialRefs.size}개)을 각 기록에 붙였습니다.</p>
      <div class="grid cols-3">${verOrder.map((k) => `<div class="card tile"><div class="v">${byVer[k].toLocaleString()}</div><div class="k">${vbadge(k)} ${esc(VERIF[k] || k)}</div></div>`).join("")}</div>
      <div class="table-wrap spaced"><table class="data sticky-1"><thead><tr>${th("부문")}${th("기록", "", "r")}${th("회차 문서 대조 일치", "", "r")}${th("1차 출처 (리비전)")}</tr></thead><tbody>${catRows}</tbody></table></div>
      <div class="section-head"><h2>누락 · 불확실 · 주의</h2></div>
      <div class="table-wrap"><table class="data issues"><thead><tr>${th("구분")}${th("범위")}${th("내용")}</tr></thead><tbody>
        ${D.issues.map((i) => `<tr><td><span class="sev ${esc(i.severity)}">${esc(SEV[i.severity] || i.severity)}</span></td><td class="small">${esc(i.scope)}</td><td class="wrap small">${esc(i.text)}</td></tr>`).join("")}</tbody></table></div>
      <div class="section-head"><h2>시즌별 시상식 출처 (개최일 포함)</h2>${FACT()}</div>
      <div class="details-list">${Object.keys(bySeason).map((s) => `<details><summary>${s} 시즌 <span class="muted">— ${bySeason[s].length}개 시상식</span></summary><ul class="src-list">${bySeason[s].map((c) => { const src = A.idx.source.get(c.source_id); return `<li><span class="num">${fmtDate(c.date)}</span> ${esc(BODY[c.body])} — <a href="${esc(src.permalink)}" target="_blank" rel="noopener">${esc(c.name)}</a> <span class="muted">(rev ${src.revid})</span>${c.date_note ? ` <span class="muted">— ${esc(c.date_note)}</span>` : ""}</li>`; }).join("")}</ul></details>`).join("")}</div>
      <div class="section-head"><h2>내려받기</h2></div>
      <ul class="notes"><li><a href="data/orl-data.json" download>orl-data.json</a> — 사실 레이어 전체(시즌·시상식·영화·후보/수상·자격·출처·주의사항)</li>
        <li><a href="data/nominations.csv" download>nominations.csv</a> — 후보·수상 기록 평면 표</li>
        <li><a href="data/orl-analysis.json" download>orl-analysis.json</a> — 분석 레이어(기본 규칙 기준 시즌 요약·일치율)</li></ul>
      <p class="note small muted">빌드: ${esc(D.meta.built_at)} · 파이프라인: <code>scripts/</code> (위키백과 리비전 스냅샷 → 파싱 → Wikidata 식별 → 교차 대조 → 빌드)</p>`;
  }

  // ---------------------------------------------------------------- global controls
  const $search = document.getElementById("film-search");
  const byLabel = new Map();
  document.getElementById("film-list").innerHTML = D.films.map((f) => {
    const label = `${f.title} (${f.seasons.map((s) => s - 1).join(", ")})`;
    byLabel.set(label, f.id);
    return `<option value="${esc(label)}"></option>`;
  }).join("");
  $search.addEventListener("change", () => {
    const id = byLabel.get($search.value) || (D.films.find((f) => f.title.toLowerCase() === $search.value.trim().toLowerCase()) || {}).id;
    if (id) { location.hash = `#/film/${id}`; $search.value = ""; $search.blur(); }
  });
  const $theme = document.getElementById("theme-btn");
  const syncTheme = () => {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    $theme.textContent = light ? "다크" : "라이트";
    $theme.setAttribute("aria-label", light ? "다크 모드로 전환" : "라이트 모드로 전환");
  };
  $theme.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("orl-theme", next); } catch (e) {}
    syncTheme();
  });
  syncTheme();
  render();
})();
