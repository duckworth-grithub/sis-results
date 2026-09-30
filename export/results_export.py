"""Screens in Schools — results aggregator.

Pulls ONLY the whitelisted questions from Qualtrics, aggregates per audience,
writes results-data.json. Raw responses live in memory only.

Env vars (set as scheduler secrets):
  QUALTRICS_TOKEN        API token (read-only user recommended)
  QUALTRICS_DATACENTER   "yul1" (from Account Settings → Qualtrics IDs)
  SURVEY_TEEN            SV_6LFWjsZ51O8XInY  (from SIS_Student_2026-2027.qsf)
  SURVEY_EDUCATOR        SV_bxUuSACfns11z5s
  MIN_N                  default 10
  OUT                    default results-data.json
"""
import io, json, os, sys, time, zipfile
from datetime import datetime, timezone
import requests

TOKEN = os.environ["QUALTRICS_TOKEN"]
DC = os.environ["QUALTRICS_DATACENTER"]
MIN_N = int(os.environ.get("MIN_N", "10"))
OUT = os.environ.get("OUT", "results-data.json")
# When the 3-point screen-time question went live (ISO time, e.g. "2026-09-25T14:00:00Z"). Optional; see SCREEN_5PT.
SCREEN_5PT_UNTIL = os.environ.get("SCREEN_5PT_UNTIL", "").strip() or None
BASE = f"https://{DC}.qualtrics.com/API/v3"
H = {"X-API-TOKEN": TOKEN, "Content-Type": "application/json"}

# --- Codebooks: Qualtrics recode value -> label published in results-data.json -----
# Recodes come from the 2026-27 .qsf files. Keying on recodes (not choice text) is
# deliberate: the live choice text carries HTML and explainer sub-lines.
WHEN = {1: "Bell-to-bell", 2: "Schedule-based restriction", 3: "No school-wide restriction"}
WHERE = {1: "Phones cannot be brought into school at all", 2: "Centralized collection", 3: "Yondr pouches or similar",
         4: "Lockers only", 5: "Classroom collection", 6: "'No show' (out of sight)", 7: "No school-wide policy"}
YESNO = {1: "Yes", 0: "No"}
SCREEN = {1: "Too low", 2: "About right", 3: "Too high"}
# QID49/QID36 were 5-point until the week of Sep 21-28, 2026, and the edit reused codes 1-3 with new meanings:
# old 1 Much too low, 2 A little too low, 3 About right, 4 A little too high, 5 Much too high.
SCREEN_5PT = {1: "Too low", 2: "Too low", 3: "About right", 4: "Too high", 5: "Too high"}
# Without SCREEN_5PT_UNTIL we can't tell an old 2/3 from a new one, so 1-3 are read as current and only
# 4/5 (which exist only in the old version) are folded into "Too high".
SCREEN_ANY = {**SCREEN, 4: "Too high", 5: "Too high"}


def screen_book(row):
    """Per-response codebook for the screen-time questions."""
    return SCREEN_5PT if row.get("_5pt") else SCREEN_ANY
screen_book.labels = list(SCREEN.values())
HOURS = {0: "None", 1: "Up to 1 hour", 2: "1 to 2 hours", 3: "2 to 3 hours", 4: "3 to 4 hours", 5: "4 to 5 hours", 6: "More than 5 hours"}
# Matrix: statement (column suffix QID110_<n>) -> label, and answer code -> label. Approve = 1, Disapprove = 2.
AI_USES = {"rows": {1: "Look up facts", 2: "Get explanations of difficult concepts", 3: "Write the first draft of an essay",
                    4: "Revise an essay they drafted on their own", 5: "Summarize books/texts instead of reading them"},
           "answers": {1: "Approve", 2: "Disapprove"}}
ACCESS = {1: "1:1 devices", 2: "Cart or library checkout", 3: "Computer lab", 4: "Bring your own device", 5: "No device access"}

# --- Whitelist: the only fields that leave Qualtrics ------------------------
# tag -> (QID, kind, codebook, audiences). kind: "choice" | "multi" (select-all) | "scale" (0-100% dropdown,
# published as 0-10) | "matrix" (one column per statement) | "route" (used for filtering, never published).
# audiences: which pages get it.
TEEN = {
    "s_wyr_read": ("QID2", "choice", {1: "Read things in hard copy", 2: "Read things on a screen"}, {"student"}),
    "s_wyr_homework": ("QID3", "choice", {1: "Do more homework on a computer", 2: "Do more homework on paper"}, {"student"}),
    "s_policy_when": ("QID13", "choice", WHEN, {"student"}),
    "s_policy_where": ("QID14", "choice", WHERE, {"student"}),
    "s_use_phone_class": ("QID16", "scale", None, {"student"}),
    "s_use_laptop_class": ("QID17", "scale", None, {"student"}),
    "s_use_teacher_phone": ("QID18", "choice", {0: "Never", 1: "Once per week", 2: "A few times per week", 3: "Most days of the week", 4: "Every day"}, {"student"}),
    "s_policy_strict": ("QID20", "choice", {1: "More strict", 2: "Just right", 3: "Less strict"}, {"student"}),
}
MS, EL = {"educator"}, {"elementary"}
EDU = {
    "e_role_level": ("QID44", "route", None, MS | EL),
    # Middle/high school educators
    "e_policy_when": ("QID58", "choice", WHEN, MS),
    "e_policy_where": ("QID59", "choice", WHERE, MS),
    "e_policy_enforce": ("QID63", "scale", None, MS),
    "e_use_between": ("QID64", "scale", None, MS),
    "e_use_phone_class": ("QID65", "scale", None, MS),
    "e_use_laptop_class": ("QID66", "scale", None, MS),
    "e_policy_satisf": ("QID67", "scale", None, MS),
    "e_policy_strict": ("QID68", "choice", {1: "Much more restrictive", 2: "A little more restrictive", 3: "The policy is just right",
                                            4: "A little less restrictive", 5: "Much less restrictive"}, MS),
    "e_view_screentime_ms": ("QID49", "choice", screen_book, MS),
    "e_view_hardcopy_ms": ("QID51", "choice", YESNO, MS),
    "e_view_ban_hw_ms": ("QID52", "choice", YESNO, MS),
    "e_view_ban_device_ms": ("QID53", "choice", YESNO, MS),
    "e_view_ai_ms": ("QID110", "matrix", AI_USES, MS),  # e_view_AI in Qualtrics; MS/HS block only
    # Elementary educators
    "e_tech_access": ("QID20", "multi", ACCESS, EL),
    "e_tech_take_home": ("QID21", "scale", None, EL),
    "e_tech_screen_read": ("QID22", "scale", None, EL),
    "e_tech_screen_hw": ("QID23", "scale", None, EL),
    "e_use_instr_personal": ("QID25", "choice", HOURS, EL),
    "e_use_instr_other": ("QID26", "choice", HOURS, EL),
    "e_use_noninstr": ("QID27", "choice", HOURS, EL),
    "e_view_screentime_el": ("QID36", "choice", screen_book, EL),
    "e_view_hardcopy_el": ("QID38", "choice", YESNO, EL),
    "e_view_ban_hw_el": ("QID39", "choice", YESNO, EL),
    "e_view_ban_device_el": ("QID40", "choice", YESNO, EL),
}
ELEMENTARY_CODES = {1}  # QID44 "Mostly elementary school"; 4 = middle, 5 = high


def check(r, what):
    """Fail with Qualtrics' own error message (never response data, never the URL or token)."""
    if r.ok:
        return
    try:
        msg = r.json()["meta"]["error"]["errorMessage"]
    except Exception:
        msg = "(no message)"
    sys.exit(f"Qualtrics returned {r.status_code} while {what}: {msg}")


def export(survey_id, fields):
    """Qualtrics response export, restricted to the whitelisted QIDs. Returns list of {values:{...}} dicts."""
    body = {
        "format": "json",               # rows carry "values" = recode values, which the codebooks above map
        "compress": True,
        "questionIds": [f[0] for f in fields.values()],
        "embeddedDataIds": [],          # none — no school/NCES/email
        # recordedDate only when the screen-time cutoff is set; it stays in memory and is never published.
        "surveyMetadataIds": ["finished", "distributionChannel"] + (["recordedDate"] if SCREEN_5PT_UNTIL else []),
    }
    r = requests.post(f"{BASE}/surveys/{survey_id}/export-responses", headers=H, json=body, timeout=60)
    check(r, f"starting the export for {fields is TEEN and 'SURVEY_TEEN' or 'SURVEY_EDUCATOR'}")
    pid = r.json()["result"]["progressId"]
    deadline = time.time() + 600
    while True:
        pr = requests.get(f"{BASE}/surveys/{survey_id}/export-responses/{pid}", headers=H, timeout=60)
        check(pr, "checking export progress")
        p = pr.json()["result"]
        if p["status"] == "complete":
            fid = p["fileId"]; break
        if p["status"] == "failed":
            sys.exit(f"export failed for {survey_id}")
        if time.time() > deadline:
            sys.exit(f"export timed out for {survey_id}")
        time.sleep(2)
    f = requests.get(f"{BASE}/surveys/{survey_id}/export-responses/{fid}/file", headers=H, timeout=120)
    check(f, "downloading the export file")
    with zipfile.ZipFile(io.BytesIO(f.content)) as z:
        data = json.loads(z.read(z.namelist()[0]))
    rows = []
    for x in data["responses"]:
        v = x.get("values", {})
        if v.get("finished") not in (1, True, "1", "True", "true") or v.get("distributionChannel") == "preview":
            continue
        # Keep whitelisted QIDs only; everything else in the row is dropped here.
        row = {}
        for qid, kind, book, _ in fields.values():
            if kind == "multi":
                row[qid] = multi_value(v, qid)
            elif kind == "matrix":  # QID110_1 ... QID110_5
                row[qid] = {k: v.get(f"{qid}_{k}") for k in book["rows"]}
            else:
                row[qid] = v.get(qid)
        if SCREEN_5PT_UNTIL:
            row["_5pt"] = before(v.get("recordedDate"), SCREEN_5PT_UNTIL)
        rows.append(row)
    return rows


def before(recorded, cutoff):
    """True if an ISO timestamp is earlier than the cutoff. Unparseable dates count as current."""
    try:
        p = lambda t: datetime.fromisoformat(str(t).strip().replace("Z", "+00:00"))
        return p(recorded) < p(cutoff)
    except (TypeError, ValueError):
        return False


def code(v):
    """Recode value -> int, or None. Qualtrics may send 3, 3.0 or "3"."""
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return None


unmapped = {}  # tag -> count of values missing from the codebook (logged as counts only)


legacy = {}  # tag -> count of old 5-point screen-time codes 4/5 read without a cutoff (logged as counts only)


def choice(rows, qid, book, tag):
    """book: {code: label}, or a function(row) -> {code: label} with a .labels list (per-response codebooks)."""
    pick = book if callable(book) else (lambda r: book)
    labels = book.labels if callable(book) else list(dict.fromkeys(book.values()))
    vals = []
    for r in rows:
        k = code(r.get(qid))
        if k is None:
            continue
        b = pick(r)
        if k not in b:
            unmapped[tag] = unmapped.get(tag, 0) + 1
            continue
        if b is SCREEN_ANY and k not in SCREEN:
            legacy[tag] = legacy.get(tag, 0) + 1
        vals.append(b[k])
    n = len(vals)
    if n < MIN_N:
        return None
    counts = {label: 0 for label in labels}
    for label in vals:
        counts[label] += 1
    return {"kind": "choice", "n": n, "options": {k: round(c / n * 100, 1) for k, c in counts.items()}}


def multi_value(v, qid):
    """Select-all answer as a list of choice codes. Qualtrics may export it as one field (list or
    comma-joined string) or as one 0/1 column per choice (QID20_1, QID20_2, ...); accept both."""
    if v.get(qid) not in (None, "", []):
        return v[qid]
    prefix = qid + "_"
    picked = [k[len(prefix):] for k, x in v.items()
              if k.startswith(prefix) and k[len(prefix):].isdigit() and code(x) == 1]
    return picked or None


def multi(rows, qid, book, tag):
    """Select-all: percent of respondents (who picked anything) choosing each option. Sums can exceed 100."""
    n, counts = 0, {label: 0 for label in book.values()}
    for r in rows:
        v = r.get(qid)
        if v in (None, "", []):
            continue
        picks = v if isinstance(v, list) else str(v).split(",")
        labels = set()
        for p in picks:
            k = code(p)
            if k in book:
                labels.add(book[k])
            elif k is not None:
                unmapped[tag] = unmapped.get(tag, 0) + 1
        if labels:
            n += 1
            for label in labels:
                counts[label] += 1
    if n < MIN_N:
        return None
    return {"kind": "multi", "n": n, "options": {k: round(c / n * 100, 1) for k, c in counts.items()}}


def scale(rows, qid, tag):
    """0%-100% dropdowns (recodes 0, 10, ... 100) published as a 0-10 distribution."""
    vals = []
    for r in rows:
        k = code(r.get(qid))
        if k is None:
            continue
        if k % 10 or not 0 <= k <= 100:
            unmapped[tag] = unmapped.get(tag, 0) + 1
            continue
        vals.append(k // 10)
    n = len(vals)
    if n < MIN_N:
        return None
    dist = [0] * 11
    for k in vals:
        dist[k] += 1
    return {"kind": "scale", "n": n, "mean": round(sum(vals) / n, 2), "dist": [round(d / n * 100, 1) for d in dist]}


def matrix(rows, qid, book, tag):
    """Percent choosing answer code 1 (Approve) per statement, among those who answered that statement.
    Statements under MIN_N are dropped; the whole question is null if none are left."""
    out, anyone = {}, 0
    counts = {k: [0, 0] for k in book["rows"]}  # statement -> [approve, answered]
    for r in rows:
        answered = False
        for k, v in (r.get(qid) or {}).items():
            c = code(v)
            if c is None:
                continue
            if c not in book["answers"]:
                unmapped[tag] = unmapped.get(tag, 0) + 1
                continue
            counts[k][1] += 1
            counts[k][0] += c == 1
            answered = True
        anyone += answered
    for k, (yes, n) in counts.items():
        if n >= MIN_N:
            out[book["rows"][k]] = round(yes / n * 100, 1)
    if not out:
        return None
    return {"kind": "matrix", "n": anyone, "rows": out}


def aggregate(rows, fields, audience):
    out = {}
    for tag, (qid, kind, book, auds) in fields.items():
        if kind == "route" or audience not in auds:
            continue
        key = tag.split("_", 1)[1]
        if key.endswith(("_ms", "_el")):
            key = key[:-3]
        if kind == "scale":
            out[key] = scale(rows, qid, tag)
        elif kind == "matrix":
            out[key] = matrix(rows, qid, book, tag)
        elif kind == "multi":
            out[key] = multi(rows, qid, book, tag)
        else:
            out[key] = choice(rows, qid, book, tag)
    return {"n": len(rows), "questions": out}


def main():
    audiences = {}
    teen = export(os.environ["SURVEY_TEEN"], TEEN)
    audiences["student"] = aggregate(teen, TEEN, "student")
    del teen

    if os.environ.get("SURVEY_EDUCATOR"):
        edu = export(os.environ["SURVEY_EDUCATOR"], EDU)
        level = EDU["e_role_level"][0]
        el = [r for r in edu if code(r.get(level)) in ELEMENTARY_CODES]
        ms = [r for r in edu if code(r.get(level)) not in ELEMENTARY_CODES]
        del edu
        audiences["elementary"] = aggregate(el, EDU, "elementary")
        audiences["educator"] = aggregate(ms, EDU, "educator")

    result = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "min_n": MIN_N,
        "audiences": audiences,
    }
    with open(OUT, "w") as fh:
        json.dump(result, fh, indent=1)
    print("wrote", OUT, {k: v["n"] for k, v in audiences.items()})  # counts only — never row data
    if unmapped:
        print("WARNING values not in codebook (survey changed?):", unmapped)
    if legacy:
        print("NOTE old 5-point screen-time answers (codes 4-5) counted as 'Too high'; set SCREEN_5PT_UNTIL "
              "to also re-read old codes 2-3:", legacy)


if __name__ == "__main__":
    main()
