"""Resolve boxd.it short links in ratings.csv to Letterboxd film slugs.

Only the redirect Location header is read; film pages are not fetched.
Results are cached in data/cache/slugs.json so reruns skip resolved links.
"""
import csv
import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache" / "slugs.json"
UA = "letterboxd-taste-analysis/0.1 (personal, non-commercial)"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main(limit=None):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    opener = urllib.request.build_opener(NoRedirect)
    with open(ROOT / "data" / "ratings.csv", encoding="utf-8") as f:
        uris = [row["Letterboxd URI"] for row in csv.DictReader(f)]
    todo = [u for u in uris if u not in cache][:limit]
    print(f"{len(todo)} of {len(uris)} links to resolve", flush=True)
    for i, uri in enumerate(todo, 1):
        req = urllib.request.Request(uri, method="HEAD", headers={"User-Agent": UA})
        for attempt in range(3):
            try:
                opener.open(req, timeout=20)
                loc = None
            except urllib.error.HTTPError as e:
                loc = e.headers.get("Location")
            except Exception as e:  # network hiccup: back off and retry
                print(f"retry {uri}: {e}", flush=True)
                time.sleep(2 ** attempt)
                continue
            break
        else:
            loc = None
        slug = loc.rstrip("/").split("/film/")[-1] if loc and "/film/" in loc else None
        cache[uri] = slug
        if i % 50 == 0:
            CACHE.write_text(json.dumps(cache, indent=0))
            print(f"{i}/{len(todo)}", flush=True)
        time.sleep(0.25)
    CACHE.write_text(json.dumps(cache, indent=0))
    print("unresolved:", sum(v is None for v in cache.values()), flush=True)


if __name__ == "__main__":
    main()
