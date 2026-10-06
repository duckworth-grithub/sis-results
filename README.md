# Screens in Schools — results site

Static results page + daily Qualtrics aggregation job. Live at https://results.screensinschools.org/
(`/?a=student`, `/?a=educator`, `/?a=elementary`).

```
index.html                  page (one page, three audiences via ?a=student|educator|elementary)
app.js                      URL parsing, data loading, chart + sentence logic
styles.css                  design tokens and desktop/mobile layout (breakpoint 600px)
results/results-data.json   aggregates written by the export job, fetched as ./results/results-data.json
results/index.html          redirect from the old /results/ address to / (keeps ?query and #answers)
export/results_export.py    Qualtrics → results/results-data.json (whitelisted QIDs only)
export/codebook-educator.csv  educator QIDs, answer codes and published labels (generated from the script)
results-data-spec.md        data contract: fields pulled, JSON shape, page behaviour
tools/check_results_url.py  checks a results link the way the page reads it
.github/workflows/results-refresh.yml   daily cron + manual run; commits the JSON
```

All paths in the page are relative, so it works at any host or sub-path.

The old address `https://duckworth-grithub.github.io/sis-results/…` redirects to `https://results.screensinschools.org/…`
with the same path and `?query`, and the browser keeps the `#answers` across the redirect, so existing links keep
working.

## Deploy (GitHub Pages)
1. Push this folder as the root of a repo.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Custom domain `results.screensinschools.org`: set in Settings → Pages (with "Enforce HTTPS"), DNS `CNAME`
   record `results` → `duckworth-grithub.github.io`. Keep the repo's `CNAME` file; it holds the domain.
4. Settings → Secrets → Actions: `QUALTRICS_TOKEN`, `QUALTRICS_DATACENTER`, `SURVEY_TEEN`, `SURVEY_EDUCATOR`, `SURVEY_LIBRARIAN` (SV_9BO9iR0YKZ2lVie).
   Optional variable (Variables tab): `SCREEN_5PT_UNTIL` — see "Screen time" below.
5. Actions → "Refresh results data" → Run workflow once to replace the sample JSON.

Any static host works: serve the repo root, keeping `results/results-data.json` where the job writes it.

## Thank-you screen links
Answers are passed as **recode values** (`SelectedChoicesRecode`), after `#`. Fragments never reach the
web server, and recodes avoid the HTML and explainer sub-lines in the live choice text. On load the page
rewrites the address bar to `?a=<audience>`. (A `?` query string is still accepted as a fallback, and old
`/results/…` links redirect to `/…` with their query and `#` intact.)

**Students** see the generic report only; no student answers are piped anywhere. The student survey redirects to
the giveaway form (plain link, no parameters), and the giveaway's thank-you message links to:
```
https://results.screensinschools.org/?a=student
```

**Educators** (SV_bxUuSACfns11z5s): the flow has one End of Survey per QID44 branch, each with its own link.
MS/HS ending (12 parameters):
```
https://results.screensinschools.org/#a=educator&when=${q://QID58/SelectedChoicesRecode}&where=${q://QID59/SelectedChoicesRecode}&enforce=${q://QID63/SelectedChoicesRecode}&between=${q://QID64/SelectedChoicesRecode}&phone=${q://QID65/SelectedChoicesRecode}&laptop=${q://QID66/SelectedChoicesRecode}&satisf=${q://QID67/SelectedChoicesRecode}&strict=${q://QID68/SelectedChoicesRecode}&screentime=${q://QID49/SelectedChoicesRecode}&hardcopy=${q://QID51/SelectedChoicesRecode}&banhw=${q://QID52/SelectedChoicesRecode}&bandevice=${q://QID53/SelectedChoicesRecode}
```
Elementary ending (11 parameters):
```
https://results.screensinschools.org/#a=elementary&access=${q://QID20/SelectedChoicesRecode}&takehome=${q://QID21/SelectedChoicesRecode}&read=${q://QID22/SelectedChoicesRecode}&hw=${q://QID23/SelectedChoicesRecode}&pers=${q://QID25/SelectedChoicesRecode}&other=${q://QID26/SelectedChoicesRecode}&noninstr=${q://QID27/SelectedChoicesRecode}&screentime=${q://QID36/SelectedChoicesRecode}&hardcopy=${q://QID38/SelectedChoicesRecode}&banhw=${q://QID39/SelectedChoicesRecode}&bandevice=${q://QID40/SelectedChoicesRecode}
```
(A single combined link also works: `#a=educator&level=${q://QID44/SelectedChoicesRecode}&…` with both sets; `level=1`
switches to the elementary page.)

**WHEN/WHERE on the student, MS/HS educator and MS/HS + district librarian reports** (not elementary) show last school year's
per-school figures (2025-26, Phones in Focus), hardcoded in app.js as `LAST_WHEN`/`LAST_WHERE` with fixed headings
("Last school year, 69% of schools…"). No comparison: `when`/`where` in a link are read but not marked YOU.

**Librarians** (SV_9BO9iR0YKZ2lVie) use the educator pages, marked with `role=librarian`. On a librarian page only the
sections they answered are shown, with their own answers marked YOU in green and no green highlights. District
librarians answer none of the linked questions, so they see only the AI section. A librarian page with only opinion
sections (Your View and/or AI: district and elementary librarians) is titled "What are educators at other schools
saying?", since there is no "your school" to compare; a librarian with nothing to show
gets a one-line note. The AI section is always shown on their MS/HS page, since MS/HS
and district librarians answer the same AI matrix (QID419). Their survey asks the same questions under different
QIDs, piped into the same parameter names. On librarian reports, satisfaction, AI approval and (elementary) Your View use librarians' own answers
(audience `librarian`: QID130, QID419, QID414, QID416–418); everything else compares them with educators. MS/HS librarians:
```
https://results.screensinschools.org/#a=educator&when=${q://QID295/SelectedChoicesRecode}&where=${q://QID296/SelectedChoicesRecode}&satisf=${q://QID130/SelectedChoicesRecode}&strict=${q://QID177/SelectedChoicesRecode}&screentime=${q://QID414/SelectedChoicesRecode}&hardcopy=${q://QID416/SelectedChoicesRecode}&banhw=${q://QID417/SelectedChoicesRecode}&bandevice=${q://QID418/SelectedChoicesRecode}&role=librarian
```
Elementary-only librarians (`l_serves` QID411 = Elementary selected, Middle and High not selected):
```
https://results.screensinschools.org/#a=elementary&screentime=${q://QID414/SelectedChoicesRecode}&hardcopy=${q://QID416/SelectedChoicesRecode}&banhw=${q://QID417/SelectedChoicesRecode}&bandevice=${q://QID418/SelectedChoicesRecode}&role=librarian
```
Librarian answer codes match the educator ones (checked against the Sep 30 export; QID130 satisfaction uses
recodes 0, 10 … 100 like the educator's QID67). On a librarian's MS/HS page the charts they weren't asked
(enforce, between, phone, laptop) show the aggregate with no YOU mark. In the current flow the "Your View" block
(QID414–418) is only shown to elementary-only librarians, so for MS/HS and district librarians `screentime`,
`hardcopy`, `banhw` and `bandevice` arrive empty and screen time shows no YOU mark.
The "If educators were in charge" pies never show a YOU mark for anyone, so `hardcopy`, `banhw` and `bandevice`
don't change what those pies look like; they only switch the page out of the generic view.

Parameters the page reads: student `when where phone laptop teacher strict read hw` (supported, but no survey
sends them); educator `when where enforce between
phone laptop satisf strict screentime hardcopy banhw bandevice`; elementary `access takehome read hw pers other
noninstr screentime hardcopy banhw bandevice`. Scales (0–10 on the page) accept the Qualtrics recode 0, 10 … 100, a
label starting with a percentage (`70%`, `0% (not at all satisfied)`), or a bare 1–9; `10` always means 10%. `access` is a
comma-separated list; under the heading "Schools differ on how students access devices." the page shows all five choices as data only:
medium grey bars, no YOU or highlight, whatever the teacher picked. The recode tables live in `app.js` and `export/results_export.py` and must match.

Screen time (QID49 MS/HS, QID36 elementary) is 3-point: 1 Too low, 2 About right, 3 Too high. Until the week of
Sep 21–28, 2026 it was 5-point (1 Much too low … 5 Much too high), and the edit reused codes 1–3 with new meanings.
The job always reads old codes 4–5 as "Too high". To also read old 2–3 correctly (A little too low → Too low,
About right → About right), set the repo variable `SCREEN_5PT_UNTIL` to when the 3-point version went live
(ISO time, e.g. `2026-09-25T14:00:00Z`); responses recorded before it use the 5-point meanings. This makes the
job request each response's `recordedDate`, which stays in memory and is never published.

"If educators were in charge" pies always show the Yes share and read "would …". Generic view: every Yes arc is
green on #DADADA; with answers in the link, #444444 on #DADADA.

Hours per day (elementary QID25–27): AVERAGE is the mean of the bucket midpoints (0, 0.5, 1.5 … 5.5 hrs),
shown as the answer bucket it falls in (e.g. 1.9 → "1–2 hrs"), with the same labels and midpoint bar height as YOU.

AI uses (MS/HS educators only, QID110 `e_view_AI`): a Qualtrics matrix exported as `QID110_1`…`QID110_5`
(1 = Approve, 2 = Disapprove). Published as `view_ai` = `{"kind": "matrix", "n": …, "rows": {statement: % approve}}`;
statements nobody answered are dropped, and the question is null if none are left. Aggregate only:
no YOU mark, nothing piped into the results link.

Parsed but not displayed (no chart in the design): `strict`, `enforce`, `takehome`.

Check a real link from a test run (reads the page's own tables from `app.js`; quote the URL):
`python3 tools/check_results_url.py 'https://results.screensinschools.org/#a=educator&when=1&…'`
It prints the audience, each parameter's value and whether the page recognizes it, and what's missing or ignored.

Test links locally (`python3 -m http.server`, then open http://localhost:8000 plus):
- `/#a=educator&level=5&when=1&satisf=80&phone=20&between=20&laptop=40&screentime=3`
- `/#a=educator&level=1&access=1,3&read=20&hw=10&pers=2&other=1&noninstr=1&screentime=3`
- `/?a=student` (generic view: aggregates highlighted in green, no YOU marks)
- `/results/?a=educator` (old address; should land on `/?a=educator`)
- `/` (no `a`; should redirect to https://screensinschools.org)

## Behaviour
- Every report ends with the "survey data as of" line, then a share callout (handoff-share-callout.md, mock option 2a): "Share with a friend" for students,
  "Share with a colleague" for educators and librarians (wording per audience, `role=librarian` picks the librarian
  line). Text, email and copy-link all share https://screensinschools.org, never the results page; the text and email
  messages are the survey end screens' wording. The buttons are emoji (💬 ✉️ 🔗) on green circles; copy link shows ✓ on #0F5226 for 2 seconds.
- No `a` parameter (in the `#hash` or the `?query`), or an unknown value → redirect to https://screensinschools.org, before
  any data is fetched. `a=student` / `a=educator` / `a=elementary` pick their page, with or without answers.
- Demos: add `preview=1` to show any page without answers, e.g. `https://results.screensinschools.org/#a=educator&preview=1`
  (or `#a=elementary&preview=1`, `#a=student&preview=1`). The page ignores `preview`; it only needs a valid `a`.
- Unknown recodes / off-grid scale values → treated as missing (generic sentence, no YOU mark).
- `results/results-data.json` fails to load → baked-in sample numbers, footer says "Sample data".
- No minimum sample size (`MIN_N` is 0): any question with at least one answer is published. A question nobody
  answered is `null` → "Not enough responses yet". Sample numbers are never mixed into live data.

## Export job notes
- Requests `format: json` and reads each row's recode `values`, mapped through the codebooks at the top of the
  script (built from the 2026-27 .qsf files). `results-data.json` therefore carries short, stable labels
  ("Bell-to-bell", "Too high", "1:1 devices"), not the survey's HTML choice text. Values missing from a codebook
  are dropped and reported as a count, which flags a survey edit.
- Scales (0%–100% dropdowns, recodes 0–100) are published as 0–10 distributions. `tech_access` is select-all
  (`kind: "multi"`): each option's percent is of respondents who picked anything, so they can sum past 100.
  The script accepts it either as one field (list or comma-joined) or as one 0/1 column per choice (`QID20_1`…).
- `tech_screen_read` / `tech_screen_hw` (QID22/23) are `scale`, not `choice` as the updated spec lists them:
  in the survey they are 0%–100% dropdowns like the other scales, and the design shows them as YOU% vs AVERAGE%.
- `MIN_N` (workflow env, default 0): 0 means never suppress. Set it above 0 to withhold questions with fewer answers.
- Only the whitelisted QIDs are requested (`embeddedDataIds: []`), and rows are reduced to those QIDs immediately after download. Nothing row-level is written to disk; logs print counts only.
- From the librarian survey only the checkouts questions are pulled: QID258 (school or district), QID403 (print and
  digital separate?), and the per-year boxes QID405 (total), QID275 (print), QID404 (digital). The boxes are turned into
  numbers as each row is read; text in them is discarded. Rules (handoff §2): school-level only; zero, blank or
  non-numeric = missing; small values kept; print + digital: a year counts if either is filled, and a blank half counts as 0. The
  handoff's `tk` rule isn't applied, because it needs free-text fields this job never pulls. Year boxes: _1 = 2026-27
  (so far, partial), _2 = 2025-26 … _5 = 2022-23. The balanced panel uses 2022-23 to 2025-26; 2026-27 (partial) is
  not published. The combined figures are last year's baseline (`CIRC_BASELINE` in the export) plus this year's.
- Still to confirm with the live survey: that `distributionChannel` is populated for the anonymous link.
