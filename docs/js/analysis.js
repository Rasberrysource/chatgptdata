/* Oscar Race Lab — analysis layer.
 *
 * Everything here is DERIVED from the fact layer (window.ORL_DATA).
 * Interpretive labels ("leader", "converged", "weak winner") are rules with
 * explicit, adjustable parameters. No probabilities, odds or predictions.
 *
 * Works in the browser (window.ORL) and in Node (module.exports) so the same
 * numbers can be checked from the command line.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ORL = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Core precursor bodies whose top award is compared with Best Picture.
  // WGA is a separate screenplay indicator and never enters these counts.
  const CORE = ["pga", "dga", "sag", "bafta", "gg", "cc"];
  const SCREENPLAY = ["wga"];
  const BODY_CATS = {
    oscar: ["oscar_bp"], pga: ["pga"], dga: ["dga"], sag: ["sag_ensemble"], bafta: ["bafta_film"],
    gg: ["gg_drama", "gg_musical_comedy"], cc: ["cc_picture"], wga: ["wga_original", "wga_adapted"],
  };

  function build(data) {
    const idx = {
      film: new Map(data.films.map((f) => [f.id, f])),
      body: new Map(data.bodies.map((b) => [b.id, b])),
      cat: new Map(data.categories.map((c) => [c.id, c])),
      season: new Map(data.seasons.map((s) => [s.season, s])),
      ceremony: new Map(data.ceremonies.map((c) => [c.id, c])),
      source: new Map(data.sources.map((s) => [s.id, s])),
    };
    // nominations by season -> category -> [nom]
    const bySC = new Map();
    for (const n of data.nominations) {
      if (!bySC.has(n.season)) bySC.set(n.season, new Map());
      const m = bySC.get(n.season);
      if (!m.has(n.category)) m.set(n.category, []);
      m.get(n.category).push(n);
    }
    const inelig = new Map(); // `${film}|${season}|${cat}` -> record
    for (const e of data.eligibility) for (const c of e.categories) inelig.set(`${e.film_id}|${e.season}|${c}`, e);
    const totals = new Map(data.oscar_film_totals.map((t) => [`${t.film_id}|${t.season}`, t]));
    const seasons = data.seasons.map((s) => s.season);

    const noms = (season, cat) => (bySC.get(season) && bySC.get(season).get(cat)) || [];
    const winners = (season, cat) => noms(season, cat).filter((n) => n.result === "won").map((n) => n.film_id);
    const bodyWinners = (season, body) => BODY_CATS[body].flatMap((c) => winners(season, c));
    const bpWinner = (season) => winners(season, "oscar_bp")[0];
    const ceremonyOf = (season, body) => idx.ceremony.get(`${body}-${season}`);

    /** Status of a film at one category in one season.
     * W won, N nominated, I ineligible (documented), U unknown eligibility (WGA), - not nominated. */
    function catStatus(season, cat, film) {
      const n = noms(season, cat).find((x) => x.film_id === film);
      if (n) return { code: n.result === "won" ? "W" : "N", nom: n };
      const e = inelig.get(`${film}|${season}|${cat}`);
      if (e) return { code: "I", elig: e };
      return { code: "-" };
    }

    /** Status at a body (GG merges its two categories; WGA merges original/adapted). */
    function bodyStatus(season, body, film) {
      let best = null;
      for (const c of BODY_CATS[body]) {
        const s = catStatus(season, c, film);
        s.cat = c;
        const rank = { W: 4, N: 3, I: 2, "-": 1 }[s.code];
        if (!best || rank > best.rank) best = { ...s, rank };
      }
      if (best.code === "I" && body === "gg") {
        // ineligible for both GG picture categories
      }
      if (best.code === "-" && body === "wga") best.code = "-"; // eligibility unknown, see caveats
      return best;
    }

    /** Core bodies a film won in a season. By the documented rule, ceremonies held after
     * the Oscars (only BAFTA 2000 among core bodies) are not precursors and are not counted,
     * so this matches the tallies used for leaders / convergence. */
    function coreWins(season, film, bodies = CORE, opts = {}) {
      const includeAfter = opts.includeAfterOscars === true;
      return bodies.filter((b) => {
        const c = ceremonyOf(season, b);
        if (!includeAfter && c && c.after_oscars) return false;
        return bodyWinners(season, b).includes(film);
      });
    }

    /** Denominator for coreWins: core bodies held before that season's Oscars (6, or 5 in 2000). */
    function coreCounted(season) {
      return CORE.filter((b) => { const c = ceremonyOf(season, b); return c && !c.after_oscars; }).length;
    }

    /** Films that belong to a season's race table. */
    function seasonFilms(season, { includeAllNominees = false } = {}) {
      const set = new Set(noms(season, "oscar_bp").map((n) => n.film_id));
      for (const b of CORE) for (const f of bodyWinners(season, b)) set.add(f);
      if (includeAllNominees) for (const b of CORE) for (const c of BODY_CATS[b]) for (const n of noms(season, c)) set.add(n.film_id);
      const bp = bpWinner(season);
      return [...set].sort((a, b) => {
        const ka = [a === bp ? 0 : 1, catStatus(season, "oscar_bp", a).code === "N" ? 0 : 1, -coreWins(season, a).length];
        const kb = [b === bp ? 0 : 1, catStatus(season, "oscar_bp", b).code === "N" ? 0 : 1, -coreWins(season, b).length];
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
        return idx.film.get(a).title.localeCompare(idx.film.get(b).title);
      });
    }

    /** Chronological timeline of a season: precursor results accumulating. Pure counts. */
    function timeline(season, { bodies = CORE } = {}) {
      const s = idx.season.get(season);
      const events = [];
      for (const b of bodies.concat(SCREENPLAY)) {
        const c = ceremonyOf(season, b);
        if (!c) continue;
        events.push({ type: "ceremony", body: b, ceremony: c, date: c.date, counted: bodies.includes(b) && !c.after_oscars,
          winners: BODY_CATS[b].map((cat) => ({ cat, films: winners(season, cat) })) });
      }
      events.push({ type: "oscar_noms", date: s.oscar_nominations_date, counted: false });
      events.push({ type: "oscar", date: s.oscar_date, counted: false, winners: [{ cat: "oscar_bp", films: winners(season, "oscar_bp") }] });
      const order = ["cc", "gg", "pga", "sag", "dga", "bafta", "wga"];
      events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order.indexOf(a.body) - order.indexOf(b.body)));
      const tally = new Map();
      let countedSoFar = 0;
      for (const ev of events) {
        if (ev.counted) {
          countedSoFar += 1;
          for (const w of ev.winners) for (const f of w.films) tally.set(f, (tally.get(f) || 0) + 1);
        }
        ev.step = countedSoFar;
        ev.tally = new Map(tally);
        const max = Math.max(0, ...tally.values());
        ev.leaders = max > 0 ? [...tally.entries()].filter(([, v]) => v === max).map(([f]) => f) : [];
        ev.leadCount = max;
      }
      return events;
    }

    /** Season-level summary with rule-based labels. params are user-adjustable. */
    function seasonSummary(season, params = {}) {
      const p = { earlyK: 2, convergedMin: 5, splitMax: 3, ...params };
      const bp = bpWinner(season);
      const tl = timeline(season);
      const counted = tl.filter((e) => e.counted);
      const lastPre = counted[counted.length - 1];
      const finalTally = lastPre ? lastPre.tally : new Map();
      const finalLeaders = lastPre ? lastPre.leaders : [];
      const early = counted[Math.min(p.earlyK, counted.length) - 1];
      const earlyLeaders = early ? early.leaders : [];
      const consensus = Math.max(0, ...finalTally.values());
      const topFilms = [...finalTally.entries()].filter(([, v]) => v === consensus).map(([f]) => f);
      const distinct = new Set(CORE.filter((b) => !ceremonyOf(season, b).after_oscars).flatMap((b) => bodyWinners(season, b))).size;
      const bpWins = finalTally.get(bp) || 0;
      // who led at each counted step (for "lead changes")
      const leaderPath = counted.map((e) => ({ body: e.body, date: e.date, leaders: e.leaders, leadCount: e.leadCount }));
      const bpEverSoleLeader = counted.some((e) => e.leaders.length === 1 && e.leaders[0] === bp);
      const labels = [];
      if (consensus >= p.convergedMin) labels.push({ id: "converged", text: `수렴: 한 영화가 ${consensus}/${counted.length}개 기관 수상` });
      if (consensus <= p.splitMax) labels.push({ id: "split", text: `분산: 최다 수상작도 ${consensus}개 기관` });
      if (!finalLeaders.includes(bp)) labels.push({ id: "leader_lost", text: "오스카 직전 전초전 최다 수상작이 작품상을 받지 못함" });
      else if (finalLeaders.length > 1) labels.push({ id: "co_leader_won", text: "공동 최다 수상작 중 하나가 작품상" });
      else labels.push({ id: "leader_won", text: "전초전 최다 수상작이 작품상" });
      if (earlyLeaders.length && !earlyLeaders.includes(bp)) labels.push({ id: "early_changed", text: `초반(첫 ${p.earlyK}개 전초전) 선두와 작품상 수상작이 다름` });
      return {
        season, bp, bpWins, consensus, topFilms, distinct, counted: counted.length,
        finalLeaders, earlyLeaders, earlyK: p.earlyK, leaderPath, bpEverSoleLeader, labels, timeline: tl,
      };
    }

    /** How often each body's winner was the Best Picture winner. */
    function agreement(body, { from = seasons[0], to = seasons[seasons.length - 1], excludeAfterOscars = false, cats = null } = {}) {
      const rows = [];
      for (const s of seasons) {
        if (s < from || s > to) continue;
        const c = ceremonyOf(s, body);
        if (!c) continue;
        if (excludeAfterOscars && c.after_oscars) continue;
        const useCats = cats || BODY_CATS[body];
        const ws = useCats.flatMap((cat) => winners(s, cat));
        const bp = bpWinner(s);
        const st = bodyStatus(s, body, bp);
        const bpStatus = cats ? (cats.map((cat) => catStatus(s, cat, bp).code).sort((a, b) => "WNI-".indexOf(a) - "WNI-".indexOf(b))[0]) : st.code;
        rows.push({
          season: s, winners: ws, bp, match: ws.includes(bp), tie: ws.length > 1 && BODY_CATS[body].length === 1,
          bpStatus, afterOscars: c.after_oscars,
          winnersBpNominated: ws.filter((f) => catStatus(s, "oscar_bp", f).code !== "-").length,
        });
      }
      const n = rows.length;
      const match = rows.filter((r) => r.match).length;
      const bpNominated = rows.filter((r) => r.bpStatus === "W" || r.bpStatus === "N").length;
      const bpIneligible = rows.filter((r) => r.bpStatus === "I").length;
      return { body, cats, n, match, rate: n ? match / n : null, bpNominated, bpIneligible, rows };
    }

    /** "Won A but lost Best Picture" */
    function wonButLost(body, { cats = null, from, to } = {}) {
      const out = [];
      for (const s of seasons) {
        if ((from && s < from) || (to && s > to)) continue;
        const bp = bpWinner(s);
        for (const cat of cats || BODY_CATS[body]) {
          for (const f of winners(s, cat)) {
            if (f === bp) continue;
            out.push({ season: s, film: f, cat, bp, bpStatus: catStatus(s, "oscar_bp", f).code, coreWins: coreWins(s, f).length,
              afterOscars: !!(ceremonyOf(s, body) || {}).after_oscars });
          }
        }
      }
      return out;
    }

    /** "Won Best Picture without winning A" */
    function bpWithout(body, { cats = null, from, to } = {}) {
      const out = [];
      for (const s of seasons) {
        if ((from && s < from) || (to && s > to)) continue;
        const bp = bpWinner(s);
        const useCats = cats || BODY_CATS[body];
        const won = useCats.some((c) => winners(s, c).includes(bp));
        if (won) continue;
        const codes = useCats.map((c) => catStatus(s, c, bp).code);
        const code = codes.includes("N") ? "N" : codes.includes("I") ? "I" : "-";
        const who = useCats.flatMap((c) => winners(s, c));
        out.push({ season: s, film: bp, status: code, bodyWinners: who, coreWins: coreWins(s, bp).length,
          afterOscars: !!(ceremonyOf(s, body) || {}).after_oscars });
      }
      return out;
    }

    /** Generic filter: each condition {body|cat, want: won|notwon|nominated_lost|not_nominated|nominated_any}. */
    function query(conds, { scope = "bp_nominees", from, to, bpResult = "any" } = {}) {
      const out = [];
      for (const s of seasons) {
        if ((from && s < from) || (to && s > to)) continue;
        const films = scope === "bp_nominees" ? noms(s, "oscar_bp").map((n) => n.film_id) : seasonFilms(s, { includeAllNominees: true });
        for (const f of films) {
          const bpc = catStatus(s, "oscar_bp", f).code;
          if (bpResult === "won" && bpc !== "W") continue;
          if (bpResult === "lost" && bpc === "W") continue;
          let ok = true;
          for (const c of conds) {
            const st = c.cat ? catStatus(s, c.cat, f).code : bodyStatus(s, c.body, f).code;
            if (c.want === "won" && st !== "W") ok = false;
            if (c.want === "notwon" && st === "W") ok = false;
            if (c.want === "nominated_lost" && st !== "N") ok = false;
            if (c.want === "not_nominated" && !(st === "-" || st === "I")) ok = false;
            if (c.want === "nominated_any" && !(st === "W" || st === "N")) ok = false;
            if (!ok) break;
          }
          if (ok) out.push({ season: s, film: f, bpStatus: bpc, coreWins: coreWins(s, f).length });
        }
      }
      return out;
    }

    function filmPath(film) {
      const rows = data.nominations.filter((n) => n.film_id === film).map((n) => ({ ...n, ceremony: idx.ceremony.get(n.ceremony_id) }));
      rows.sort((a, b) => (a.ceremony.date < b.ceremony.date ? -1 : a.ceremony.date > b.ceremony.date ? 1 : 0));
      return rows;
    }

    return {
      CORE, SCREENPLAY, BODY_CATS, data, idx, seasons,
      noms, winners, bodyWinners, bpWinner, ceremonyOf, catStatus, bodyStatus, coreWins, coreCounted,
      seasonFilms, timeline, seasonSummary, agreement, wonButLost, bpWithout, query, filmPath,
      totalNoms: (film, season) => totals.get(`${film}|${season}`),
      ineligible: (film, season, cat) => inelig.get(`${film}|${season}|${cat}`),
    };
  }

  return { build, CORE, SCREENPLAY, BODY_CATS };
});
