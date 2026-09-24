// Serves docs/ over HTTP (like GitHub Pages) and visits every route in headless Chromium.
// Fails on any console error / page error. Usage: NODE_PATH=$(npm root -g) node scripts/smoke_test.js [screenshot_dir]
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
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? undefined : undefined });
  const errors = [];
  for (const [theme, vp] of [["dark", { width: 1280, height: 900 }], ["light", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${theme} console: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`${theme} pageerror: ${e.message}`));
    await page.goto(base);
    if (theme === "light") await page.click("#theme-btn");
    for (const [hash, expect] of ROUTES) {
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.waitForTimeout(150);
      const text = await page.textContent("#app");
      if (!text.includes(expect)) errors.push(`${theme} ${hash}: expected text "${expect}" missing`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 2) errors.push(`${theme} ${hash}: horizontal page overflow ${overflow}px`);
      if (shotDir) await page.screenshot({ path: path.join(shotDir, `${theme}-${hash.replace(/[^a-z0-9]+/gi, "_")}.png`), fullPage: false });
    }
    // record inspector opens and shows a source link
    await page.evaluate(() => { location.hash = "#/season/2020"; });
    await page.waitForTimeout(150);
    await page.click("[data-rec]");
    const pop = await page.textContent("#pop");
    if (!pop.includes("출처") || !pop.includes("oldid")) {
      const html = await page.innerHTML("#pop");
      if (!html.includes("oldid")) errors.push(`${theme}: record inspector missing permalink`);
    }
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `${theme}-popover.png`) });
    await page.keyboard.press("Escape");
    // timeline hover
    await page.hover(".chart .hit >> nth=3");
    if (await page.isHidden(".chart .tooltip")) errors.push(`${theme}: timeline tooltip did not show`);
    await ctx.close();
  }
  await browser.close();
  server.close();
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log(`smoke test OK: ${ROUTES.length} routes x 2 themes/viewports`);
})().catch((e) => { console.error(e); process.exit(1); });
