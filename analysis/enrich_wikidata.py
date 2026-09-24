"""Fetch director, genre, country, runtime and type for each film from Wikidata.

Films are matched on the Letterboxd film ID property (P6127) using the slugs
from resolve_slugs.py. Films Wikidata does not link to Letterboxd fall back to
an exact English-title match within one year of the release year.
Output: data/film_meta.csv (one row per film in ratings.csv).
"""
import csv
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SLUGS = ROOT / "data" / "cache" / "slugs.json"
RAW = ROOT / "data" / "cache" / "wikidata_rows.json"
QUERIED = ROOT / "data" / "cache" / "queried_slugs.json"
OUT = ROOT / "data" / "film_meta.csv"
UA = "letterboxd-taste-analysis/0.1 (personal, non-commercial)"
ENDPOINT = "https://query.wikidata.org/sparql"

# Each UNION branch tags its value with a property name so one query returns everything.
PROPS = """
  { ?film wdt:P57 ?v . BIND("director" AS ?p) }
  UNION { ?film wdt:P136 ?v . BIND("genre" AS ?p) }
  UNION { ?film wdt:P495 ?v . BIND("country" AS ?p) }
  UNION { ?film wdt:P31 ?v . BIND("type" AS ?p) }
  UNION { ?film wdt:P577 ?v . BIND("date" AS ?p) }
  UNION { ?film p:P2047/psv:P2047 [ wikibase:quantityAmount ?v ; wikibase:quantityUnit ?unit ] . BIND("runtime" AS ?p) }
  OPTIONAL { ?v rdfs:label ?ko FILTER(LANG(?ko) = "ko") }
  OPTIONAL { ?v rdfs:label ?en FILTER(LANG(?en) = "en") }
"""


def sparql(query):
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)["results"]["bindings"]
        except Exception as e:
            print(f"sparql retry {attempt}: {e}", flush=True)
            time.sleep(5 * 2 ** attempt)
    raise RuntimeError("SPARQL failed")


def lit(s):
    return json.dumps(s, ensure_ascii=False)


def by_slug(slugs):
    q = f"""SELECT ?key ?film ?p ?v ?unit ?ko ?en WHERE {{
      VALUES ?key {{ {' '.join(lit(s) for s in slugs)} }}
      ?film wdt:P6127 ?key .
      {PROPS}
    }}"""
    return sparql(q)


def by_title(key, title, year):
    q = f"""SELECT ?key ?film ?p ?v ?unit ?ko ?en WHERE {{
      BIND({lit(key)} AS ?key)
      ?film rdfs:label {lit(title)}@en ; wdt:P577 ?d .
      FILTER(YEAR(?d) >= {year - 1} && YEAR(?d) <= {year + 1})
      FILTER NOT EXISTS {{ ?film wdt:P31 wd:Q5 }}
      {PROPS}
    }}"""
    return sparql(q)


def val(b, k):
    return b[k]["value"] if k in b else None


def collect(rows):
    """Group SPARQL rows into {key: {film, director: [...], genre: [...], ...}}."""
    out = {}
    for b in rows:
        key, film = val(b, "key"), val(b, "film").rsplit("/", 1)[-1]
        rec = out.setdefault(key, {})
        # A slug can map to several items (film + its restoration); keep the first seen.
        rec.setdefault("qid", film)
        if rec["qid"] != film:
            continue
        p, v = val(b, "p"), val(b, "v")
        if p == "runtime":
            unit = (val(b, "unit") or "").rsplit("/", 1)[-1]
            minutes = float(v) * {"Q7727": 1, "Q11574": 1 / 60, "Q25235": 60}.get(unit, 0)
            if minutes:
                rec.setdefault("runtime", minutes)
            continue
        if p == "date":
            # Re-releases add later dates; the earliest one is the original release.
            rec["wd_year"] = min(rec.get("wd_year", "9999"), v[:4])
            continue
        qid = v.rsplit("/", 1)[-1]
        label = val(b, "ko") or val(b, "en") or qid
        items = rec.setdefault(p, {})
        items.setdefault(qid, {"ko": val(b, "ko"), "en": val(b, "en"), "label": label})
    return out


def main(skip_title=False):
    slugs = json.loads(SLUGS.read_text())
    with open(ROOT / "data" / "ratings.csv", encoding="utf-8") as f:
        films = list(csv.DictReader(f))
    raw = json.loads(RAW.read_text()) if RAW.exists() else []
    done = {val(b, "key") for b in raw}
    # Slugs Wikidata does not know return no rows, so remember every slug already asked about.
    # Only trust that list alongside the raw cache it describes.
    queried = set(json.loads(QUERIED.read_text())) if QUERIED.exists() and RAW.exists() else set()

    todo = sorted({slugs[f["Letterboxd URI"]] for f in films if slugs.get(f["Letterboxd URI"])} - done - queried)
    for i in range(0, len(todo), 60):
        batch = todo[i:i + 60]
        raw += by_slug(batch)
        queried.update(batch)
        print(f"slug batch {i // 60 + 1}/{-(-len(todo) // 60)}", flush=True)
        RAW.write_text(json.dumps(raw, ensure_ascii=False))
        QUERIED.write_text(json.dumps(sorted(queried)))
        time.sleep(1)

    meta = collect(raw)
    if skip_title:
        # Keep only films confirmed through their Letterboxd ID.
        raw = [b for b in raw if not val(b, "key").startswith("title:")]
        missing = []
    else:
        missing = [f for f in films if slugs.get(f["Letterboxd URI"]) not in meta and f["Year"]]
        print(f"{len(missing)} films without a Letterboxd link on Wikidata; trying title match", flush=True)
    for f in missing:
        key = "title:" + f["Letterboxd URI"]
        if key in done:
            continue
        raw += by_title(key, f["Name"], int(f["Year"]))
        RAW.write_text(json.dumps(raw, ensure_ascii=False))
        time.sleep(0.5)
    meta = collect(raw)

    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["uri", "slug", "name", "year", "qid", "match", "wd_year", "runtime",
                    "directors", "director_qids", "genres_en", "countries", "types_en"])
        for film in films:
            uri, slug = film["Letterboxd URI"], slugs.get(film["Letterboxd URI"])
            rec, match = meta.get(slug), "slug"
            if rec is None:
                rec, match = meta.get("title:" + uri), "title"
            if rec is None:
                rec, match = {}, ""
            d, g, c, t = (rec.get(k, {}) for k in ("director", "genre", "country", "type"))
            w.writerow([uri, slug, film["Name"], film["Year"], rec.get("qid", ""), match,
                        rec.get("wd_year", ""), round(rec["runtime"]) if "runtime" in rec else "",
                        "|".join(x["label"] for x in d.values()), "|".join(d),
                        "|".join(x["en"] or x["label"] for x in g.values()),
                        "|".join(x["label"] for x in c.values()),
                        "|".join(x["en"] or x["label"] for x in t.values())])
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main(skip_title="--slug-only" in sys.argv)
