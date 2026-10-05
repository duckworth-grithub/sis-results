#!/usr/bin/env python3
"""Check a Screens in Schools results link the way the page reads it.

Usage:
    python3 tools/check_results_url.py 'https://results.screensinschools.org/#a=educator&when=1&…'
    pbpaste | python3 tools/check_results_url.py          # one URL per line on stdin

Wrap URLs in single quotes: & and # mean something to the shell.

For each link it reports the audience the page will show, every parameter that page reads (its value and
whether the page recognizes it), which are missing, and anything the page ignores. The answer tables and
parameter map are read from app.js itself, so this can't drift from the page. It accepts answers in #fragment or ?query and
codes or labels, says which format it saw, and gives a verdict on whether a failure is Qualtrics-side (unpiped
${q://…}, labels instead of codes, &amp;, empty values) or page-side. Exit status is 1 if anything wouldn't work.
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
    return merged, parts, q, h


def code(s):
    s = str(s).strip()
    return int(s) if re.fullmatch(r"\d{1,3}", s) else None


def norm(s):
    """Lower-case text with HTML, curly quotes and extra spaces removed, for matching piped labels."""
    s = re.sub(r"<[^>]+>", " ", str(s)).replace("\u2018", "'").replace("\u2019", "'").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


def as_label(raw, table):
    """If raw is choice text rather than a code, the option it matches (or None)."""
    v = norm(raw)
    for c, label in table.items():
        l = norm(label)
        if v == l or v.startswith(l) or l.startswith(v) or l.split(" (")[0] and v.startswith(l.split(" (")[0]):
            return c, label
    return None


def unpiped(raw):
    return "q://" in raw or "${" in raw or re.search(r"%7B|%7D|%24", raw, re.I)


def check(url, params):
    got, parts, q, h = read_url(url)
    print(url.strip())
    # Link-level problems that stop the page seeing anything
    amp = [k for k in got if k.startswith("amp;")]
    if amp:
        print("  PROBLEM: '&amp;' in the link (keys " + ", ".join(amp) + "). The HTML-escaped & was copied into the href,")
        print("           so the page sees 'amp;when' instead of 'when'. Retype the & signs in the link, not in the HTML.")
        for k in amp:
            got.setdefault(k[4:], got[k])
    where = "#fragment" if h and not q else "?query" if q and not h else "both ?query and #fragment" if q and h else "nowhere"
    a = (got.get("a") or "").lower()
    if a not in AUDIENCES:
        print(f"  Audience: none (a={a or '(missing)'}) → the page redirects to https://screensinschools.org")
        print("  Verdict: this link never shows a report. Add a=educator, a=elementary or a=student.\n")
        return 1
    audience = a
    level = str(got.get("level") or "").strip()
    how = f"a={a}"
    if audience != "student" and level:
        audience = "elementary" if level == "1" else "educator"
        how += f", level={level} → {'elementary' if level == '1' else 'MS/HS'} page"
    print(f"  Audience: {audience}  ({how})")
    if parts.path and not parts.path.endswith("/") and not parts.path.endswith(".html"):
        print(f"  Note: path {parts.path!r} has no trailing slash; GitHub Pages will redirect it.")
    if q and h:
        print("  Note: answers in both ?query and #fragment; the #fragment wins for any key in both.")

    spec = params[audience]
    ok = missing = bad = 0
    kinds = {"codes": 0, "labels": 0, "% labels (accepted)": 0, "placeholders": 0, "other": 0}
    for p, (key, kind, table) in spec.items():
        raw = got.get(p)
        shown = "" if raw is None else raw
        if raw is None or raw.strip() == "":
            status = "MISSING (not in link)" if raw is None else "MISSING (empty: not answered or not shown)"
            missing += 1
        elif unpiped(raw):
            status, bad = "NOT PIPED: Qualtrics placeholder text reached the page (Qualtrics-side)", bad + 1
            kinds["placeholders"] += 1
        elif kind == "scale":
            # Mirror of toScale() in app.js: recode 0–100 step 10, a "70%"-style label, or a bare 1–9.
            pct = re.match(r"\s*(\d{1,3})\s*%", raw)
            c = int(pct.group(1)) if pct else code(raw)
            if c is not None and c <= 100 and c % 10 == 0:
                status, ok = f"OK → {c // 10} on the 0–10 scale" + (" (from a % label)" if pct else ""), ok + 1
                kinds["% labels (accepted)" if pct else "codes"] += 1
            elif c is not None and not pct and 1 <= c <= 9:
                status, ok = f"OK → {c} (already on the 0–10 scale)", ok + 1
                kinds["codes"] += 1
            else:
                status, bad = "NOT RECOGNIZED: expected 0, 10, 20 … 100, a 70%-style label, or 1–9", bad + 1
                kinds["codes" if c is not None else "other"] += 1
        else:
            pieces = [x for x in re.split(r"[\s,]+", raw) if x] if kind == "multi" and all(code(x) is not None for x in re.split(r"[\s,]+", raw) if x) else [raw]
            hits = [table[c] for c in map(code, pieces) if c in table]
            if hits:
                kinds["codes"] += 1
                ok += 1
                status = "OK → " + "; ".join(dict.fromkeys(hits))
                if kind == "multi":
                    status += " (read, but the chart shows data only: no YOU)"
                misses = [x for x in pieces if code(x) not in table]
                if misses:
                    status += f"; ignored: {', '.join(misses)}"
            else:
                lab = as_label(raw, table) if code(raw) is None else None
                if lab:
                    kinds["labels"] += 1
                    status = f"LABEL, not a code: page ignores it (matches {lab[0]}={lab[1]!r}; use SelectedChoicesRecode)"
                else:
                    kinds["codes" if code(raw) is not None else "other"] += 1
                    status = "NOT RECOGNIZED: expected " + ", ".join(f"{k}={v}" for k, v in table.items())
                bad += 1
        print(f"  {p:<11}= {shown[:40]:<10} {status}")
    lib = str(got.get("role") or "").strip().lower() == "librarian"
    if lib:
        print("  Librarian page (role=librarian): YOU on their answers; only sections with a recognized answer are shown"
              " (plus AI on the educator page), after the library checkouts section every librarian sees; no green highlights.")
    extra = [k for k in got if k not in spec and k not in ("a", "level", "role") and not k.startswith("amp;")]
    if extra:
        print("  Not read on this page: " + ", ".join(f"{k}={got[k]}" for k in extra))
    seen = ", ".join(f"{n} {k}" for k, n in kinds.items() if n) or "no values"
    print(f"  Format: answers in {where}; values seen: {seen}")
    print(f"  Summary: {ok} recognized, {missing} missing, {bad} not recognized"
          + (" (recognized only once the &amp; is fixed; as-is the page reads none of them)" if amp else ""))
    if kinds["placeholders"]:
        print("  Verdict: Qualtrics-side. Piped text wasn't filled in (link copied from the editor/preview, or the")
        print("           editor URL-encoded the ${…}). Check the href in the message's HTML view.")
    elif kinds["labels"]:
        print("  Verdict: Qualtrics-side. The link pipes choice text; change SelectedChoices to SelectedChoicesRecode.")
    elif amp:
        print("  Verdict: Qualtrics-side. Fix the &amp; in the href.")
    elif ok == 0 and missing and lib:
        print("  Verdict: librarian with no answers (e.g. district): " + ("only the AI section." if audience == "educator" else "a one-line note, no charts."))
    elif ok == 0 and missing and ("preview" in got or audience == "student"):
        print("  Verdict: generic view by design (" + ("preview link" if "preview" in got else "student links carry no answers") + "); no YOU marks.")
    elif ok == 0 and missing:
        print("  Verdict: Qualtrics-side. Every answer is empty: wrong QIDs for this survey/branch, or questions not shown.")
    elif bad:
        print("  Verdict: some values are out of range for the page; see NOT RECOGNIZED lines.")
    else:
        print("  Verdict: the link is fine; the page will show YOU on every recognized answer that has a YOU chart.")
    print()
    return bad + len(amp)


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
