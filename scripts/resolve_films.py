"""Resolve every film wikilink target to its canonical Wikipedia article and Wikidata QID.

Different list pages link the same film through different redirects
("Birdman (film)" vs "Birdman or (The Unexpected Virtue of Ignorance)"), so the
film identity used across the project is the Wikidata item of the article the
link finally lands on - never the displayed title string.
Output: data/interim/title_resolution.json
"""
import json
import time
import urllib.parse
from pathlib import Path

from fetch_wikipedia import get, API

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "interim" / "title_resolution.json"


def resolve(titles):
    result = json.loads(OUT.read_text()) if OUT.exists() else {}
    todo = sorted({t for t in titles if t and t not in result})
    for i in range(0, len(todo), 50):
        chunk = todo[i:i + 50]
        params = {"action": "query", "titles": "|".join(chunk), "redirects": 1, "prop": "pageprops|info",
                  "ppprop": "wikibase_item|disambiguation", "format": "json", "formatversion": 2}
        data = json.loads(get(API + "?" + urllib.parse.urlencode(params)))
        q = data["query"]
        fwd = {}
        for key in ("normalized", "redirects"):
            for m in q.get(key, []):
                fwd[m["from"]] = m["to"]
        pages = {p["title"]: p for p in q["pages"]}
        for t in chunk:
            cur, seen = t, set()
            while cur in fwd and cur not in seen:
                seen.add(cur)
                cur = fwd[cur]
            p = pages.get(cur, {})
            result[t] = {
                "resolved_title": cur,
                "redirected": cur != t,
                "missing": bool(p.get("missing")),
                "pageid": p.get("pageid"),
                "wikidata": (p.get("pageprops") or {}).get("wikibase_item"),
                "disambiguation": "disambiguation" in (p.get("pageprops") or {}),
            }
        print(f"resolved {min(i + 50, len(todo))}/{len(todo)}")
        OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True))
        time.sleep(2)
    return result


if __name__ == "__main__":
    rows = json.loads((ROOT / "data" / "interim" / "wiki_nominations.json").read_text())
    res = resolve([r["wiki_target"] for r in rows])
    bad = {k: v for k, v in res.items() if v["missing"] or not v["wikidata"] or v["disambiguation"]}
    print("problems:", json.dumps(bad, indent=1, ensure_ascii=False))
