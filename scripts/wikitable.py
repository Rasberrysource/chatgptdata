"""Minimal, dependency-free wikitext table reader for Wikipedia award list pages.

It does not try to render wikitext. It only splits tables into rows and cells,
keeps cell attributes separate from content, and exposes helpers to pull
wikilinks / italic titles / bold markers out of a cell.
"""
import re

REF_RE = re.compile(r"<ref(?:\s[^>/]*)?/>|<ref(?:\s[^>]*)?>.*?</ref>", re.S | re.I)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
LINK_RE = re.compile(r"\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]")
URL_RE = re.compile(r"https?://[^\s|}\]<]+")


def strip_refs(text, sink=None):
    """Remove <ref> tags. If sink is a list, the ref bodies are appended to it."""
    def repl(m):
        if sink is not None:
            sink.append(m.group(0))
        return ""
    return REF_RE.sub(repl, text)


def split_top(s, sep):
    """Split s on sep only where not nested inside [[ ]], {{ }} or <...>."""
    parts, buf, depth_sq, depth_br, i = [], [], 0, 0, 0
    n = len(s)
    while i < n:
        two = s[i:i + 2]
        if two == "[[":
            depth_sq += 1; buf.append(two); i += 2; continue
        if two == "]]" and depth_sq:
            depth_sq -= 1; buf.append(two); i += 2; continue
        if two == "{{":
            depth_br += 1; buf.append(two); i += 2; continue
        if two == "}}" and depth_br:
            depth_br -= 1; buf.append(two); i += 2; continue
        if depth_sq == 0 and depth_br == 0 and s.startswith(sep, i):
            parts.append("".join(buf)); buf = []; i += len(sep); continue
        buf.append(s[i]); i += 1
    parts.append("".join(buf))
    return parts


ATTR_RE = re.compile(r"^\s*(?:[a-zA-Z-]+\s*=\s*(?:\"[^\"]*\"?|'[^']*'|[^\s|]+)\s*)+$")


def split_attr(cell):
    """'style="x" | content' -> ('style="x"', 'content'). Only if the left side looks like attributes."""
    parts = split_top(cell, "|")
    if len(parts) >= 2 and ATTR_RE.match(parts[0] or ""):
        return parts[0].strip(), "|".join(parts[1:]).strip()
    # tolerate the malformed `style= text-align:left;"` seen on some pages
    if len(parts) >= 2 and re.match(r"^\s*(style|align|rowspan|colspan|bgcolor|scope)\b", parts[0] or "", re.I) \
            and "[[" not in parts[0] and "''" not in parts[0]:
        return parts[0].strip(), "|".join(parts[1:]).strip()
    return "", cell.strip()


def parse_tables(wikitext):
    """Yield tables as lists of rows; each row is dict(attrs, cells=[dict(header, attrs, text)])."""
    text = COMMENT_RE.sub("", wikitext)
    # refs (and the cite templates inside them) sometimes span several lines;
    # collapse them so a continuation line starting with "|" is not read as a cell
    text = REF_RE.sub(lambda m: m.group(0).replace("\n", " "), text)
    lines = text.split("\n")
    tables, stack = [], []
    for raw in lines:
        line = raw.strip()
        if line.startswith("{|"):
            stack.append({"attrs": line[2:].strip(), "rows": [], "pre_rows": []})
            continue
        if not stack:
            continue
        tbl = stack[-1]
        if line.startswith("|}"):
            tables.append(stack.pop())
            continue
        if line.startswith("|+"):
            tbl["caption"] = line[2:].strip()
            continue
        if line.startswith("|-"):
            tbl["rows"].append({"attrs": line[2:].strip(), "cells": []})
            continue
        if line.startswith("!") or line.startswith("|"):
            if not tbl["rows"]:
                tbl["rows"].append({"attrs": "", "cells": []})
            header = line.startswith("!")
            body = line[1:]
            sep = "!!" if header else "||"
            chunks = split_top(body, sep)
            if header and len(chunks) == 1:
                chunks = split_top(body, "||")
            for ch in chunks:
                attrs, content = split_attr(ch)
                tbl["rows"][-1]["cells"].append({"header": header, "attrs": attrs, "text": content})
            continue
        # continuation line of the previous cell
        if tbl["rows"] and tbl["rows"][-1]["cells"]:
            tbl["rows"][-1]["cells"][-1]["text"] += "\n" + raw
    return tables


def links(text):
    return [(m.group(1).strip(), (m.group(2) if m.group(2) is not None else m.group(1)).strip())
            for m in LINK_RE.finditer(text)]


def plain(text):
    """Very rough wikitext -> plain text (links to labels, drop templates/markup)."""
    t = strip_refs(text)
    t = LINK_RE.sub(lambda m: m.group(2) if m.group(2) is not None else m.group(1), t)
    # {{small|x}} / {{center|x}} / {{nowrap|x}} -> x ; other templates dropped
    unwrap = re.compile(r"\{\{\s*(?:small|center|nowrap|nobold|lang\|[a-z-]+)\s*\|([^{}]*)\}\}", re.I)
    for _ in range(5):
        prev = t
        t = unwrap.sub(r"\1", t)
        if t == prev:
            t = re.sub(r"\{\{[^{}]*\}\}", "", t)
            if t == prev:
                break
    t = re.sub(r"<br\s*/?>", " ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("'''", "").replace("''", "")
    t = t.replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", t).strip()


def cell_markup_kind(text):
    """Return 'bolditalic', 'bold', 'italic' or None from the leading markup of a cell."""
    t = strip_refs(text).strip()
    t = re.sub(r"^\{\{\s*(?:center|nowrap)\s*\|", "", t, flags=re.I)
    t = re.sub(r"^\{\{\s*sort\s*\|[^|{}]*\|", "", t, flags=re.I)
    t = re.sub(r"^<span[^>]*>", "", t)
    if t.startswith("'''''"):
        return "bolditalic"
    if t.startswith("'''"):
        rest = t[3:].lstrip()
        return "bolditalic" if rest.startswith("''") else "bold"
    if t.startswith("''"):
        rest = t[2:].lstrip()
        if rest.startswith("'''") or re.match(r"^\[\[[^\]|]*\|\s*'''", rest):
            return "bolditalic"
        return "italic"
    return None
