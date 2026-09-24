"""Internal consistency check: category list page vs. the per-ceremony Wikipedia page.

The list pages ("BAFTA Award for Best Film") and the ceremony pages
("73rd British Academy Film Awards") are edited independently, so agreement
between them catches parsing mistakes and one-sided edits. This is NOT an
independent source - official checks live in official_checks.py.

Output: data/interim/crosscheck_ceremony.json
"""
import json
import re
import unicodedata
from pathlib import Path

from fetch_wikipedia import slugify
from resolve_films import resolve
from wikitable import strip_refs, COMMENT_RE, parse_tables

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "wikipedia"
INTERIM = ROOT / "data" / "interim"

ANCHORS = {
    # links to the category article are the most reliable anchors
    "oscar_bp": r"\[\[Academy Award for Best Picture\s*[|\]]",
    "pga": r"\[\[Producers Guild of America Award for Best Theatrical Motion Picture\s*[|\]]",
    "dga": r"\[\[Directors Guild of America Award for Outstanding Directing\s*[–-]\s*Feature Film\s*[|\]]",
    "sag_ensemble": r"\[\[(?:Screen Actors Guild|Actor) Award for Outstanding Performance by a Cast in a Motion Picture\s*[|\]]",
    "bafta_film": r"\[\[BAFTA Award for Best Film\s*[|\]]",
    "gg_drama": r"\[\[Golden Globe Award for Best Motion Picture\s*[–-]\s*Drama\s*[|\]]",
    "gg_musical_comedy": r"\[\[Golden Globe Award for Best Motion Picture\s*[–-]\s*Musical or Comedy\s*[|\]]",
    "cc_picture": r"\[\[Critics' Choice Movie Award for Best Picture\s*[|\]]",
    "wga_original": r"\[\[Writers Guild of America Award for Best Original Screenplay\s*[|\]]|^=+\s*(?:Best )?Original Screenplay\s*=+",
    "wga_adapted": r"\[\[Writers Guild of America Award for Best Adapted Screenplay\s*[|\]]|^=+\s*(?:Best )?Adapted Screenplay\s*=+",
}
ITALIC_LINK = re.compile(r"(''+)\s*\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]")


def _content_lines(text):
    return [l.strip() for l in text.split("\n")
            if l.strip().startswith("*") or ITALIC_LINK.search(l) or UNLINKED_ITALIC.search(l)]


def section_bullets(wikitext, anchor):
    """Return the content lines (winner line + nominee bullets) of one category."""
    text = COMMENT_RE.sub("", strip_refs(wikitext))
    rx = re.compile(anchor, re.I | re.M)
    # 1) categories laid out in tables
    for table in parse_tables(text):
        rows = table["rows"]
        for ri, row in enumerate(rows):
            for ci, cell in enumerate(row["cells"]):
                if not rx.search(cell["text"]):
                    continue
                after = cell["text"][rx.search(cell["text"]).end():]
                own = _content_lines(after)
                if own:
                    return own
                for nxt in rows[ri + 1:]:
                    body = [c for c in nxt["cells"] if not c["header"]]
                    if not body:
                        if any(c["header"] for c in nxt["cells"]):
                            break
                        continue
                    idx = min(ci, len(body) - 1)
                    got = _content_lines(body[idx]["text"])
                    if got:
                        return got
                    break
    # 2) categories laid out as headings / prose + bullet lists
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if not rx.search(line) or line.lstrip().startswith("*"):
            continue
        if re.match(r"\s*\|\s*\w+\s*=", line):  # infobox parameter, not a category section
            continue
        got = []
        for nxt in lines[i + 1:]:
            st = nxt.strip()
            if not st:
                if got:
                    break
                continue
            if st.startswith("*") or ((ITALIC_LINK.search(st) or UNLINKED_ITALIC.search(st))
                                      and not st.startswith(("|", "!", "=", "[[File"))):
                got.append(st)
            elif got:
                break
        if got:
            return got
    return None


# a film link preceded by italic (2 or 5 quotes), not by bold-only (3 quotes)
FILM_LINK_ITALIC = re.compile(r"(?<!')(?:QQ|QQQQQ)(?!')\s*\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]".replace("Q", "'"))
LINK_WITH_ITALIC_LABEL = re.compile(r"\[\[([^\[\]|]+)\|\s*QQ([^\[\]]+?)QQ\s*\]\]".replace("Q", "'"))
UNLINKED_ITALIC = re.compile(r"QQ\s*([^'\[\]]+?)\s*QQ".replace("Q", "'"))
BOLD = "'" * 3


def norm_title(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", t)


def parse_bullets(bullets):
    out = []
    for b in bullets:
        level = len(b) - len(b.lstrip("*"))  # 0 = un-bulleted winner line
        body = b.lstrip("*").strip()
        target = title = None
        m = FILM_LINK_ITALIC.search(body)
        if m:
            target = m.group(1).strip()
        else:
            m2 = LINK_WITH_ITALIC_LABEL.search(body)
            if m2:
                target = m2.group(1).strip()
            else:
                m3 = UNLINKED_ITALIC.search(body.replace(BOLD, ""))
                if m3:
                    title = m3.group(1).strip()
        if not target and not title:
            continue
        out.append({"level": level, "target": target, "title": title, "bold": body.startswith(BOLD)})
    return out


def main():
    rows = json.loads((INTERIM / "wiki_nominations.json").read_text())
    res = json.loads((INTERIM / "title_resolution.json").read_text())
    groups = {}
    for r in rows:
        groups.setdefault((r["category"], r["film_year"], r["ceremony_page"]), []).append(r)
    parsed = {}
    need = set()
    for (cat, year, page), rs in groups.items():
        if cat not in ANCHORS:
            continue
        snap = json.loads((RAW / f"{slugify(page)}.json").read_text())
        bl = section_bullets(snap["wikitext"], ANCHORS[cat])
        items = parse_bullets(bl) if bl else []
        parsed[(cat, year)] = (page, snap, items)
        need.update(i["target"] for i in items if i["target"])
    res = resolve(sorted(need))
    report = []
    for (cat, year, page), rs in sorted(groups.items()):
        if cat not in ANCHORS:
            continue
        page, snap, items = parsed[(cat, year)]
        by_norm = {norm_title(r["shown_title"]): res[r["wiki_target"]]["wikidata"] for r in rs}

        def key(i):
            if i["target"]:
                return res[i["target"]]["wikidata"]
            return by_norm.get(norm_title(i["title"]), "title:" + i["title"])

        list_all = {res[r["wiki_target"]]["wikidata"] for r in rs}
        list_win = {res[r["wiki_target"]]["wikidata"] for r in rs if r["winner_markup"]}
        cer_all = {key(i) for i in items}
        # winners on ceremony pages: bold items at the top level (fallback: all top-level items)
        lvl = min((i["level"] for i in items), default=1)
        top = [i for i in items if i["level"] == lvl]
        cer_win = {key(i) for i in top if i["bold"]} or {key(i) for i in top}
        status = "match"
        notes = []
        if not items:
            status = "not_found"
            notes.append("category section not located on ceremony page")
        else:
            if cer_win != list_win:
                status = "winner_mismatch"
            if cer_all != list_all:
                if status == "match":
                    status = "nominee_mismatch"
                notes.append(f"only_list={sorted(list_all - cer_all)} only_ceremony={sorted(cer_all - list_all)}")
        report.append({"category": cat, "film_year": year, "season": year + 1, "ceremony_page": page,
                       "ceremony_revid": snap["revid"], "status": status,
                       "list_winners": sorted(list_win), "ceremony_winners": sorted(cer_win), "notes": notes})
    (INTERIM / "crosscheck_ceremony.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    from collections import Counter
    print(Counter(r["status"] for r in report))
    for r in report:
        if r["status"] != "match":
            print(r["category"], r["season"], r["status"], r["list_winners"], r["ceremony_winners"], r["notes"])


if __name__ == "__main__":
    main()
