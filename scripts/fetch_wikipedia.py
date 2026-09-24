"""Fetch Wikipedia wikitext snapshots (with revision ids) for the award pages we parse.

Snapshots are stored under data/raw/wikipedia/<slug>.json so parsing is reproducible
and every parsed value can cite an exact page revision (oldid permalink).
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "wikipedia"
UA = "OscarRaceLab/0.1 (personal research project; https://github.com/Rasberrysource/chatgptdata)"
API = "https://en.wikipedia.org/w/api.php"


def slugify(title):
    return "".join(c if c.isalnum() else "_" for c in title).strip("_")


def get(url, tries=8):
    delay = 5
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                wait = int(e.headers.get("retry-after") or delay)
                print(f"  {e.code}, waiting {wait}s", file=sys.stderr)
                time.sleep(wait + 1)
                delay = min(delay * 2, 60)
                continue
            raise
        except Exception as e:  # network hiccup
            print(f"  error {e}, retry in {delay}s", file=sys.stderr)
            time.sleep(delay)
            delay = min(delay * 2, 60)
    raise RuntimeError(f"failed: {url}")


def fetch(title, force=False):
    path = OUT / f"{slugify(title)}.json"
    if path.exists() and not force:
        return json.loads(path.read_text())
    params = {
        "action": "query", "prop": "revisions", "titles": title, "redirects": 1,
        "rvprop": "ids|timestamp|content", "rvslots": "main",
        "format": "json", "formatversion": 2,
    }
    data = json.loads(get(API + "?" + urllib.parse.urlencode(params)))
    page = data["query"]["pages"][0]
    if page.get("missing"):
        raise RuntimeError(f"missing page: {title}")
    rev = page["revisions"][0]
    snap = {
        "requested_title": title,
        "title": page["title"],
        "pageid": page["pageid"],
        "revid": rev["revid"],
        "rev_timestamp": rev["timestamp"],
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "permalink": f"https://en.wikipedia.org/w/index.php?oldid={rev['revid']}",
        "wikitext": rev["slots"]["main"]["content"],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snap, ensure_ascii=False, indent=1))
    time.sleep(1.5)
    return snap


if __name__ == "__main__":
    titles = sys.argv[1:] or [l.strip() for l in sys.stdin if l.strip()]
    for t in titles:
        s = fetch(t)
        print(f"{t} -> {s['title']} rev {s['revid']} ({len(s['wikitext'])} chars)")


def fetch_many(titles, force=False, batch=20):
    """Fetch several pages per API request (multi-page mode returns the latest revision of each)."""
    todo = [t for t in titles if force or not (OUT / f"{slugify(t)}.json").exists()]
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        params = {
            "action": "query", "prop": "revisions", "titles": "|".join(chunk), "redirects": 1,
            "rvprop": "ids|timestamp|content", "rvslots": "main", "format": "json", "formatversion": 2,
        }
        got = {}
        cont = {}
        while True:
            data = json.loads(get(API + "?" + urllib.parse.urlencode({**params, **cont})))
            q = data.get("query", {})
            redirect_map = {}
            for key in ("normalized", "redirects"):
                for m in q.get(key, []):
                    redirect_map[m["to"]] = redirect_map.get(m["from"], m["from"])
            for page in q.get("pages", []):
                if page.get("missing") or not page.get("revisions"):
                    continue
                rev = page["revisions"][0]
                if "slots" not in rev:
                    continue
                req = page["title"]
                while req in redirect_map:
                    req = redirect_map[req]
                got[page["title"]] = {
                    "requested_title": req,
                    "title": page["title"],
                    "pageid": page["pageid"],
                    "revid": rev["revid"],
                    "rev_timestamp": rev["timestamp"],
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "permalink": f"https://en.wikipedia.org/w/index.php?oldid={rev['revid']}",
                    "wikitext": rev["slots"]["main"]["content"],
                }
            if "continue" in data:
                cont = data["continue"]
                continue
            break
        for snap in got.values():
            (OUT / f"{slugify(snap['requested_title'])}.json").write_text(json.dumps(snap, ensure_ascii=False, indent=1))
        missing = [t for t in chunk if not (OUT / f"{slugify(t)}.json").exists()]
        print(f"batch {i // batch + 1}: got {len(got)}; missing {missing}")
        time.sleep(2)
