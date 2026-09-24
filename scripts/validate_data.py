"""Invariant checks on the built fact layer. Run after build_dataset.py; exits non-zero on failure.

These are consistency checks (structure, counts, dates, provenance), plus a small
regression list of Best Picture winners and nominee counts so that a bad
re-parse of the source pages cannot silently change the core facts.
"""
import json
import sys
from collections import Counter
from pathlib import Path

B = Path(__file__).resolve().parent.parent / "data" / "build"
load = lambda n: json.loads((B / f"{n}.json").read_text())
seasons, ceremonies, films, noms, sources = (load(n) for n in ("seasons", "ceremonies", "films", "nominations", "sources"))
fails = []
check = lambda cond, msg: None if cond else fails.append(msg)

film_ids = {f["id"] for f in films}
source_ids = {s["id"] for s in sources}
cer = {c["id"]: c for c in ceremonies}

# regression: Oscar Best Picture nominee counts per ceremony year (5 / 10 / 5-10 sliding / 10)
EXPECTED_BP_COUNT = {**{y: 5 for y in range(2000, 2010)}, 2010: 10, 2011: 10, 2012: 9, 2013: 9, 2014: 9, 2015: 8,
                     2016: 8, 2017: 9, 2018: 9, 2019: 8, 2020: 9, 2021: 8, **{y: 10 for y in range(2022, 2027)}}
EXPECTED_BP_WINNER = {2000: "American Beauty", 2001: "Gladiator", 2002: "A Beautiful Mind", 2003: "Chicago",
    2004: "The Lord of the Rings: The Return of the King", 2005: "Million Dollar Baby", 2006: "Crash", 2007: "The Departed",
    2008: "No Country for Old Men", 2009: "Slumdog Millionaire", 2010: "The Hurt Locker", 2011: "The King's Speech",
    2012: "The Artist", 2013: "Argo", 2014: "12 Years a Slave", 2015: "Birdman", 2016: "Spotlight", 2017: "Moonlight",
    2018: "The Shape of Water", 2019: "Green Book", 2020: "Parasite", 2021: "Nomadland", 2022: "CODA",
    2023: "Everything Everywhere All at Once", 2024: "Oppenheimer", 2025: "Anora", 2026: "One Battle After Another"}
title = {f["id"]: f["title"] for f in films}

check(len(seasons) == 27, "expected 27 seasons")
for s in seasons:
    y = s["season"]
    check(s["oscar_ordinal"] == y - 1928, f"{y}: ordinal {s['oscar_ordinal']}")
    bp = [n for n in noms if n["season"] == y and n["category"] == "oscar_bp"]
    check(len(bp) == EXPECTED_BP_COUNT[y], f"{y}: {len(bp)} BP nominees, expected {EXPECTED_BP_COUNT[y]}")
    w = [n for n in bp if n["result"] == "won"]
    check(len(w) == 1 and title[w[0]["film_id"]] == EXPECTED_BP_WINNER[y], f"{y}: BP winner {[title[n['film_id']] for n in w]}")
    check(s["oscar_nominations_date"] < s["oscar_date"], f"{y}: nominations date after ceremony")

for c in ceremonies:
    lo, hi = f"{c['film_year']}-11-15", f"{c['season']}-05-01"
    check(lo <= c["date"] <= hi, f"{c['id']}: date {c['date']} outside season window")

per_cat = Counter((n["season"], n["category"]) for n in noms)
wins = Counter((n["season"], n["category"]) for n in noms if n["result"] == "won")
for (y, cat), n in per_cat.items():
    check(n >= 5, f"{cat} {y}: only {n} nominees")
    exp = 2 if (cat, y) == ("pga", 2014) else 1
    check(wins[(y, cat)] == exp, f"{cat} {y}: {wins[(y, cat)]} winners (expected {exp})")
for n in noms:
    check(n["film_id"] in film_ids, f"{n['id']}: unknown film")
    check(n["source_id"] in source_ids, f"{n['id']}: unknown source")
    check(n["ceremony_id"] in cer, f"{n['id']}: unknown ceremony")
    check(n["tie"] == ((n["category"], n["season"]) == ("pga", 2014) and n["result"] == "won"), f"{n['id']}: tie flag")
dups = [k for k, v in Counter((n["season"], n["category"], n["film_id"]) for n in noms).items() if v > 1]
check(not dups, f"duplicate nominations: {dups[:5]}")
for s in sources:
    check(bool(s.get("permalink") or s.get("url")), f"source {s['id']} has no link")

if fails:
    print("\n".join(fails))
    sys.exit(1)
print(f"validate_data OK: {len(noms)} nominations, {len(ceremonies)} ceremonies, {len(films)} films")
