"""Fetch extra Wikidata attributes for the films in data/film_meta.csv.

- sitelinks: number of Wikipedia/Wikimedia pages about the film (fame proxy)
- sequel: the film has a "follows" (P155) statement
- awards: number of distinct "award received" (P166) values
- director gender (P21)
Output: data/film_extra.csv and data/director_gender.csv
"""
import csv
import pathlib
import time

from enrich_wikidata import ROOT, sparql, val

META = ROOT / "data" / "film_meta.csv"


def batched(items, n):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def main():
    with open(META, encoding="utf-8") as f:
        films = [row for row in csv.DictReader(f) if row["qid"]]
    qids = sorted({f["qid"] for f in films})
    dirs = sorted({d for f in films for d in f["director_qids"].split("|") if d})

    extra = {}
    for batch in batched(qids, 150):
        q = f"""SELECT ?film ?links (COUNT(DISTINCT ?award) AS ?awards) (COUNT(DISTINCT ?prev) AS ?prevs) WHERE {{
          VALUES ?film {{ {' '.join('wd:' + x for x in batch)} }}
          ?film wikibase:sitelinks ?links .
          OPTIONAL {{ ?film wdt:P166 ?award }}
          OPTIONAL {{ ?film wdt:P155 ?prev }}
        }} GROUP BY ?film ?links"""
        for b in sparql(q):
            extra[val(b, "film").rsplit("/", 1)[-1]] = (val(b, "links"), val(b, "awards"), val(b, "prevs"))
        print(f"films {len(extra)}/{len(qids)}", flush=True)
        time.sleep(1)

    gender = {}
    for batch in batched(dirs, 200):
        q = f"""SELECT ?d ?g WHERE {{
          VALUES ?d {{ {' '.join('wd:' + x for x in batch)} }}
          ?d wdt:P21 ?g .
        }}"""
        for b in sparql(q):
            gender.setdefault(val(b, "d").rsplit("/", 1)[-1], val(b, "g").rsplit("/", 1)[-1])
        print(f"directors {len(gender)}/{len(dirs)}", flush=True)
        time.sleep(1)

    with open(ROOT / "data" / "film_extra.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["qid", "sitelinks", "awards", "sequel"])
        for q, (links, awards, prevs) in sorted(extra.items()):
            w.writerow([q, links, awards, int(int(prevs) > 0)])
    labels = {"Q6581097": "male", "Q6581072": "female"}
    with open(ROOT / "data" / "director_gender.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["director_qid", "gender"])
        for d, g in sorted(gender.items()):
            w.writerow([d, labels.get(g, "other")])
    print("done", flush=True)


if __name__ == "__main__":
    main()
