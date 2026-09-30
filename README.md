# Screens in Schools — results site

Static results page + daily Qualtrics aggregation job. Live at https://duckworth-grithub.github.io/sis-results/
(`/?a=student`, `/?a=educator`, `/?a=elementary`).

```
index.html                  page (one page, three audiences via ?a=student|educator|elementary)
app.js                      URL parsing, data loading, chart + sentence logic
styles.css                  design tokens and desktop/mobile layout (breakpoint 600px)
results/results-data.json   aggregates written by the export job, fetched as ./results/results-data.json
results/index.html          redirect from the old /results/ address to / (keeps ?query and #answers)
export/results_export.py    Qualtrics → results/results-data.json (whitelisted QIDs only)
export/codebook-educator.csv  educator QIDs, answer codes and published labels (generated from the script)
.github/workflows/results-refresh.yml   daily cron + manual run; commits the JSON
```

All paths in the page are relative, so it works at any host or sub-path.

## Deploy (GitHub Pages)
1. Push this folder as the root of a repo.
2. Settings → Pages → Deploy from branch → `main` / root.
3. No custom domain for now: the repo must not contain a `CNAME` file (GitHub would redirect to that domain).
4. Settings → Secrets → Actions: `QUALTRICS_TOKEN`, `QUALTRICS_DATACENTER`, `SURVEY_TEEN`, `SURVEY_EDUCATOR`.
   Optional variable (Variables tab): `SCREEN_5PT_UNTIL` — see "Screen time" below.
5. Actions → "Refresh results data" → Run workflow once to replace the sample JSON.

Any static host works: serve the repo root, keeping `results/results-data.json` where the job writes it.

## Thank-you screen links
Answers are passed as **recode values** (`SelectedChoicesRecode`), after `#`. Fragments never reach the
web server, and recodes avoid the HTML and explainer sub-lines in the live choice text. On load the page
rewrites the address bar to `?a=<audience>`. (A `?` query string is still accepted as a fallback, and old
`/results/…` links redirect to `/…` with their query and `#` intact.)

Student survey (SV_6LFWjsZ51O8XInY):
```
https://duckworth-grithub.github.io/sis-results/#a=student&when=${q://QID13/SelectedChoicesRecode}&where=${q://QID14/SelectedChoicesRecode}&phone=${q://QID16/SelectedChoicesRecode}&laptop=${q://QID17/SelectedChoicesRecode}&teacher=${q://QID18/SelectedChoicesRecode}&strict=${q://QID20/SelectedChoicesRecode}&read=${q://QID2/SelectedChoicesRecode}&hw=${q://QID3/SelectedChoicesRecode}
```

Educator survey (SV_bxUuSACfns11z5s): one link for both pages. `level` (QID44) picks the page:
recode 1 ("Mostly elementary school") shows the elementary page, anything else the MS/HS page.
The view questions exist twice (`_ms` / `_el`) and each respondent only sees one set, so both
are piped into the same parameter and the unanswered one comes through empty.
```
https://duckworth-grithub.github.io/sis-results/#a=educator&level=${q://QID44/SelectedChoicesRecode}&when=${q://QID58/SelectedChoicesRecode}&where=${q://QID59/SelectedChoicesRecode}&enforce=${q://QID63/SelectedChoicesRecode}&between=${q://QID64/SelectedChoicesRecode}&phone=${q://QID65/SelectedChoicesRecode}&laptop=${q://QID66/SelectedChoicesRecode}&satisf=${q://QID67/SelectedChoicesRecode}&strict=${q://QID68/SelectedChoicesRecode}&access=${q://QID20/SelectedChoicesRecode}&takehome=${q://QID21/SelectedChoicesRecode}&read=${q://QID22/SelectedChoicesRecode}&hw=${q://QID23/SelectedChoicesRecode}&pers=${q://QID25/SelectedChoicesRecode}&other=${q://QID26/SelectedChoicesRecode}&noninstr=${q://QID27/SelectedChoicesRecode}&screentime=${q://QID49/SelectedChoicesRecode}${q://QID36/SelectedChoicesRecode}&hardcopy=${q://QID51/SelectedChoicesRecode}${q://QID38/SelectedChoicesRecode}&banhw=${q://QID52/SelectedChoicesRecode}${q://QID39/SelectedChoicesRecode}&bandevice=${q://QID53/SelectedChoicesRecode}${q://QID40/SelectedChoicesRecode}
```
Parameters: student `when where phone laptop teacher strict read hw`; educator `when where enforce between
phone laptop satisf strict screentime hardcopy banhw bandevice`; elementary `access takehome read hw pers other
noninstr screentime hardcopy banhw bandevice`. Scales are recodes 0–100 in steps of 10; `access` is a
comma-separated list; YOU marks every pick and the headline sentence uses the first. The recode tables live in `app.js` and `export/results_export.py` and must match.

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
statements with fewer than 10 answers are dropped, and the question is null if none are left. Aggregate only:
no YOU mark, nothing piped into the results link.

Parsed but not displayed (no chart in the design): `strict`, `enforce`, `takehome`.

Test links locally (`python3 -m http.server`, then open http://localhost:8000 plus):
- `/#a=student&when=1&where=3&phone=20&laptop=30&teacher=1`
- `/#a=educator&level=5&when=1&satisf=80&phone=20&between=20&laptop=40&screentime=3`
- `/#a=educator&level=1&access=1,3&read=20&hw=10&pers=2&other=1&noninstr=1&screentime=3`
- `/?a=student` (generic view: aggregates highlighted in green, no YOU marks)
- `/results/?a=educator` (old address; should land on `/?a=educator`)

## Behaviour
- Unknown recodes / off-grid scale values → treated as missing (generic sentence, no YOU mark).
- `results/results-data.json` fails to load → baked-in sample numbers, footer says "Sample data".
- A question is `null` (n < 10) → "Not enough responses yet". Sample numbers are never mixed into live data.

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
- Only the whitelisted QIDs are requested (`embeddedDataIds: []`), and rows are reduced to those QIDs immediately after download. Nothing row-level is written to disk; logs print counts only.
- Still to confirm with the live survey: that `distributionChannel` is populated for the anonymous link, and that
  the `_ms` view questions (QID49/51–53) never show to elementary respondents (the piped link relies on it).
