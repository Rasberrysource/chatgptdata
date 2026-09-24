// Runs the site's analysis layer in Node, prints a summary and writes the derived
// layer (docs/data/orl-analysis.json) so interpretive outputs are downloadable too.
const fs = require("fs");
const path = require("path");
const ORL = require("../docs/js/analysis.js");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/data/orl-data.json"), "utf8"));
const A = ORL.build(data);
const t = (f) => A.idx.film.get(f).title;
const out = { generated_from: data.meta.built_at, rules: {
  core_bodies: A.CORE, screenplay_indicator: A.SCREENPLAY,
  precursor_win: "a film 'wins' a body if it won that body's top category (Golden Globes: either picture category)",
  leader: "films with the most core-body wins among ceremonies held so far (ties = co-leaders); ceremonies after the Oscars are not counted",
  early_leader: "leaders after the first K core ceremonies of the season (default K=2)",
  converged: "a single film won >= 5 core bodies (default)", split: "no film won more than 3 core bodies (default)",
}, agreement: {}, seasons: [] };
const quiet = process.argv.includes("--quiet");
const log = (...a) => { if (!quiet) console.log(...a); };
log("== winner = Best Picture winner (all 27 seasons)");
for (const b of [...A.CORE, "wga"]) {
  const g = A.agreement(b);
  const g2 = A.agreement(b, { excludeAfterOscars: true });
  out.agreement[b] = { match: g.match, n: g.n, bp_winner_nominated: g.bpNominated, bp_winner_ineligible: g.bpIneligible,
    excluding_after_oscars: { match: g2.match, n: g2.n },
    mismatches: g.rows.filter((r) => !r.match).map((r) => ({ season: r.season, winners: r.winners, bp: r.bp })) };
  log(b.padEnd(6), `${g.match}/${g.n}`, (100 * g.rate).toFixed(0) + "%", "| BP winner nominated", `${g.bpNominated}/${g.n}`, "ineligible", g.bpIneligible,
    "| mismatches:", g.rows.filter((r) => !r.match).map((r) => r.season).join(","));
}
for (const c of ["gg_drama", "gg_musical_comedy", "wga_original", "wga_adapted"]) {
  const body = c.startsWith("gg") ? "gg" : "wga";
  const g = A.agreement(body, { cats: [c] });
  out.agreement[c] = { match: g.match, n: g.n };
  log("  " + c.padEnd(18), `${g.match}/${g.n}`);
}
log("\n== seasons");
for (const s of A.seasons) {
  const ss = A.seasonSummary(s);
  out.seasons.push({ season: s, bp_winner: ss.bp, bp_winner_core_wins: ss.bpWins, consensus: ss.consensus, top_films: ss.topFilms,
    distinct_core_winners: ss.distinct, core_ceremonies_counted: ss.counted, final_leaders: ss.finalLeaders,
    early_leaders: ss.earlyLeaders, labels: ss.labels.map((l) => l.id) });
  log(s, t(ss.bp).padEnd(36), "bpWins", ss.bpWins, "consensus", ss.consensus, "top", ss.topFilms.map(t).join("/"),
    "| early", ss.earlyLeaders.map(t).join("/"), "|", ss.labels.map((l) => l.id).join(","));
}
fs.writeFileSync(path.join(__dirname, "../docs/data/orl-analysis.json"), JSON.stringify(out, null, 1));
