// Serves docs/ over HTTP (like GitHub Pages), visits every route at desktop and phone width,
// and walks through the main user flows once. Fails on console/page errors, horizontal page
// overflow, or a broken flow. Usage: NODE_PATH=$(npm root -g) node scripts/smoke_test.js [screenshot_dir]
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "docs");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".csv": "text/csv" };
const shotDir = process.argv[2];

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

const ROUTES = [
  ["#/", "작품상 레이스"], ["#/season/2020", "2020 시즌"], ["#/season/2000", "2000 시즌"], ["#/season/2014", "2014 시즌"],
  ["#/season/2021", "2021 시즌"], ["#/season/2026?all=1", "2026 시즌"],
  ["#/explore?mode=won_lost&award=pga", "PGA"], ["#/explore?mode=without&award=sag", "SAG"],
  ["#/explore?mode=without&award=wga&from=2010&to=2019", "WGA"], ["#/explore?f_pga=won&f_dga=notwon&f_bp=lost", "편"],
  ["#/agreement", "일치"], ["#/agreement?from=2010&to=2026&post=1", "일치"], ["#/patterns", "PGA 수상작"],
  ["#/patterns?sweep=3&weak=2#q-weak", "약했는데"], ["#/film/Q61448040", "Parasite"], ["#/film/Q13255497", "Birdman"], ["#/data", "출처"],
];

(async () => {
  await new Promise((r) => server.listen(0, r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/index.html`;
  const browser = await chromium.launch();
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(200); };

  // ---- every route, desktop dark + phone light
  for (const [theme, vp] of [["dark", { width: 1280, height: 900 }], ["light", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${theme} console: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`${theme} pageerror: ${e.message}`));
    await page.goto(base);
    if (theme === "light") await page.click("#theme-btn");
    for (const [hash, expect] of ROUTES) {
      await go(page, hash);
      const text = await page.textContent("#app");
      check(text.includes(expect), `${theme} ${hash}: expected text "${expect}" missing`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(overflow <= 2, `${theme} ${hash}: horizontal page overflow ${overflow}px`);
      if (shotDir) await page.screenshot({ path: path.join(shotDir, `${theme}-${hash.replace(/[^a-z0-9]+/gi, "_")}.png`), fullPage: false });
    }
    await ctx.close();
  }

  // ---- main flows on desktop
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`flow pageerror: ${e.message}`));
    await page.goto(base);

    // home: heatmap cell -> source inspector -> Esc
    await page.click("table.heat [data-bs]");
    check(await page.isVisible("#pop.open"), "home: inspector did not open");
    check((await page.innerHTML("#pop")).includes("oldid="), "home: inspector has no revision permalink");
    await page.keyboard.press("Escape");
    check(!(await page.isVisible("#pop.open")), "home: Esc did not close inspector");

    // season: select, all-nominees toggle, early-K, timeline hover, record inspector
    await go(page, "#/season/2020");
    await page.selectOption("#season-sel", "2014");
    await page.waitForTimeout(200);
    check((await page.textContent("h1")).includes("2014"), "season: select did not switch season");
    const rowsBefore = await page.$$eval("table.sticky-1 tbody tr", (r) => r.length);
    await page.check("#all-chk");
    await page.waitForTimeout(150);
    const rowsAfter = await page.$$eval("table.sticky-1 tbody tr", (r) => r.length);
    check(rowsAfter > rowsBefore, `season: all-nominees toggle did not add rows (${rowsBefore} -> ${rowsAfter})`);
    await page.selectOption("#k-sel", "3");
    await page.waitForTimeout(150);
    check(page.url().includes("k=3") && page.url().includes("all=1"), "season: query state not kept in URL");
    await page.hover(".chart .hit >> nth=3");
    check(!(await page.isHidden(".chart .tooltip")), "season: timeline tooltip did not show");
    await page.click("table.sticky-1 [data-rec]");
    check((await page.textContent("#pop")).includes("원자료 표기"), "season: record inspector missing source notation");
    await page.keyboard.press("Escape");

    // explore: mode, award, era chip, advanced filter, reset
    await go(page, "#/explore");
    await page.click("[data-mode=without]");
    await page.selectOption("[data-k=award]", "gg");
    await page.waitForTimeout(150);
    check((await page.textContent("#ex-out")).includes("두 부문"), "explore: GG explanation missing");
    await page.click("[data-era='2010-2019']");
    await page.waitForTimeout(150);
    check((await page.inputValue("[data-k=from]")) === "2010", "explore: era chip did not set range");
    await page.selectOption("[data-f=pga]", "won");
    await page.selectOption("[data-f=bp]", "lost");
    await page.waitForTimeout(150);
    const adv = await page.textContent("#adv-out");
    check(/3편/.test(adv), `explore: PGA won + BP lost in 2010–19 should be 3 films, got "${adv.slice(0, 40)}"`);
    await page.click("#adv-reset");
    await page.waitForTimeout(150);
    check((await page.textContent("#adv-out")).includes("조건을 하나 이상"), "explore: reset did not clear filters");

    // explore won_lost for GG: season count must match the agreement page (13/27)
    await go(page, "#/explore?mode=won_lost&award=gg");
    check((await page.textContent("#ex-out")).includes("13/27"), "explore: GG miss-season count differs from agreement");

    // agreement: tie at the top (2000–09: DGA & CC 8/10), post-Oscar exclusion changes BAFTA denominator
    await go(page, "#/agreement");
    await page.click("[data-era='2000-2009']");
    await page.waitForTimeout(150);
    const sent = await page.textContent("#ag-out .result-line");
    check(sent.includes("공동 1위") && !/DGA\(8\/10\)이고, 다음은 DGA/.test(sent), `agreement: tie sentence wrong: ${sent}`);
    await page.check("[data-k=post]");
    await page.waitForTimeout(150);
    const baftaVal = await page.evaluate(() => { const labs = [...document.querySelectorAll(".bars .lab")]; const i = labs.findIndex((l) => l.textContent.startsWith("BAFTA")); return document.querySelectorAll(".bars .val")[i].textContent; });
    check(baftaVal.includes("/9"), `agreement: BAFTA denominator should be 9 when post-Oscar ceremonies are excluded (${baftaVal})`);

    // patterns: threshold changes the result
    await go(page, "#/patterns");
    const before = await page.textContent("#q-sweep + .count");
    await page.selectOption("[data-k=sweep]", "3");
    await page.waitForTimeout(150);
    const after = await page.textContent("#q-sweep + .count");
    check(before !== after, `patterns: threshold did not change sweep result (${before} / ${after})`);

    // 2000: core wins follow the before-Oscars rule everywhere (5 of 5)
    await go(page, "#/season/2000");
    const ab = await page.textContent("table.sticky-1 tbody tr.bp-winner .wins");
    check(ab.includes("5/5"), `season 2000: American Beauty core wins should read 5/5, got ${ab}`);

    // film search from the header, then a path step opens the inspector
    await page.fill("#film-search", "Parasite (2019)");
    await page.dispatchEvent("#film-search", "change");
    await page.waitForTimeout(200);
    check(page.url().includes("#/film/Q61448040"), "search: did not open Parasite");
    await page.click(".path button.step");
    check(await page.isVisible("#pop.open"), "film: step did not open inspector");
    await page.keyboard.press("Escape");

    // data page: per-season source lists and downloadable files
    await go(page, "#/data");
    check((await page.$$(".details-list details")).length === 27, "data: expected 27 season source lists");
    for (const href of await page.$$eval("a[download]", (as) => as.map((a) => a.getAttribute("href")))) {
      const r = await page.request.get(`${origin}/${href}`);
      check(r.status() === 200, `data: download ${href} -> ${r.status()}`);
    }

    // theme choice persists across reloads
    await page.click("#theme-btn");
    await page.reload();
    await page.waitForTimeout(200);
    check((await page.getAttribute("html", "data-theme")) === "light", "theme: choice not remembered");
    await ctx.close();
  }

  // ---- phone specifics
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(base + "#/season/2020");
    await page.waitForTimeout(250);
    check((await page.$eval(".site-header", (h) => getComputedStyle(h).position)) === "static", "phone: header should not be sticky");
    check((await page.$eval("nav.main", (n) => n.getBoundingClientRect().height)) < 45, "phone: menu should be a single row");
    const wrap = await page.$eval("table.sticky-1", (t) => t.closest(".table-wrap").className);
    check(wrap.includes("scrolls"), "phone: wide table should scroll inside its box");
    await page.$eval("table.sticky-1", (t) => { t.closest(".table-wrap").scrollLeft = 400; });
    const stuck = await page.$eval("table.sticky-1 tbody tr td", (td) => Math.round(td.getBoundingClientRect().left - td.closest(".table-wrap").getBoundingClientRect().left));
    check(stuck <= 2, `phone: first column should stay put while scrolling (offset ${stuck})`);
    await page.click("table.sticky-1 [data-rec]");
    const box = await page.$eval("#pop", (p) => p.getBoundingClientRect().bottom);
    check(Math.abs(box - 844) < 2, "phone: inspector should open as a bottom sheet");
    await ctx.close();
  }

  await browser.close();
  server.close();
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log(`smoke test OK: ${ROUTES.length} routes x 2 themes/viewports + main flows + phone checks`);
})().catch((e) => { console.error(e); process.exit(1); });
