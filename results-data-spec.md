# Results data contract — `results/results-data.json`

What the results page reads, and the only Qualtrics fields the export job (`export/results_export.py`) pulls.
Anything not listed here never leaves Qualtrics. Answer codes and labels for every educator field are in
`export/codebook-educator.csv`. This file supersedes the `results-data-spec.md` in the original design handoff.

## Principles
- **Whitelist, not blacklist.** The export request names the exact question IDs, with `embeddedDataIds: []`.
  Metadata: `finished` and `distributionChannel` only (plus `recordedDate`, in memory only, when
  `SCREEN_5PT_UNTIL` is set; see Screen time).
- **Aggregates only.** Percentages per answer option or 0–10 distributions. Never a per-response row; raw rows stay
  in memory, logs print counts only.
- **No minimum sample size.** `MIN_N` is 0: a question with at least one answer is published. A question nobody
  answered is `null`. (Setting `MIN_N` above 0 in the workflow withholds questions with fewer answers.)
- **Completes only.** `finished` true; `distributionChannel` "preview" excluded.
- **Codes, not text.** The job reads recode values and maps them through its codebooks; the JSON carries short,
  stable labels, never the survey's HTML choice text.

## Audiences
| key | survey | rows |
| --- | --- | --- |
| `student` | Student SV_6LFWjsZ51O8XInY | all completes |
| `educator` | Educator SV_bxUuSACfns11z5s | QID44 `e_role_level` ≠ 1 (middle/high school) |
| `elementary` | Educator SV_bxUuSACfns11z5s | QID44 = 1 ("Mostly elementary school") |

Librarians (SV_9BO9iR0YKZ2lVie) see the educator pages and compare themselves with educators (links in the README).
Only their library checkouts are exported, under the top-level `librarian` key (below).

## Fields pulled
Student: QID2 `wyr_read`, QID3 `wyr_homework`, QID13 `policy_when`, QID14 `policy_where`, QID16 `use_phone_class`
(scale), QID17 `use_laptop_class` (scale), QID18 `use_teacher_phone`, QID20 `policy_strict`.

Educator (MS/HS → `educator`): QID58 `policy_when`, QID59 `policy_where`, QID63 `policy_enforce` (scale), QID64
`use_between` (scale), QID65 `use_phone_class` (scale), QID66 `use_laptop_class` (scale), QID67 `policy_satisf`
(scale), QID68 `policy_strict`, QID49 `view_screentime`, QID51 `view_hardcopy`, QID52 `view_ban_hw`, QID53
`view_ban_device`, QID110 `view_ai` (matrix).

Educator (elementary → `elementary`): QID20 `tech_access` (multi), QID21 `tech_take_home` (scale), QID22
`tech_screen_read` (scale), QID23 `tech_screen_hw` (scale), QID25 `use_instr_personal`, QID26 `use_instr_other`,
QID27 `use_noninstr`, QID36 `view_screentime`, QID38 `view_hardcopy`, QID39 `view_ban_hw`, QID40 `view_ban_device`.

Routing only, never published: QID44 `e_role_level`.

Librarian (checkouts only): QID258 `l_role_level` (1 school, 0 district: excluded), QID403 `l_circ_split_s`, and the
per-year number boxes QID405 `l_circ_school_total`, QID275 `l_circ_school_print`, QID404 `l_circ_school_digital`.

## Library checkouts (`librarian.circulation`)
```json
"librarian": { "circulation": {
  "source": "this year's Screens in Schools librarian survey", "partial": "2026-27", "libraries": 90,
  "all":   [ { "year": "2022-23", "n": 90, "mean": 5510, "median": 4108, "total": 495932 }, "…" ],
  "so_far": { "year": "2026-27", "n": 60, "mean": 1543, "median": 1566, "total": 92560 },
  "panel": { "n": 90, "years": [ { "year": "2022-23", "mean": 5510, "median": 4108, "change": 0.0 }, "…" ] },
  "per_library": { "n": 90, "median": 3590, "mean": 4862, "under_10k": 81.1 }
} }
```
- `all` (handoff view A): every library that reported that year; n varies by year. Includes the partial year.
- `panel` (view B): the same libraries in every complete year; `change` = % vs the first year. `null` under `CIRC_MIN_N`.
- `so_far`: the current, partial year (2026-27) on its own: `{year, n, mean, median, total}` over every school library
  that reported it, same cleaning rules. `null` under `CIRC_MIN_N`; the page then says "Not enough responses yet".
- `per_library` (view D): one average per library. No min/max, which would be one library's figure.
- The page uses `panel` once its `n` is at least 30; before that it shows the July 2, 2026 baseline built into app.js.

## Output shape
```json
{
  "generated_at": "2026-09-30T17:26:59Z",
  "min_n": 0,
  "audiences": {
    "educator": {
      "n": 103,
      "questions": {
        "policy_when":     { "kind": "choice", "n": 101, "options": { "Bell-to-bell": 45.0, "…": 0.0 } },
        "use_phone_class": { "kind": "scale",  "n": 100, "mean": 3.7, "dist": [0.0, 11.0, "… 11 values …"] },
        "view_ai":         { "kind": "matrix", "n": 40,  "rows": { "Look up facts": 72.0, "…": 0.0 } },
        "view_screentime": null
      }
    },
    "elementary": { "questions": { "tech_access": { "kind": "multi", "n": 11, "options": { "1:1 devices": 54.5 } } } }
  }
}
```
- `choice`: `options` = % of those who answered, per label; sums to ~100.
- `scale`: 0%–100% dropdowns (recodes 0, 10 … 100) published as `dist` = 11 percentages for 0–10, plus `mean`.
- `multi` (select-all, QID20): % of respondents who picked anything that chose each option; can sum past 100.
- `matrix` (QID110): `rows` = % Approve per statement among those who answered it. Statements nobody answered are
  dropped; `null` if none are left.
- Percentages are rounded to one decimal; the page rounds for display.

## Screen time (QID49, QID36)
3-point: 1 Too low, 2 About right, 3 Too high. It was 5-point until the week of Sep 21–28, 2026, and the edit reused
codes 1–3 with new meanings. Old codes 4–5 are always read as Too high. If the workflow variable
`SCREEN_5PT_UNTIL` is set to when the 3-point version went live, responses recorded before it are read with the
5-point meanings (1–2 Too low, 3 About right, 4–5 Too high).

## Page behaviour
1. Fetch `./results/results-data.json` (`cache: "no-store"`); footer "This report reflects survey data as of
   {generated_at}".
2. Fetch fails → baked-in sample numbers, footer "Sample data".
3. A `null` question → "Not enough responses yet" (#6B6B6B, 15px) in place of the chart. Sample numbers are never
   mixed into live data.
4. The AI section (`view_ai`, educator page only) is aggregate only: bars #444444, no YOU, no URL parameter.
5. "If educators were in charge" pies always show the Yes % and read "would …"; generic view: green Yes arc on
   #DADADA; with answers: #444444 on #DADADA.
