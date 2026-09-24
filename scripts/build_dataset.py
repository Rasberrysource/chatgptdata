"""Build the fact layer (data/build/*.json) and the site bundle (docs/data/orl-data.js).

Fact layer only: who was nominated / who won / when / according to which source.
Interpretation (leaders, convergence, "upsets") is computed in docs/js/analysis.js.
"""
import csv
import datetime as dt
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from fetch_wikipedia import slugify
from resolve_films import resolve
from wikitable import parse_tables, plain, links, strip_refs, COMMENT_RE

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "wikipedia"
INTERIM = ROOT / "data" / "interim"
MANUAL = ROOT / "data" / "manual"
BUILD = ROOT / "data" / "build"
SITE_DATA = ROOT / "docs" / "data"

SEASONS = list(range(2000, 2027))

BODIES = [
    {"id": "oscar", "name": "Academy Awards", "short": "Oscar", "kind": "target",
     "voters": "AMPAS 전 회원 (작품상은 2010년부터 선호투표)",
     "official_url": "https://www.oscars.org/oscars", "official_reachable": False},
    {"id": "pga", "name": "Producers Guild of America Awards", "short": "PGA", "kind": "bp_precursor",
     "voters": "미국 프로듀서 조합원 (2010년부터 후보 10편·선호투표)",
     "official_url": "https://producersguild.org/producers-guild-awards/", "official_reachable": True},
    {"id": "dga", "name": "Directors Guild of America Awards", "short": "DGA", "kind": "bp_precursor",
     "voters": "미국 감독 조합원 (TV 감독 포함)",
     "official_url": "https://www.dga.org/Awards/History", "official_reachable": True},
    {"id": "sag", "name": "Screen Actors Guild Awards / Actor Awards (2026~)", "short": "SAG", "kind": "bp_precursor",
     "voters": "SAG-AFTRA 회원",
     "official_url": "https://www.actorawards.org/", "official_reachable": True},
    {"id": "bafta", "name": "British Academy Film Awards", "short": "BAFTA", "kind": "bp_precursor",
     "voters": "영국 아카데미(BAFTA) 회원, 영국 개봉 기준 자격",
     "official_url": "https://www.bafta.org/awards/film", "official_reachable": False},
    {"id": "gg", "name": "Golden Globe Awards", "short": "Globes", "kind": "bp_precursor",
     "voters": "~2023: HFPA(약 80~100명) / 2024~: 재편된 국제 기자단(약 300명)",
     "official_url": "https://goldenglobes.com/winners-nominees/", "official_reachable": True},
    {"id": "cc", "name": "Critics' Choice Awards", "short": "Critics Choice", "kind": "bp_precursor",
     "voters": "Critics Choice Association (방송·온라인 평론가)",
     "official_url": "https://www.criticschoice.com/critics-choice-awards/", "official_reachable": True},
    {"id": "wga", "name": "Writers Guild of America Awards", "short": "WGA", "kind": "screenplay_indicator",
     "voters": "미국 작가조합원 — 조합 관할 각본만 자격",
     "official_url": "https://awards.wga.org/awards/nominees-winners", "official_reachable": True},
]

CATEGORIES = [
    {"id": "oscar_bp", "body": "oscar", "name": "Best Picture", "label": "오스카 작품상", "honors": "film",
     "list_page": "Academy_Award_for_Best_Picture"},
    {"id": "pga", "body": "pga", "name": "Darryl F. Zanuck Award (Theatrical Motion Picture)", "label": "PGA",
     "honors": "film", "list_page": "Producers_Guild_of_America_Award_for_Best_Theatrical_Motion_Picture"},
    {"id": "dga", "body": "dga", "name": "Outstanding Directorial Achievement in Feature Film", "label": "DGA",
     "honors": "director", "list_page": "Directors_Guild_of_America_Award_for_Outstanding_Directing___Feature_Film"},
    {"id": "sag_ensemble", "body": "sag", "name": "Outstanding Performance by a Cast in a Motion Picture",
     "label": "SAG 앙상블", "honors": "cast",
     "list_page": "Screen_Actors_Guild_Award_for_Outstanding_Performance_by_a_Cast_in_a_Motion_Picture"},
    {"id": "bafta_film", "body": "bafta", "name": "Best Film", "label": "BAFTA", "honors": "film",
     "list_page": "BAFTA_Award_for_Best_Film"},
    {"id": "gg_drama", "body": "gg", "name": "Best Motion Picture – Drama", "label": "글로브 드라마", "honors": "film",
     "list_page": "Golden_Globe_Award_for_Best_Motion_Picture___Drama"},
    {"id": "gg_musical_comedy", "body": "gg", "name": "Best Motion Picture – Musical or Comedy",
     "label": "글로브 뮤지컬·코미디", "honors": "film",
     "list_page": "Golden_Globe_Award_for_Best_Motion_Picture___Musical_or_Comedy"},
    {"id": "cc_picture", "body": "cc", "name": "Best Picture", "label": "Critics Choice", "honors": "film",
     "list_page": "Critics__Choice_Movie_Award_for_Best_Picture"},
    {"id": "wga_original", "body": "wga", "name": "Original Screenplay", "label": "WGA 각본", "honors": "screenplay",
     "list_page": "Writers_Guild_of_America_Award_for_Best_Original_Screenplay"},
    {"id": "wga_adapted", "body": "wga", "name": "Adapted Screenplay", "label": "WGA 각색", "honors": "screenplay",
     "list_page": "Writers_Guild_of_America_Award_for_Best_Adapted_Screenplay"},
]
CAT_BODY = {c["id"]: c["body"] for c in CATEGORIES}

OFFICIAL_DOMAINS = {
    "oscars.org": "oscar", "producersguild.org": "pga", "dga.org": "dga", "sagawards.org": "sag",
    "actorawards.org": "sag", "bafta.org": "bafta", "goldenglobes.com": "gg", "criticschoice.com": "cc",
    "wga.org": "wga", "wgaeast.org": "wga", "wgaeast.com": "wga",
}

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"], 1)}


def load_snap(name):
    return json.loads((RAW / f"{slugify(name) if ' ' in name or '–' in name else name}.json").read_text())


def parse_date(raw):
    """Return (iso_date, note) from an infobox date value."""
    if not raw:
        return None, None
    t = strip_refs(raw)
    m = re.search(r"\{\{\s*start date\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})", t, re.I)
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat(), None
    t = plain(t)
    m = re.search(r"([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})", t)
    if m and m.group(1).lower() in MONTHS:
        return dt.date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).isoformat(), None
    # "10–11 April 2021" -> last day, with a note
    m = re.search(r"(\d{1,2})\s*[–-]\s*(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})", t)
    if m and m.group(3).lower() in MONTHS:
        d = dt.date(int(m.group(4)), MONTHS[m.group(3).lower()], int(m.group(2))).isoformat()
        return d, f"infobox lists a multi-day event ({m.group(0)}); the last day is used"
    m = re.search(r"(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})", t)
    if m and m.group(2).lower() in MONTHS:
        return dt.date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1))).isoformat(), None
    return None, f"unparsed date: {t[:60]}"


def infobox_date(wikitext):
    text = COMMENT_RE.sub("", wikitext)
    m = re.search(r"^\s*\|\s*date\s*=\s*(.+)$", text, re.M)  # multi-line infobox
    if m and "{{infobox" in text[:m.start()].lower():
        return m.group(1).strip()
    i = text.lower().find("{{infobox")
    if i < 0:
        return None
    body = strip_refs(text[i:i + 3000])
    m = re.search(r"\|\s*date\s*=\s*((?:\{\{[^{}]*\}\}|[^|\n{}])+)", body)
    return m.group(1).strip() if m else None


def oscar_nominations_date(wikitext):
    text = strip_refs(COMMENT_RE.sub("", wikitext))
    m = re.search(r"[Nn]omin\w+[^.]{0,80}?announced[^.]{0,40}?on ([A-Z][a-z]+ \d{1,2}, \d{4})", text)
    if not m:
        return None
    return parse_date(m.group(1))[0]


def display_title(article_title):
    return re.sub(r"\s*\((?:[^()]*\b)?film\)$", "", article_title).strip()


def norm(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", t)


def oscar_total_nominations(wikitext):
    """{link target: nominations} from the 'Films with multiple nominations' table."""
    out = {}
    for table in parse_tables(COMMENT_RE.sub("", wikitext)):
        head = " ".join(plain(c["text"]) for r in table["rows"][:2] for c in r["cells"]) + " " + table.get("caption", "")
        if "Nominations" not in head or "Film" not in head:
            continue
        cur = None
        for row in table["rows"]:
            for c in row["cells"]:
                txt = plain(c["text"])
                if re.fullmatch(r"\d{1,2}", txt):
                    cur = int(txt)
                    continue
                lk = links(strip_refs(c["text"]))
                if lk and "''" in c["text"] and cur:
                    out[lk[0][0]] = cur
        if out:
            break
    return out


def main():
    rows = json.loads((INTERIM / "wiki_nominations.json").read_text())
    res = json.loads((INTERIM / "title_resolution.json").read_text())
    cross = {(c["category"], c["season"]): c for c in json.loads((INTERIM / "crosscheck_ceremony.json").read_text())}
    manual = json.loads((MANUAL / "annotations.json").read_text())

    sources = {}

    def add_source(sid, **kw):
        sources.setdefault(sid, {"id": sid, **kw})
        return sid

    # ---- list-page sources
    list_src = {}
    for cat in CATEGORIES + [{"id": "gg_foreign_language",
                              "list_page": "Golden_Globe_Award_for_Best_Motion_Picture___Non_English_Language"}]:
        snap = json.loads((RAW / f"{cat['list_page']}.json").read_text())
        list_src[cat["id"]] = add_source(
            f"wp:{snap['pageid']}", kind="secondary", publisher="English Wikipedia", title=snap["title"],
            url="https://en.wikipedia.org/wiki/" + snap["title"].replace(" ", "_"), permalink=snap["permalink"],
            revid=snap["revid"], rev_timestamp=snap["rev_timestamp"], retrieved_at=snap["fetched_at"])

    # ---- films
    film_rows = defaultdict(list)
    for r in rows:
        q = res[r["wiki_target"]]["wikidata"]
        r["film_id"] = q
        film_rows[q].append(r)

    main_rows = [r for r in rows if r["category"] in CAT_BODY]
    films = {}
    for q, rs in film_rows.items():
        if not any(r["category"] in CAT_BODY for r in rs):
            continue  # only seen in the context list (GG foreign-language)
        art = res[rs[0]["wiki_target"]]["resolved_title"]
        aliases = defaultdict(set)
        for r in rs:
            aliases[r["shown_title"]].add(r["category"])
        seasons = sorted({r["film_year"] + 1 for r in rs if r["category"] in CAT_BODY})
        # canonical title: the article title without its "(2019 film)" disambiguator, but keep the
        # stylisation the award lists use when they only differ in case/punctuation ("(500) Days of Summer")
        base = display_title(art)
        same = Counter(r["shown_title"] for r in rs if norm(r["shown_title"]) == norm(base))
        title = same.most_common(1)[0][0] if same else base
        films[q] = {
            "id": q, "title": title, "wiki_title": art,
            "wiki_url": "https://en.wikipedia.org/wiki/" + art.replace(" ", "_"),
            "wikidata_url": f"https://www.wikidata.org/wiki/{q}",
            "seasons": seasons,
            "aliases": [{"title": t, "seen_in": sorted(c)} for t, c in sorted(aliases.items()) if t != title],
        }

    # ---- ceremonies
    ceremonies = {}
    date_overrides = {(d["body"], d["season"]): d for d in manual["ceremony_dates"]}
    for r in main_rows:
        body = CAT_BODY[r["category"]]
        season = r["film_year"] + 1
        cid = f"{body}-{season}"
        if cid in ceremonies:
            ceremonies[cid]["categories"] = sorted(set(ceremonies[cid]["categories"]) | {r["category"]})
            continue
        snap = json.loads((RAW / f"{slugify(r['ceremony_page'])}.json").read_text())
        raw_date = infobox_date(snap["wikitext"])
        date, note = parse_date(raw_date)
        ov = date_overrides.get((body, season))
        date_basis = "Wikipedia ceremony page infobox"
        if ov:
            date, note, date_basis = ov["date"], ov["note"], ov.get("basis", date_basis)
        sid = add_source(f"wp:{snap['pageid']}", kind="secondary", publisher="English Wikipedia",
                         title=snap["title"], url="https://en.wikipedia.org/wiki/" + snap["title"].replace(" ", "_"),
                         permalink=snap["permalink"], revid=snap["revid"], rev_timestamp=snap["rev_timestamp"],
                         retrieved_at=snap["fetched_at"])
        m = re.match(r"(\d+)(?:st|nd|rd|th)\b", snap["title"])
        ceremonies[cid] = {
            "id": cid, "body": body, "season": season, "film_year": r["film_year"], "name": snap["title"],
            "ordinal": int(m.group(1)) if m else None, "categories": [r["category"]],
            "date": date, "date_note": note, "date_basis": date_basis, "source_id": sid,
        }

    # ---- seasons
    seasons = []
    for s in SEASONS:
        oc = ceremonies[f"oscar-{s}"]
        snap = json.loads((RAW / f"{slugify(oc['name'])}.json").read_text())
        nom_date = oscar_nominations_date(snap["wikitext"])
        ov = manual["oscar_nomination_dates"].get(str(s))
        bp_n = sum(1 for r in main_rows if r["category"] == "oscar_bp" and r["film_year"] + 1 == s)
        seasons.append({
            "season": s, "oscar_ordinal": oc["ordinal"], "film_year": s - 1, "oscar_date": oc["date"],
            "oscar_nominations_date": ov["date"] if ov else nom_date,
            "oscar_nominations_date_basis": ov["basis"] if ov else "Wikipedia ceremony page lead text (regex)",
            "bp_nominee_count": bp_n, "notes": manual["season_notes"].get(str(s), []),
        })
    season_by = {s["season"]: s for s in seasons}
    for c in ceremonies.values():
        s = season_by[c["season"]]
        c["after_oscars"] = bool(c["date"] and c["body"] != "oscar" and c["date"] > s["oscar_date"])
        c["before_oscar_nominations"] = bool(c["date"] and s["oscar_nominations_date"]
                                             and c["date"] < s["oscar_nominations_date"])

    # ---- nominations
    nominations = []
    counts = Counter()
    for r in main_rows:
        season = r["film_year"] + 1
        body = CAT_BODY[r["category"]]
        cid = f"{body}-{season}"
        winners = [x for x in main_rows if x["category"] == r["category"] and x["film_year"] == r["film_year"]
                   and x["winner_markup"]]
        cited = []
        for u in r["group_ref_urls"]:
            dom = re.sub(r"^https?://(www\.)?", "", u).split("/")[0]
            official = next((b for d, b in OFFICIAL_DOMAINS.items() if dom.endswith(d)), None)
            cited.append({"url": u, "official": bool(official)})
        cc = cross.get((r["category"], season))
        counts[(r["category"], season)] += 1
        nominations.append({
            "id": f"{r['category']}-{season}-{counts[(r['category'], season)]:02d}",
            "season": season, "category": r["category"], "ceremony_id": cid, "film_id": r["film_id"],
            "result": "won" if r["winner_markup"] else "nominated",
            "tie": bool(r["winner_markup"] and len(winners) > 1),
            "shown_title": r["shown_title"], "people": r["person_text"] if r["category"] == "dga" else None,
            "source_id": list_src[r["category"]], "cited_refs": cited,
            "verification": {
                "list_page": "parsed",
                "ceremony_page": ("manual_ok" if (cc or {}).get("status") not in (None, "match", "not_found")
                                  and f"{r['category']} {season}" in manual["crosscheck_resolutions"]
                                  else (cc or {}).get("status", "not_checked")),
            },
        })

    # ---- eligibility (documented rule + documented placement only)
    eligibility = []
    rule = manual["rules"]["gg_non_english"]
    add_source(rule["source_id"], **rule["source"])
    fl = [r for r in rows if r["category"] == "gg_foreign_language"]
    for r in fl:
        season = r["film_year"] + 1
        if season > rule["last_season"]:
            continue
        q = r["film_id"]
        in_main = [x for x in main_rows if x["film_id"] == q]
        if not in_main:
            continue
        if any(x["category"] in ("gg_drama", "gg_musical_comedy") and x["film_year"] == r["film_year"] for x in in_main):
            raise SystemExit(f"rule conflict: {q} nominated in a GG picture category and foreign-language")
        eligibility.append({
            "film_id": q, "season": season, "categories": ["gg_drama", "gg_musical_comedy"], "status": "ineligible",
            "rule": rule["text"],
            "evidence": f"Golden Globe foreign-language film {'winner' if r['winner_markup'] else 'nominee'} "
                        f"({r['ceremony_page']})",
            "source_ids": [list_src["gg_foreign_language"], rule["source_id"]],
        })

    # ---- Oscar total nominations (context for BP nominees)
    totals = []
    for s in SEASONS:
        oc = ceremonies[f"oscar-{s}"]
        snap = json.loads((RAW / f"{slugify(oc['name'])}.json").read_text())
        table = oscar_total_nominations(snap["wikitext"])
        tres = resolve(sorted(table))
        by_q = {tres[t]["wikidata"]: n for t, n in table.items()}
        for n in [x for x in nominations if x["season"] == s and x["category"] == "oscar_bp"]:
            if n["film_id"] in by_q:
                totals.append({"season": s, "film_id": n["film_id"], "total_nominations": by_q[n["film_id"]],
                               "basis": "listed in 'Films with multiple nominations'", "source_id": oc["source_id"]})
            elif table:
                totals.append({"season": s, "film_id": n["film_id"], "total_nominations": 1,
                               "basis": "not listed among films with multiple nominations → 1 (Best Picture only)",
                               "source_id": oc["source_id"]})
            else:
                totals.append({"season": s, "film_id": n["film_id"], "total_nominations": None,
                               "basis": "table not parsed", "source_id": oc["source_id"]})

    # ---- issues / caveats shown on the data page
    issues = list(manual["issues"])
    for (cat, season), c in sorted(cross.items()):
        if c["status"] == "not_found":
            issues.append({"severity": "info", "scope": f"{cat} {season}",
                           "text": "Wikipedia 회차 문서에서 해당 부문 섹션을 자동으로 찾지 못해 목록 페이지와의 내부 교차 대조를 하지 못함 (목록 페이지 값 사용)."})
        elif c["status"] != "match":
            note = manual["crosscheck_resolutions"].get(f"{cat} {season}")
            issues.append({"severity": "info" if note else "warning", "scope": f"{cat} {season}",
                           "text": note or f"목록 페이지와 회차 문서 불일치: {c['status']} {c['notes']}"})

    # ---- sanity checks (fail loudly)
    for s in SEASONS:
        for cat in CAT_BODY:
            ws = [n for n in nominations if n["season"] == s and n["category"] == cat and n["result"] == "won"]
            if len(ws) != 1 and not all(n["tie"] for n in ws):
                raise SystemExit(f"{cat} {s}: {len(ws)} winners")
            if f"{CAT_BODY[cat]}-{s}" not in ceremonies:
                raise SystemExit(f"missing ceremony {cat} {s}")
    for c in ceremonies.values():
        if not c["date"]:
            raise SystemExit(f"missing date {c['id']}")

    bundle = {
        "meta": {
            "project": "Oscar Race Lab",
            "built_at": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "seasons": [SEASONS[0], SEASONS[-1]],
            "note": "Fact layer. Interpretive labels are computed by js/analysis.js with the rules shown on the site.",
        },
        "bodies": BODIES,
        "categories": [{k: v for k, v in c.items() if k != "list_page"} | {"source_id": list_src[c["id"]]}
                       for c in CATEGORIES],
        "seasons": seasons,
        "ceremonies": sorted(ceremonies.values(), key=lambda c: (c["season"], c["date"] or "", c["body"])),
        "films": sorted(films.values(), key=lambda f: (f["seasons"][0] if f["seasons"] else 0, f["title"])),
        "nominations": nominations,
        "eligibility": eligibility,
        "oscar_film_totals": totals,
        "sources": sorted(sources.values(), key=lambda s: s["id"]),
        "issues": issues,
    }
    BUILD.mkdir(parents=True, exist_ok=True)
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    for key in ("bodies", "categories", "seasons", "ceremonies", "films", "nominations", "eligibility",
                "oscar_film_totals", "sources", "issues"):
        (BUILD / f"{key}.json").write_text(json.dumps(bundle[key], ensure_ascii=False, indent=1))
    (SITE_DATA / "orl-data.json").write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")))
    (SITE_DATA / "orl-data.js").write_text(
        "// Generated by scripts/build_dataset.py - do not edit by hand.\nwindow.ORL_DATA = "
        + json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + ";\n")

    # flat CSV for spreadsheet users
    fby = {f["id"]: f for f in films.values()}
    cby = ceremonies
    srcby = sources
    with open(SITE_DATA / "nominations.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["season", "category", "film_id", "film_title", "shown_title", "result", "tie",
                    "ceremony", "ceremony_date", "source_permalink", "ceremony_page_check"])
        for n in nominations:
            w.writerow([n["season"], n["category"], n["film_id"], fby[n["film_id"]]["title"], n["shown_title"],
                        n["result"], n["tie"], cby[n["ceremony_id"]]["name"], cby[n["ceremony_id"]]["date"],
                        srcby[n["source_id"]]["permalink"], n["verification"]["ceremony_page"]])
    print(f"seasons={len(seasons)} ceremonies={len(ceremonies)} films={len(films)} "
          f"nominations={len(nominations)} eligibility={len(eligibility)} totals={len(totals)} "
          f"sources={len(sources)} issues={len(issues)}")


if __name__ == "__main__":
    main()
