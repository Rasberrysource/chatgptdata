"""Parse the Wikipedia award list snapshots into flat nomination rows.

Output: data/interim/wiki_nominations.json
Each row keeps the raw wikitext of the film cell, the wikilink target, the
winner signal(s) that were detected, and the page revision it came from.
Nothing here is interpreted beyond "this row is marked as the winner".
"""
import json
import re
from pathlib import Path

from wikitable import parse_tables, links, plain, cell_markup_kind, strip_refs, URL_RE

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "wikipedia"
OUT = ROOT / "data" / "interim"

FIRST_FILM_YEAR, LAST_FILM_YEAR = 1999, 2025  # Oscar ceremonies 2000..2026

PAGES = [
    # category_id, snapshot file, layout
    ("oscar_bp", "Academy_Award_for_Best_Picture", "film"),
    ("pga", "Producers_Guild_of_America_Award_for_Best_Theatrical_Motion_Picture", "film"),
    ("dga", "Directors_Guild_of_America_Award_for_Outstanding_Directing___Feature_Film", "person_film"),
    ("sag_ensemble", "Screen_Actors_Guild_Award_for_Outstanding_Performance_by_a_Cast_in_a_Motion_Picture", "film"),
    ("bafta_film", "BAFTA_Award_for_Best_Film", "film"),
    ("gg_drama", "Golden_Globe_Award_for_Best_Motion_Picture___Drama", "film"),
    ("gg_musical_comedy", "Golden_Globe_Award_for_Best_Motion_Picture___Musical_or_Comedy", "film"),
    ("cc_picture", "Critics__Choice_Movie_Award_for_Best_Picture", "film"),
    ("wga_original", "Writers_Guild_of_America_Award_for_Best_Original_Screenplay", "film"),
    ("wga_adapted", "Writers_Guild_of_America_Award_for_Best_Adapted_Screenplay", "film"),
    # context only (not a precursor): used as documented evidence that a film was classified
    # as a foreign-language film and therefore excluded from the Best Motion Picture categories
    ("gg_foreign_language", "Golden_Globe_Award_for_Best_Motion_Picture___Non_English_Language", "film"),
]

HIGHLIGHT_RE = re.compile(r"#(?:FAEB86|B0C4DE|FFD700|F0E68C)", re.I)
YEAR_RE = re.compile(r"^\(?((?:19|20)\d\d)\b")


def is_year_cell(cell):
    kind = cell_markup_kind(cell["text"])
    if kind in ("italic", "bolditalic"):
        return None
    txt = plain(cell["text"])
    m = YEAR_RE.match(txt)
    if not m:
        return None
    return int(m.group(1))


def ceremony_link(text):
    for target, label in links(strip_refs(text)):
        if re.search(r"award|oscar|globe|bafta|guild", target, re.I) and " in film" not in target:
            return target
    return None


def film_from_cell(text):
    body = strip_refs(text)
    lk = [(t, l) for t, l in links(body) if not re.match(r"(?i)(file|image|category):", t)]
    target, label = (lk[0] if lk else (None, None))
    if label:
        shown = plain(label)
    else:  # unlinked title: first italic run
        m = re.search(r"''+\s*(.+?)\s*''+", body, re.S)
        shown = plain(m.group(1)) if m else plain(body)
    shown = re.sub(r"\s*[†‡*§]+\s*$", "", shown).strip()
    return target, (plain(label) if label else None), shown


def parse_page(cat, fname, layout):
    snap = json.loads((RAW / f"{fname}.json").read_text())
    rows_out = []
    for t_index, table in enumerate(parse_tables(snap["wikitext"])):
        group = None
        for row in table["rows"]:
            cells = row["cells"]
            if not cells:
                continue
            rest = list(cells)
            y = is_year_cell(cells[0])
            if y is not None:
                refs = []
                strip_refs(cells[0]["text"], refs)
                group = {"film_year": y, "ceremony_page": ceremony_link(cells[0]["text"]),
                         "year_cell": cells[0]["text"], "refs": refs, "n": 0}
                rest = cells[1:]
            if group is None or not rest:
                continue
            # sub-header rows (e.g. WGA drama/comedy split in old years)
            if all(c["header"] for c in rest):
                continue
            if layout == "person_film":
                film_cells = [c for c in rest if cell_markup_kind(c["text"]) in ("italic", "bolditalic")]
                if not film_cells:
                    continue
                fc = film_cells[0]
                person_cell = rest[0] if rest[0] is not fc else None
            else:
                fc = rest[0]
                person_cell = rest[1] if len(rest) > 1 else None
            kind = cell_markup_kind(fc["text"])
            if kind not in ("italic", "bolditalic"):
                # unexpected layout; keep for inspection
                pass
            for c in rest:
                refs = []
                strip_refs(c["text"], refs)
                group["refs"].extend(refs)
            target, label, shown = film_from_cell(fc["text"])
            bold_person = person_cell is not None and cell_markup_kind(person_cell["text"]) in ("bold", "bolditalic")
            highlighted = bool(HIGHLIGHT_RE.search(fc["attrs"] or "")) or bool(HIGHLIGHT_RE.search(row["attrs"] or ""))
            winner_markup = kind == "bolditalic" or (layout == "person_film" and bold_person)
            group["n"] += 1
            rows_out.append({
                "category": cat,
                "film_year": group["film_year"],
                "ceremony_page": group["ceremony_page"],
                "order_in_year": group["n"],
                "wiki_target": target,
                "wiki_label": label,
                "shown_title": shown,
                "markup": kind,
                "winner_markup": winner_markup,
                "cell_highlight": highlighted,
                "person_text": plain(person_cell["text"]) if person_cell else None,
                "raw_cell": strip_refs(fc["text"]).strip(),
                "_table": t_index,
                "_group": group,
            })
    # some pages also have summary tables ("records", "multiple wins"); for each
    # year keep the table that lists the most nominees for it (the main list)
    counts = {}
    for r in rows_out:
        k = (r["film_year"], r["_table"])
        counts[k] = counts.get(k, 0) + 1
    best = {}
    for (y, t), n in sorted(counts.items()):
        if y not in best or n > counts[(y, best[y])]:
            best[y] = t
    rows_out = [r for r in rows_out if r.pop("_table") == best[r["film_year"]]]
    # attach refs per group (dedup) and filter years
    out = []
    for r in rows_out:
        g = r.pop("_group")
        if not (FIRST_FILM_YEAR <= r["film_year"] <= LAST_FILM_YEAR):
            continue
        urls = []
        for ref in g["refs"]:
            for u in URL_RE.findall(ref):
                if u not in urls and "web.archive.org" not in u:
                    urls.append(u)
        r["group_ref_urls"] = urls
        r["source"] = {"page": snap["title"], "revid": snap["revid"], "permalink": snap["permalink"],
                       "rev_timestamp": snap["rev_timestamp"]}
        out.append(r)
    return out


def main():
    allrows = []
    for cat, fname, layout in PAGES:
        rows = parse_page(cat, fname, layout)
        allrows.extend(rows)
        by_year = {}
        for r in rows:
            by_year.setdefault(r["film_year"], []).append(r)
        print(f"{cat}: {len(rows)} rows, years {min(by_year)}-{max(by_year)}")
        for y in range(FIRST_FILM_YEAR, LAST_FILM_YEAR + 1):
            rs = by_year.get(y, [])
            w = [r for r in rs if r["winner_markup"]]
            flag = "" if len(w) == 1 else "  <-- winners=%d" % len(w)
            mism = [r["shown_title"] for r in rs if r["winner_markup"] != r["cell_highlight"]]
            print(f"   {y}: n={len(rs)} W={'; '.join(r['shown_title'] for r in w)}{flag}"
                  + (f"  [highlight mismatch: {mism}]" if mism else ""))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "wiki_nominations.json").write_text(json.dumps(allrows, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
