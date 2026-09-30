#!/usr/bin/env python3
"""Check a Screens in Schools results link the way the page reads it.

Usage:
    python3 tools/check_results_url.py 'https://…/sis-results/#a=educator&when=1&…'
    pbpaste | python3 tools/check_results_url.py          # one URL per line on stdin

Wrap URLs in single quotes: & and # mean something to the shell.

For each link it reports the audience the page will show, every parameter that page reads (its value and
whether the page recognizes it), which are missing, and anything the page ignores. The answer tables and
parameter map are read from app.js itself, so this can't drift from the page. Exit status is 1 if any value
is unrecognized or still contains unpiped Qualtrics text.
"""
import argparse
import os
import re
import sys
from urllib.parse import parse_qsl, urlsplit

AUDIENCES = ["student", "educator", "elementary"]
STR = r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\""


def js_str(tok):
    return re.sub(r"\\(.)", r"\1", tok[1:-1])


def load_page(path):
    """Answer tables ({name: {code: label}}) and PARAMS ({audience: {param: (key, kind, table)}}) from app.js."""
    src = open(path, encoding="utf-8").read()
    tables = {}
    for name, body in re.findall(r"var (\w+) = \[(.*?)\];", src, re.S):
        rows = re.findall(r"\[\s*(%s)\s*,\s*(%s)\s*,\s*(\d+)\s*\]" % (STR, STR), body)
        if rows:
            tables[name] = {int(c): js_str(label) for label, _, c in rows}
        elif re.fullmatch(r"\s*(?:(?:%s)\s*,?\s*)+" % STR, body):  # plain list of labels, e.g. HRS
            tables[name] = {i: js_str(t) for i, t in enumerate(re.findall(STR, body))}
    for name, base in re.findall(r"var (\w+) = (\w+)\.map\(function \(l, k\) \{ return \[l, '', k\]; \}\);", src):
        tables[name] = dict(tables[base])  # e.g. HOURS = HRS with index codes
    block = re.search(r"var PARAMS = \{(.*?)\n  \};", src, re.S)
    if not block:
        sys.exit(f"Couldn't find PARAMS in {path}; has app.js changed shape?")
    params = {}
    for aud, body in re.findall(r"(\w+): \{(.*?)\}", block.group(1), re.S):
        params[aud] = {p: (key, kind, tables.get(tbl) if tbl else None)
                       for p, key, kind, tbl in re.findall(r"(\w+): \['(\w+)', '(\w+)'(?:, (\w+))?\]", body)}
    for aud in AUDIENCES:
        if aud not in params:
            sys.exit(f"app.js has no PARAMS.{aud}")
    return params


def read_url(url):
    """Mirror of readParams() in app.js: #fragment wins over ?query; first occurrence of a key counts."""
    parts = urlsplit(url.strip())
    q, h = {}, {}
    for k, v in parse_qsl(parts.query, keep_blank_values=True):
        q.setdefault(k, v)
    for k, v in parse_qsl(parts.fragment, keep_blank_values=True):
        h.setdefault(k, v)
    merged = dict(q)
    merged.update(h)
    return merged, parts


def code(s):
    s = str(s).strip()
    return int(s) if re.fullmatch(r"\d{1,3}", s) else None


def check(url, params):
    got, parts = read_url(url)
    problems = 0
    a = (got.get("a") or "").lower()
    audience = a if a in AUDIENCES else "student"
    level = str(got.get("level") or "").strip()
    how = f"a={a or '(none)'}" + ("" if a in AUDIENCES else " → not a known audience, page falls back to student")
    if audience != "student" and level:
        audience = "elementary" if level == "1" else "educator"
        how += f", level={level} → {'elementary' if level == '1' else 'MS/HS'} page"
    print(url.strip())
    print(f"  Audience: {audience}  ({how})")
    if parts.path and not parts.path.endswith("/") and not parts.path.endswith(".html"):
        print(f"  Note: path {parts.path!r} has no trailing slash; GitHub Pages will redirect it.")
    if parts.query and parts.fragment:
        print("  Note: answers in both ?query and #fragment; the #fragment wins for any key in both.")

    spec = params[audience]
    ok = missing = bad = 0
    for p, (key, kind, table) in spec.items():
        raw = got.get(p)
        shown = "" if raw is None else raw
        if raw is None or raw.strip() == "":
            status = "MISSING (not in link)" if raw is None else "MISSING (empty: not answered or not shown)"
            missing += 1
        elif "${" in raw or "q://" in raw:
            status = "NOT PIPED: Qualtrics placeholder text (copied from the editor or a preview?)"
            bad += 1
        elif kind == "scale":
            c = code(raw)
            if c is not None and c <= 100 and c % 10 == 0:
                status, ok = f"OK → {c // 10} on the 0–10 scale", ok + 1
            else:
                hint = " (looks like a 0–10 value; the link should pipe the 0–100 recode)" if c is not None and c <= 10 else ""
                status, bad = f"NOT RECOGNIZED: expected 0, 10, 20 … 100{hint}", bad + 1
        elif kind == "multi":
            pieces = [x for x in re.split(r"[\s,]+", raw) if x]
            hits = [table[c] for c in map(code, pieces) if c in table]
            misses = [x for x in pieces if code(x) not in table]
            if hits:
                status = "OK → " + "; ".join(dict.fromkeys(hits)) + " (YOU on each; headline uses the first)"
                ok += 1
                if misses:
                    status += f"; ignored: {', '.join(misses)}"
            else:
                status, bad = f"NOT RECOGNIZED: expected codes {sorted(table)}", bad + 1
        else:
            c = code(raw)
            if c in table:
                status, ok = f"OK → {table[c]}", ok + 1
            else:
                status, bad = "NOT RECOGNIZED: expected " + ", ".join(f"{k}={v}" for k, v in table.items()), bad + 1
        print(f"  {p:<11}= {shown:<10} {status}")
    extra = [k for k in got if k not in spec and k not in ("a", "level")]
    if extra:
        print("  Not read on this page: " + ", ".join(f"{k}={got[k]}" for k in extra))
    print(f"  Summary: {ok} recognized, {missing} missing, {bad} not recognized\n")
    problems += bad
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("urls", nargs="*", help="results links (or one per line on stdin)")
    ap.add_argument("--app", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app.js"),
                    help="path to the page's app.js (default: the one in this repo)")
    args = ap.parse_args()
    urls = args.urls or [line for line in sys.stdin if line.strip()]
    if not urls:
        ap.error("give at least one URL")
    params = load_page(args.app)
    bad = sum(check(u, params) for u in urls)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
