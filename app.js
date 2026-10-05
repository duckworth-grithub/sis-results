/* Screens in Schools — results page.
 *
 * 1. Read audience + the respondent's answers from the URL (#hash, or query as a fallback),
 *    then immediately strip them from the address bar. Answers live in memory only.
 *    Answers arrive as Qualtrics recode values (${q://QIDnn/SelectedChoicesRecode}).
 * 2. Fetch ./results/results-data.json (no-store). Fall back to the baked-in SNAPSHOT if it fails.
 * 3. Render. Sentence logic and phrasing tables follow the v10 design references.
 */
(function () {
  'use strict';

  var AUDIENCES = ['student', 'educator', 'elementary'];
  var GREEN = '#2C7A4B';

  // ---------------------------------------------------------------------------
  // Answer tables: [label used in results-data.json, sentence tail, Qualtrics recode]
  // Recodes are from the 2026-27 .qsf files and must match export/results_export.py.
  // ---------------------------------------------------------------------------
  var WHEN = [
    ['Bell-to-bell', 'have bell-to-bell policies', 1],
    ['Schedule-based restriction', 'have schedule-based policies', 2],
    ['No school-wide restriction', 'have no school-wide restriction', 3]
  ];
  var WHERE = [
    ['Phones cannot be brought into school at all', 'ban phones from school', 1],
    ['Centralized collection', 'use centralized collection', 2],
    ['Yondr pouches or similar', 'use lockable pouches', 3],
    ['Classroom collection', 'collect phones in class', 5],
    ['Lockers only', 'use lockers only', 4],
    ["'No show' (out of sight)", "use 'no show'", 6],
    ['No school-wide policy', 'have no storage policy', 7]
  ];
  var TEACHER = [
    ['Never', 'never see a teacher on their phone in class', 0],
    ['Once per week', 'see a teacher on their phone about once a week', 1],
    ['A few times per week', 'see a teacher on their phone a few times a week', 2],
    ['Most days of the week', 'see a teacher on their phone most days', 3],
    ['Every day', 'see a teacher on their phone every day', 4]
  ];
  var ACCESS = [
    ['1:1 devices', 'have a 1:1 device policy', 1],
    ['Cart or library checkout', 'have students check out devices from a cart or library', 2],
    ['Computer lab', 'send students to a computer lab', 3],
    ['Bring your own device', 'have students bring their own devices', 4],
    ['No device access', 'say students have no device access', 5]
  ];
  var SCREEN = [
    ['Too high', 'say screen time is too high.', 3],
    ['About right', 'say screen time is about right.', 2],
    ['Too low', 'say screen time is too low.', 1]
  ];
  // Old 5-point labels (before the Sep 2026 edit), folded into the three groups if a data file carries them.
  var SCREEN_OLD = { 'Too high': ['A little too high', 'Much too high'], 'About right': [], 'Too low': ['A little too low', 'Much too low'] };
  var HRS = ['None', 'Up to 1 hour', '1 to 2 hours', '2 to 3 hours', '3 to 4 hours', '4 to 5 hours', 'More than 5 hours'];
  var HOURS = HRS.map(function (l, k) { return [l, '', k]; });
  var WYR_READ = [['Read things in hard copy', '', 1], ['Read things on a screen', '', 2]];
  var WYR_HW = [['Do more homework on a computer', '', 1], ['Do more homework on paper', '', 2]];
  var S_STRICT = [['More strict', '', 1], ['Just right', '', 2], ['Less strict', '', 3]];
  var E_STRICT = [['Much more restrictive', '', 1], ['A little more restrictive', '', 2], ['The policy is just right', '', 3],
    ['A little less restrictive', '', 4], ['Much less restrictive', '', 5]];
  var YESNO = [['Yes', '', 1], ['No', '', 0]];
  var CHARGE = [
    ['view_hardcopy', 'Assign only hard-copy readings'],
    ['view_ban_hw', 'Ban homework requiring a computer'],
    ['view_ban_device', 'Ban laptops and tablets in school for kindergarten through 2nd grade']
  ];

  // URL param → [question key, kind, answer table]. kind: choice | multi | scale (recode 0–100 → 0–10)
  var PARAMS = {
    student: {
      when: ['policy_when', 'choice', WHEN],
      where: ['policy_where', 'choice', WHERE],
      phone: ['use_phone_class', 'scale'],
      laptop: ['use_laptop_class', 'scale'],
      teacher: ['use_teacher_phone', 'choice', TEACHER],
      strict: ['policy_strict', 'choice', S_STRICT],
      read: ['wyr_read', 'choice', WYR_READ],
      hw: ['wyr_homework', 'choice', WYR_HW]
    },
    educator: {
      when: ['policy_when', 'choice', WHEN],
      where: ['policy_where', 'choice', WHERE],
      enforce: ['policy_enforce', 'scale'],
      between: ['use_between', 'scale'],
      phone: ['use_phone_class', 'scale'],
      laptop: ['use_laptop_class', 'scale'],
      satisf: ['policy_satisf', 'scale'],
      strict: ['policy_strict', 'choice', E_STRICT],
      screentime: ['view_screentime', 'choice', SCREEN],
      hardcopy: ['view_hardcopy', 'choice', YESNO],
      banhw: ['view_ban_hw', 'choice', YESNO],
      bandevice: ['view_ban_device', 'choice', YESNO]
    },
    elementary: {
      access: ['tech_access', 'multi', ACCESS],
      takehome: ['tech_take_home', 'scale'],
      read: ['tech_screen_read', 'scale'],
      hw: ['tech_screen_hw', 'scale'],
      pers: ['use_instr_personal', 'choice', HOURS],
      other: ['use_instr_other', 'choice', HOURS],
      noninstr: ['use_noninstr', 'choice', HOURS],
      screentime: ['view_screentime', 'choice', SCREEN],
      hardcopy: ['view_hardcopy', 'choice', YESNO],
      banhw: ['view_ban_hw', 'choice', YESNO],
      bandevice: ['view_ban_device', 'choice', YESNO]
    }
  };

  // ---------------------------------------------------------------------------
  // Baked-in snapshot — the design references' sample numbers. Used when the
  // live file can't be loaded. Never mixed into live data: a null question in the
  // live file shows "Not enough responses yet".
  // ---------------------------------------------------------------------------
  var VIEWS_SAMPLE = {
    view_screentime: { kind: 'choice', options: { 'Too high': 44, 'About right': 39, 'Too low': 17 } },
    view_hardcopy: { kind: 'choice', options: { Yes: 33, No: 67 } },
    view_ban_hw: { kind: 'choice', options: { Yes: 22, No: 78 } },
    view_ban_device: { kind: 'choice', options: { Yes: 61, No: 39 } }
  };
  var SNAPSHOT = {
    generated_at: null,
    audiences: {
      student: { questions: {
        wyr_read: { kind: 'choice', options: { 'Read things in hard copy': 40, 'Read things on a screen': 60 } },
        wyr_homework: { kind: 'choice', options: { 'Do more homework on paper': 35, 'Do more homework on a computer': 65 } },
        policy_when: { kind: 'choice', options: { 'Bell-to-bell': 56, 'Schedule-based restriction': 38, 'No school-wide restriction': 6 } },
        policy_where: { kind: 'choice', options: { 'Phones cannot be brought into school at all': 0, 'Centralized collection': 13, 'Yondr pouches or similar': 6, 'Classroom collection': 19, 'Lockers only': 19, "'No show' (out of sight)": 25, 'No school-wide policy': 19 } },
        use_phone_class: { kind: 'scale', dist: [13, 31, 6, 25, 6, 0, 6, 13, 0, 0, 0] },
        use_laptop_class: { kind: 'scale', dist: [13, 19, 13, 13, 13, 13, 0, 13, 6, 0, 0] },
        use_teacher_phone: { kind: 'choice', options: { 'Never': 0, 'Once per week': 50, 'A few times per week': 25, 'Most days of the week': 13, 'Every day': 13 } }
      } },
      educator: { questions: Object.assign({
        policy_when: { kind: 'choice', options: { 'Bell-to-bell': 44, 'Schedule-based restriction': 39, 'No school-wide restriction': 17 } },
        policy_where: { kind: 'choice', options: { 'Phones cannot be brought into school at all': 22, 'Centralized collection': 28, 'Yondr pouches or similar': 22, 'Classroom collection': 11, 'Lockers only': 6, "'No show' (out of sight)": 0, 'No school-wide policy': 11 } },
        use_phone_class: { kind: 'scale', dist: [0, 11, 11, 22, 33, 17, 0, 0, 0, 0, 6] },
        use_between: { kind: 'scale', dist: [6, 22, 17, 28, 11, 6, 6, 6, 0, 0, 0] },
        use_laptop_class: { kind: 'scale', dist: [0, 6, 11, 17, 33, 0, 11, 11, 6, 0, 6] },
        policy_satisf: { kind: 'scale', dist: [6, 6, 11, 6, 17, 28, 0, 11, 6, 0, 11] }
      }, VIEWS_SAMPLE) },
      elementary: { questions: Object.assign({
        tech_access: { kind: 'multi', options: { '1:1 devices': 50, 'Cart or library checkout': 19, 'Computer lab': 13, 'Bring your own device': 13, 'No device access': 6 } },
        tech_screen_read: { kind: 'scale', dist: [8, 33, 33, 8, 0, 0, 0, 8, 0, 8, 0] },
        tech_screen_hw: { kind: 'scale', dist: [8, 33, 17, 17, 25, 0, 0, 0, 0, 0, 0] },
        use_instr_personal: { kind: 'choice', options: zip(HRS, [8, 25, 25, 17, 17, 8, 0]) },
        use_instr_other: { kind: 'choice', options: zip(HRS, [8, 33, 25, 8, 8, 8, 8]) },
        use_noninstr: { kind: 'choice', options: zip(HRS, [8, 58, 0, 25, 8, 0, 0]) }
      }, VIEWS_SAMPLE) }
    }
  };
  function zip(keys, vals) { var o = {}; keys.forEach(function (k, i) { o[k] = vals[i]; }); return o; }

  // ---------------------------------------------------------------------------
  // 1. Read answers, then scrub the URL before anything else happens
  // ---------------------------------------------------------------------------
  function toCode(s) { return /^\d{1,3}$/.test(s) ? +s : null; }
  // 0–10 scale answers (satisf, enforce, between, phone, laptop, takehome, read, hw). Qualtrics sends the recode
  // 0, 10 … 100; also accept a label that starts with a percentage ("70%", "0% (not at all satisfied)") and a bare
  // 1–9 already on the 0–10 scale. "10" is read as the recode (10% → 1), never as 10/10. Anything else → missing.
  function toScale(raw) {
    var s = String(raw).trim(), m = s.match(/^(\d{1,3})\s*%/);
    if (m) s = m[1];
    else if (!/^\d{1,3}$/.test(s)) return null;
    var n = +s;
    if (n <= 100 && n % 10 === 0) return n / 10;
    return !m && n >= 1 && n <= 9 ? n : null;
  }
  function readParams() {
    var q = new URLSearchParams(location.search);
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    var get = function (k) { return h.has(k) ? h.get(k) : q.get(k); };
    var a = (get('a') || '').toLowerCase();
    if (AUDIENCES.indexOf(a) < 0) return null; // no or unknown `a` → caller redirects to the survey
    var audience = a;
    // One educator-survey link serves both pages: QID44 recode 1 = "Mostly elementary school".
    var level = String(get('level') || '').trim();
    if (audience !== 'student' && level) audience = level === '1' ? 'elementary' : 'educator';
    var picks = {};
    var spec = PARAMS[audience];
    Object.keys(spec).forEach(function (param) {
      var raw = get(param);
      if (raw == null || String(raw).trim() === '') return;
      var key = spec[param][0], kind = spec[param][1], table = spec[param][2];
      var byCode = function (c) { return (table.filter(function (o) { return o[2] === c; })[0] || [])[0]; };
      if (kind === 'scale') {
        var v = toScale(raw);
        if (v !== null) picks[key] = v;
      } else if (kind === 'multi') {
        // Select-all arrives comma-joined. YOU marks every pick; the headline uses the first.
        var hits = String(raw).split(/[\s,]+/).map(toCode).map(byCode).filter(Boolean);
        if (hits.length) picks[key] = hits.filter(function (h, i) { return hits.indexOf(h) === i; });
      } else {
        var hit = byCode(toCode(String(raw).trim()));
        if (hit) picks[key] = hit; // unknown code → treated as missing
      }
    });
    var librarian = String(get('role') || '').trim().toLowerCase() === 'librarian';
    return { audience: audience, picks: picks, librarian: librarian };
  }

  // Bare visits (no valid `a` in the #hash or the ?query) go to the survey instead, before any data is fetched.
  // `a` is also read from the query because student links are `?a=student` and the page rewrites the address bar
  // to `?a=<audience>` below, so reloads and shared links carry `a` there.
  var parsed = readParams();
  if (!parsed) {
    location.replace('https://screensinschools.org');
    return;
  }
  try {
    history.replaceState(null, '', location.pathname + '?a=' + parsed.audience + (parsed.librarian ? '&role=librarian' : ''));
  } catch (e) { /* file:// or sandboxed — nothing to scrub */ }

  var AUD = parsed.audience;
  // Librarians (`role=librarian`) answer only some of the educator questions. Their page shows only the sections
  // they answered, with their answers marked YOU and no green highlights. District librarians answer none of the
  // linked questions, so they see just the AI section (they answer the same AI matrix).
  var LIB = parsed.librarian;
  var ANSWERED = parsed.picks;
  var P = parsed.picks;
  // Generic view: no valid answers in the URL. Then green marks the aggregate (most common / average);
  // otherwise green means YOU only and aggregates stay grey/dark.
  var GENERIC = !LIB && Object.keys(P).length === 0;
  var NOUN = AUD === 'student' ? 'students' : 'educators';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var sum = function (a) { return a.reduce(function (s, x) { return s + x; }, 0); };
  var r0 = function (x) { return Math.round(Number(x) || 0); };
  var lc1 = function (s) { return s.charAt(0).toLowerCase() + s.slice(1); };
  var num = function (n) { return '<span class="n">' + n + '%</span>'; };
  function argmax(a) { return a.reduce(function (b, x, k) { return x > a[b] ? k : b; }, 0); }
  function meanOf(q) {
    if (typeof q.mean === 'number') return q.mean;
    var tot = sum(q.dist) || 1;
    return sum(q.dist.map(function (d, k) { return d * k; })) / tot;
  }
  function section(cls, id, inner) {
    return '<section class="q ' + cls + '" id="' + id + '">' + inner + '</section>';
  }
  var EMPTY = '<p class="empty">Not enough responses yet</p>';
  function emptySection(id, title) {
    return section('', id, '<h3>' + esc(title) + '</h3>' + EMPTY);
  }
  // pct fills with `fill`, the remainder with `rest`; the centre number uses `ink`.
  function pie(pct, fill, rest, ink) {
    return '<div class="pie" style="background:conic-gradient(' + (fill || '#444444') + ' 0 ' + pct + '%, ' + (rest || '#DADADA') + ' 0)">' +
      '<div class="pie-core"' + (ink ? ' style="color:' + ink + '"' : '') + '>' + pct + '%</div></div>';
  }
  // `accent` (optional) recolours the big number and progress fill, leaving the small label as `color`.
  function card(k, color, pct, text, accent) {
    var a = accent || color;
    return '<div class="card"><div class="card-k" style="color:' + color + '">' + k + '</div>' +
      '<div class="card-v" style="color:' + a + '">' + pct + '%</div>' +
      '<div class="card-track"><div style="width:' + pct + '%;background:' + a + '"></div></div>' +
      (text ? '<div class="card-t">' + text + '</div>' : '') + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Chart builders
  // ---------------------------------------------------------------------------
  // pick: a label, an array of labels in the order selected (select-all), or undefined.
  // Every picked row is marked YOU; the headline follows the first pick.
  // fixedHead (optional, trusted HTML) replaces the computed percentage headline.
  // shown (optional) maps a data label to the text displayed on its row, e.g. the student survey's own wording.
  // popular (optional): tag the most common answer(s) "MOST COMMON".
  function barsSection(id, title, table, q, pick, fixedHead, shown, popular) {
    if (!q) return emptySection(id, title);
    var picks = pick == null ? [] : [].concat(pick);
    var rows = table.map(function (o) {
      return { label: o[0], tail: o[1], pct: r0(q.options[o[0]]), you: picks.indexOf(o[0]) >= 0 };
    });
    var pcts = rows.map(function (r) { return r.pct; });
    var max = Math.max.apply(null, pcts) || 1;
    var head;
    var y = rows.filter(function (r) { return r.label === picks[0]; })[0];
    if (y) {
      head = y.pct ? num(y.pct) + ' of ' + NOUN + ' also ' + esc(y.tail) + '.'
        : AUD === 'student' ? 'No other students chose “' + esc(y.label) + '.”'
        : 'No other educators ' + esc(y.tail) + '.';
    } else {
      // No answer in the URL → highlight the most common response (no "also": it isn't theirs).
      var m = rows[argmax(pcts)];
      m.you = GENERIC;
      head = num(m.pct) + ' of ' + NOUN + ' ' + esc(m.tail) + '.';
    }
    var body = rows.map(function (r) {
      var top = popular && r.pct === max && r.pct > 0;
      return '<div class="row' + (r.you ? ' you' : '') + (top ? ' popular' : '') + '">' +
        '<div class="row-label">' + esc((shown && shown[r.label]) || r.label) + '</div>' +
        '<div class="row-bar"><div class="fill" style="width:' + (r.pct / max * 82) + '%"></div>' +
        '<div class="pct">' + r.pct + '%</div>' + (top ? '<span class="pop-tag">MOST COMMON</span>' : '') + '</div></div>';
    }).join('');
    return section('', id, '<h3>' + (fixedHead || head) + '</h3><div class="rows">' + body + '</div>');
  }

  // Rows for YOU vs AVERAGE charts. youP/avgP are 0–100 bar lengths.
  function scaleRow(caption, q, val) {
    if (!q) return { caption: caption, empty: true };
    var m = meanOf(q), has = typeof val === 'number';
    return { caption: caption, has: has, youP: has ? val * 10 : 0, avgP: m * 10,
      youPct: has ? (val * 10) + '%' : '', avgPct: Math.round(m * 10) + '%' };
  }
  var MID = [0, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
  var YOUT = ['None', '< 1 hr', '1–2 hrs', '2–3 hrs', '3–4 hrs', '4–5 hrs', '5+ hrs'];
  // Hours per day: AVERAGE is the mean of the bucket midpoints, placed in the answer bucket it
  // falls in (None = 0; "Up to 1 hour" = (0, 1]; "1 to 2 hours" = (1, 2]; …; "More than 5" = > 5).
  // It is shown with the same bucket label and midpoint bar height as YOU.
  function hoursRow(caption, q, pick) {
    if (!q) return { caption: caption, empty: true };
    var dist = HRS.map(function (l) { return Number(q.options[l]) || 0; });
    var mean = sum(dist.map(function (d, k) { return d * MID[k]; })) / (sum(dist) || 1);
    var b = Math.min(HRS.length - 1, Math.ceil(mean));
    var i = HRS.indexOf(pick), has = i >= 0;
    return { caption: caption, has: has, youP: has ? MID[i] / 5.5 * 100 : 0, avgP: MID[b] / 5.5 * 100,
      youPct: has ? YOUT[i] : '', avgPct: YOUT[b] };
  }

  // Vertical YOU/AVERAGE columns on desktop, horizontal bars + legend on mobile.
  // captions are trusted HTML from this file (they may contain a desktop-only <br>).
  // avgLabel names the comparison column ('AVERAGE' unless given, e.g. 'U.S. AVERAGE' on the student page).
  function compareSection(id, title, rows, capClass, avgLabel) {
    avgLabel = avgLabel || 'AVERAGE';
    if (rows.every(function (r) { return r.empty; })) return emptySection(id, title);
    var live = rows.filter(function (r) { return !r.empty; });
    var mx = Math.max.apply(null, live.reduce(function (a, r) { return a.concat([r.youP, r.avgP]); }, [0.1]));
    var anyYou = live.some(function (r) { return r.has; });
    var legend = '<div class="legend">' +
      (anyYou ? '<div class="is-you"><span class="bg-you"></span>YOU</div>' : '') +
      '<div class="is-avg"><span style="background:#BDBDBD"></span>' + avgLabel + '</div></div>';
    var cap = function (r) { return '<div class="multi-cap ' + (capClass || '') + '"><span>' + r.caption + '</span></div>'; };
    var body = rows.map(function (r) {
      if (r.empty) return '<div class="multi-item">' + cap(r) + EMPTY + '</div>';
      var youCol = r.has ? '<div class="col"><div class="col-v is-you">' + r.youPct + '</div><div class="col-bar bg-you" style="height:' + (r.youP / mx * 82) + '%"></div></div>' : '';
      var avgCol = '<div class="col"><div class="col-v is-avg">' + r.avgPct + '</div><div class="col-bar bg-avg" style="height:' + (r.avgP / mx * 82) + '%"></div></div>';
      var keys = (r.has ? '<div class="is-you">YOU</div>' : '') + '<div class="is-avg">' + avgLabel + '</div>';
      var hYou = r.has ? '<div class="hbar"><div class="fill bg-you" style="width:' + r.youP + '%"></div><span class="v is-you">' + r.youPct + '</span></div>' : '';
      var hAvg = '<div class="hbar"><div class="fill bg-avg" style="width:' + r.avgP + '%"></div><span class="v is-avg">' + r.avgPct + '</span></div>';
      return '<div class="multi-item">' + cap(r) +
        '<div class="cols">' + youCol + avgCol + '</div><div class="col-keys">' + keys + '</div>' +
        '<div class="hbars">' + hYou + hAvg + '</div></div>';
    }).join('');
    return section('multi-q' + (GENERIC ? ' agg' : ''), id, '<h3>' + esc(title) + '</h3>' + legend + '<div class="multi">' + body + '</div>');
  }

  // Elementary "How much is done on a screen?": one heading + YOU/AVERAGE cards per question
  function boxesSection(id, rows) {
    var body = rows.map(function (r) {
      var inner = !r.q ? EMPTY : '<div class="cards">' +
        (typeof r.val === 'number' ? card('YOU', GREEN, r.val * 10) : '') +
        card('AVERAGE', '#5E5E5E', Math.round(meanOf(r.q) * 10), '', GENERIC && GREEN) + '</div>';
      return '<div class="box"><h3>' + esc(r.title) + '</h3>' + inner + '</div>';
    }).join('');
    return section('boxes-q', id, '<div class="boxes">' + body + '</div>');
  }

  function wyrSection(qs) {
    var items = [WYR_READ, WYR_HW].map(function (t, k) {
      var q = qs[k];
      if (!q) return '';
      var lp = r0(q.options[t[0][0]]), rp = r0(q.options[t[1][0]]);
      var pick = lp >= rp ? [t[0][0], lp] : [t[1][0], rp];
      return '<div style="display:flex"><div class="wyr-item">' + (GENERIC ? pie(pick[1], GREEN, '#DADADA', GREEN) : pie(pick[1])) +
        '<div class="wyr-label">' + esc(lc1(pick[0])) + '</div></div></div>';
    }).join('');
    var title = 'Students would rather...';
    if (!items) return emptySection('wyr', title);
    return section('wyr', 'wyr', '<h3>' + title + '</h3><div class="wyr-grid">' + items + '</div>');
  }

  function satisfactionSection(q, val) {
    var title = 'How satisfied are you with your policy?';
    if (!q) return emptySection('satisfaction', title);
    var cards = (typeof val === 'number' ? card('YOU', GREEN, val * 10, 'satisfied with your phone policy') : '') +
      card('AVERAGE', '#5E5E5E', Math.round(meanOf(q) * 10), 'satisfied with their phone policy', GENERIC && GREEN);
    return section('', 'satisfaction', '<h3>' + title + '</h3><div class="cards">' + cards + '</div>');
  }

  var RAMP3 = [['#6B6B6B', '#FFFFFF'], ['#B4B4B4', '#1A1A1A'], ['#E0E0E0', '#1A1A1A']];

  // A single stacked bar in the screen-time style, for a set of answers in a fixed order. The most common answer is
  // green with "▲ MOST COMMON" under it; segments too narrow for their text show it below the bar at every width.
  // items: [[data label, label shown]].
  function stackSection(id, title, head, q, items) {
    if (!q) return emptySection(id, title);
    var ps = items.map(function (it) { return r0(q.options[it[0]]); });
    var mi = argmax(ps), tot = sum(ps) || 1;
    var segs = ps.map(function (p, k) {
      var w = p / tot * 100, top = k === mi && p > 0;
      return { p: p, w: w, label: items[k][1], narrow: w < 16, top: top,
        bg: top ? GREEN : RAMP3[k % 3][0], fg: top ? '#FFFFFF' : RAMP3[k % 3][1],
        ai: k === 0 ? 'flex-start' : k === ps.length - 1 ? 'flex-end' : 'center' };
    });
    var bar = segs.map(function (s) {
      return '<div class="seg' + (s.narrow ? ' narrow' : '') + '" style="width:' + s.w + '%;background:' + s.bg + ';color:' + s.fg + '">' +
        '<div class="seg-p">' + s.p + '%</div><div class="seg-l">' + esc(s.label) + '</div></div>';
    }).join('');
    var under = segs.map(function (s) {
      return '<div class="under' + (s.narrow ? ' narrow' : '') + '" style="width:' + s.w + '%">' +
        (s.top ? '<span class="you-tag">\u25B2 MOST COMMON</span>' : '') +
        '<div class="callout" style="align-items:' + s.ai + '"><div class="callout-tick" style="align-self:center"></div>' +
        '<div class="callout-body" style="align-self:' + s.ai + ';align-items:' + s.ai + '"><b>' + s.p + '%</b><span>' + esc(s.label) + '</span></div></div></div>';
    }).join('');
    return section('stack-always', id, '<h3>' + head + '</h3><div class="stack-wrap"><div class="stack">' + bar + '</div><div class="stack-under">' + under + '</div></div>');
  }
  function screenTimeSection(q, pick) {
    // Wording follows each survey: QID49 (MS/HS) was reworded 2026-09-30; QID36 (elementary) was not.
    var title = AUD === 'educator'
      ? 'I think the time my students spend on computers or tablets during school hours is…'
      : 'During school hours, I think the time my students spend on computers or tablets is…';
    if (!q) return emptySection('screenTime', title);
    var groups = SCREEN.map(function (s) {
      return r0([s[0]].concat(SCREEN_OLD[s[0]]).reduce(function (t, l) { return t + (Number(q.options[l]) || 0); }, 0));
    });
    var yi = SCREEN.map(function (s) { return s[0]; }).indexOf(pick);
    var mi = argmax(groups);
    var tot = sum(groups) || 1;
    var hi = GENERIC ? mi : yi; // green segment: largest in the generic view, else the respondent's
    var segs = groups.map(function (p, k) {
      var w = p / tot * 100, you = k === yi, g = k === hi;
      return { p: p, w: w, label: SCREEN[k][0], narrow: w < 16,
        bg: g ? GREEN : RAMP3[k][0], fg: g ? '#FFFFFF' : RAMP3[k][1], you: you,
        ai: k === 0 ? 'flex-start' : k === groups.length - 1 ? 'flex-end' : 'center' };
    });
    var bar = segs.map(function (s) {
      return '<div class="seg' + (s.narrow ? ' narrow' : '') + '" style="width:' + s.w + '%;background:' + s.bg + ';color:' + s.fg + '">' +
        (s.p >= 5 ? '<div class="seg-p">' + s.p + '%</div>' : '<div class="seg-p"></div>') +
        '<div class="seg-l">' + esc(s.label) + '</div></div>';
    }).join('');
    var under = segs.map(function (s) {
      return '<div class="under' + (s.narrow ? ' narrow' : '') + '" style="width:' + s.w + '%">' +
        (s.you ? '<span class="you-tag">▲ YOU</span>' : '') +
        '<div class="callout" style="align-items:' + s.ai + '"><div class="callout-tick" style="align-self:center"></div>' +
        '<div class="callout-body" style="align-self:' + s.ai + ';align-items:' + s.ai + '"><b>' + s.p + '%</b><span>' + esc(s.label) + '</span></div></div></div>';
    }).join('');
    // Headline is the majority view; "also" only when that's the respondent's own answer.
    var head = num(groups[mi]) + ' of educators ' + (yi === mi ? 'also ' : '') + SCREEN[mi][1];
    return section('', 'screenTime', '<h3>' + head + '</h3><div class="stack-wrap"><div class="stack">' + bar + '</div><div class="stack-under">' + under + '</div></div>');
  }

  function chargeSection(qs) {
    var title = 'If educators were in charge...';
    var rows = CHARGE.map(function (c, k) { return qs[k] ? { label: c[1], yes: r0(qs[k].options.Yes) } : null; })
      .filter(Boolean).sort(function (a, b) { return b.yes - a.yes; });
    if (!rows.length) return emptySection('inCharge', title);
    var body = rows.map(function (r) {
      // Always the Yes share and "would …". Generic view: green Yes arc on #DADADA; with answers, #444444.
      var p = GENERIC ? pie(r.yes, GREEN, '#DADADA') : pie(r.yes);
      return '<div class="charge-row">' + p + '<div class="charge-label">would ' + esc(lc1(r.label)) + '</div></div>';
    }).join('');
    return section('charge', 'inCharge', '<h3>' + title + '</h3><div class="charge-list">' + body + '</div>');
  }

  // ---------------------------------------------------------------------------
  // Library checkouts (all librarian pages). View B of LIBRARIAN_HANDOFF.md: average yearly checkouts for a balanced
  // panel (the same libraries every year), so a rise is a real rise. The data job adds this
  // year's libraries to last year's baseline (handoff §4, 2 July 2026); this copy is shown only if that file is missing.
  // ---------------------------------------------------------------------------
  var CIRC_BASELINE = {
    panel: { n: 107, years: [
      { year: '2022-23', mean: 5815 },
      { year: '2023-24', mean: 5900 },
      { year: '2024-25', mean: 6171 },
      { year: '2025-26', mean: 6479 }
    ] }
  };
  function circData(live) {
    var c = live && live.librarian && live.librarian.circulation;
    return c && c.panel ? c : CIRC_BASELINE;
  }
  // Percent change only (no averages on the page): each year vs the first, bars from zero.
  function circSection(c) {
    var ys = c.panel.years, first = ys[0].mean;
    var change = function (y) { return (y.mean / first - 1) * 100; };
    var ch = Math.round(change(ys[ys.length - 1]));
    var head = ch === 0 ? 'School library checkouts have held steady since ' + ys[0].year + '.'
      : 'School library checkouts are ' + (ch > 0 ? 'up ' : 'down ') + Math.abs(ch) + '% since ' + ys[0].year + '.';
    var max = Math.max.apply(null, ys.map(function (y) { return Math.abs(change(y)); })) || 1;
    var rows = ys.slice(1).map(function (y) {
      var d = change(y);
      return '<div class="row"><div class="row-label">' + esc(y.year) + '</div>' +
        '<div class="row-bar"><div class="fill' + (d < 0 ? ' down' : '') + '" style="width:' + (Math.abs(d) / max * 82) + '%"></div>' +
        '<div class="pct">' + (d >= 0 ? '+' : '\u2212') + Math.abs(d).toFixed(1) + '%</div></div></div>';
    }).join('');
    return section('circ', 'circulation', '<h3>' + head + '</h3>' +
      '<div class="rows">' + rows + '</div>');
  }

  // Library checkouts in the current school year so far (live data only; there's no baseline for it).
  // Placeholder layout: the copy and chart are still to be decided.
  function soFarSection(live) {
    var c = live && live.librarian && live.librarian.circulation, s = c && c.so_far;
    if (!s) return section('', 'circSoFar', '<h3>Library checkouts so far this school year</h3>' + EMPTY);
    var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
    return section('circ', 'circSoFar', '<h3>So far in ' + esc(s.year) + ', school librarians have reported ' + fmt(s.total) + ' checkouts.</h3>');
  }

  // MS/HS only: aggregate approval per AI use (QID110). No comparison, no YOU, nothing from the URL.
  function aiSection(q) {
    var title = 'Educators think students should be allowed to use AI to…';
    var rows = q && q.rows ? Object.keys(q.rows).map(function (k) { return { label: k, pct: r0(q.rows[k]) }; }) : [];
    if (!rows.length) return emptySection('aiUse', title);
    rows.sort(function (a, b) { return b.pct - a.pct; });
    var body = rows.map(function (r) {
      return '<div class="ai-row"><div class="ai-label">' + esc(r.label) + '</div>' +
        '<div class="ai-bar"><div class="fill" style="width:' + r.pct + '%"></div><span class="pct">' + r.pct + '%</span></div></div>';
    }).join('');
    return section('ai', 'aiUse', '<h3>' + title + '</h3><div class="ai-sub">Percent of educators who approve</div>' +
      '<div class="ai-rows">' + body + '</div>');
  }

  // Share callout at the end of every report. Copy, links and wording match the survey end screens; every action
  // shares the survey landing page, never the results page.
  var SHARE_URL = 'https://screensinschools.org';
  var SHARE = {
    student: { head: 'Share with a friend',
      sub: 'Especially at other schools—we\'re trying to reach every school in the U.S.',
      sms: 'I just took this 5-min survey. It asks what you think about phones and laptops at school, and you get entered into a giveaway: ',
      subject: 'What do you think about tech in schools?',
      email: 'I just took this 5-min survey. It asks what you think about phones and laptops at school, and you get entered to win a gift card: ' },
    educator: { head: 'Share with a colleague',
      sub: 'Especially educators at other schools—we\'re trying to reach every school in the U.S.',
      sms: 'I just took this 5-min survey about device policies. What do you think about tech use in schools? Take the survey here: ',
      subject: 'How are screens impacting your students?',
      email: 'State leaders need to hear directly from educators.\n\nI just took this 5-min survey: ' },
    librarian: { head: 'Share with a colleague',
      sub: 'Especially librarians at other schools—we\'re trying to reach every school in the U.S.',
      sms: 'I just took this 5-min survey about device policies. What do you think about tech use in schools? Take the survey here: ',
      subject: 'How are screens impacting reading?',
      email: 'What do you think about tech in schools? And how are tech policies influencing book checkouts?\n\nI just took this 5-min survey: ' }
  };
  // Emoji, as on the survey end screens; the copy button shows a check for 2 seconds after copying.
  var EMOJI = { sms: '\uD83D\uDCAC', email: '\u2709\uFE0F', link: '\uD83D\uDD17', check: '\u2713' };
  function glyph(e) { return '<span class="share-emoji" aria-hidden="true">' + e + '</span>'; }
  function shareCallout() {
    var c = SHARE[LIB ? 'librarian' : AUD === 'student' ? 'student' : 'educator'];
    var sms = 'sms:?&body=' + encodeURIComponent(c.sms + SHARE_URL);
    var mail = 'mailto:?subject=' + encodeURIComponent(c.subject) + '&body=' + encodeURIComponent(c.email + SHARE_URL);
    return '<aside class="share" aria-label="Share the survey">' +
      '<div class="share-text"><div class="share-h">' + esc(c.head) + '</div><div class="share-sub">' + esc(c.sub) + '</div></div>' +
      '<div class="share-icons">' +
      '<a class="share-btn" href="' + esc(sms) + '" target="_blank" rel="noopener" aria-label="Share by text message">' + glyph(EMOJI.sms) + '</a>' +
      '<a class="share-btn" href="' + esc(mail) + '" target="_blank" rel="noopener" aria-label="Share by email">' + glyph(EMOJI.email) + '</a>' +
      '<button class="share-btn" type="button" id="share-copy" aria-label="Copy link">' + glyph(EMOJI.link) + '</button>' +
      '</div></aside>';
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (ok, fail) { // older browsers, non-https, or a refused clipboard
      var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? ok() : fail(); } catch (e) { fail(e); }
      document.body.removeChild(t);
    });
  }
  function wireShare() {
    var b = document.getElementById('share-copy');
    if (!b) return;
    var timer;
    b.addEventListener('click', function () {
      copyText(SHARE_URL).then(function () {
        b.classList.add('copied'); b.setAttribute('aria-label', 'Link copied'); b.querySelector('.share-emoji').textContent = EMOJI.check;
        clearTimeout(timer);
        timer = setTimeout(function () {
          b.classList.remove('copied'); b.setAttribute('aria-label', 'Copy link'); b.querySelector('.share-emoji').textContent = EMOJI.link;
        }, 2000);
      }, function () {});
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Load data, 3. render
  // ---------------------------------------------------------------------------
  function render(live) {
    var src = live || SNAPSHOT;
    var aud = (src.audiences && src.audiences[AUD]) || {};
    var qs = aud.questions || {};
    function Q(key) {
      var v = qs[key];
      return v && (v.options || v.dist || v.rows) ? v : null;
    }
    var WHEN_T = 'Officially, when is the personal use of phones restricted?';
    var WHERE_T = 'Officially, where are students allowed to keep their phones?';

    var html;
    if (AUD === 'student') {
      html = [
        wyrSection([Q('wyr_read'), Q('wyr_homework')]),
        stackSection('restriction', WHEN_T, 'U.S. schools differ on WHEN students can use phones.', Q('policy_when'), [
          // Short versions of the student survey (QID13) answers
          ['Bell-to-bell', 'Not during the school day'],
          ['Schedule-based restriction', 'Sometimes'],
          ['No school-wide restriction', 'No school-wide rule']
        ]),
        barsSection('storage', WHERE_T, WHERE, Q('policy_where'), P.policy_where,
          'U.S. schools differ on WHERE students keep phones.', {
            // Student survey (QID14) wording, shortened
            'Phones cannot be brought into school at all': 'Leave their phones at home',
            'Centralized collection': 'Put their phones in one place at the beginning of the day',
            'Yondr pouches or similar': 'Keep their phones in a pouch that gets locked',
            'Lockers only': 'Keep their phones in their lockers all day',
            'Classroom collection': 'Put their phones in a designated area during each class',
            "'No show' (out of sight)": 'Keep their phones out of sight',
            'No school-wide policy': 'There is no school-wide policy'
          }, true),
        compareSection('usage', 'How many students are...', [
          scaleRow('<span class="cap-emoji" aria-hidden="true">\uD83D\uDCF1</span>...using phones during class?', Q('use_phone_class'), P.use_phone_class),
          scaleRow('<span class="cap-emoji" aria-hidden="true">\uD83D\uDCBB</span>...using laptops during class?', Q('use_laptop_class'), P.use_laptop_class)
        ], '', 'U.S. AVERAGE'),
        barsSection('teacherPhone', 'During class, how often do you see a teacher on their phone for personal reasons?', TEACHER, Q('use_teacher_phone'), P.use_teacher_phone, null, null, true)
      ];
    } else if (AUD === 'educator') {
      html = [
        barsSection('restriction', WHEN_T, WHEN, Q('policy_when'), P.policy_when),
        barsSection('storage', WHERE_T, WHERE, Q('policy_where'), P.policy_where),
        satisfactionSection(Q('policy_satisf'), P.policy_satisf),
        compareSection('usage', 'How many students are...', [
          scaleRow('...using phones during class?', Q('use_phone_class'), P.use_phone_class),
          scaleRow('...using phones between classes?', Q('use_between'), P.use_between),
          scaleRow('...using laptops during class?', Q('use_laptop_class'), P.use_laptop_class)
        ]),
        screenTimeSection(Q('view_screentime'), P.view_screentime),
        chargeSection([Q('view_hardcopy'), Q('view_ban_hw'), Q('view_ban_device')]),
        aiSection(Q('view_ai'))
      ];
    } else {
      html = [
        barsSection('access', 'During the school day, how do your students access computers/tablets?', ACCESS, Q('tech_access'), P.tech_access,
          'Schools differ on how students access devices.'),
        boxesSection('usage', [
          { title: 'How much reading is done on a screen?', q: Q('tech_screen_read'), val: P.tech_screen_read },
          { title: 'How much homework requires a device?', q: Q('tech_screen_hw'), val: P.tech_screen_hw }
        ]),
        compareSection('dayUse', 'How long are students on devices each day?', [
          hoursRow('...for personalized<br class="d-br"> instruction?', Q('use_instr_personal'), P.use_instr_personal),
          hoursRow('...for other<br class="d-br"> instruction?', Q('use_instr_other'), P.use_instr_other),
          hoursRow('...for non-instructional<br class="d-br"> use?', Q('use_noninstr'), P.use_noninstr)
        ], 'two'),
        screenTimeSection(Q('view_screentime'), P.view_screentime),
        chargeSection([Q('view_hardcopy'), Q('view_ban_hw'), Q('view_ban_device')])
      ];
    }
    if (LIB) {
      // Section id → the questions behind it. A librarian sees a section only if they answered one of them;
      // the AI section (no URL parameter) is shown because MS/HS and district librarians answer the same matrix.
      var BEHIND = AUD === 'educator'
        ? { restriction: ['policy_when'], storage: ['policy_where'], satisfaction: ['policy_satisf'],
            usage: ['use_phone_class', 'use_between', 'use_laptop_class'], screenTime: ['view_screentime'],
            inCharge: ['view_hardcopy', 'view_ban_hw', 'view_ban_device'], aiUse: null }
        : { access: ['tech_access'], usage: ['tech_screen_read', 'tech_screen_hw'],
            dayUse: ['use_instr_personal', 'use_instr_other', 'use_noninstr'], screenTime: ['view_screentime'],
            inCharge: ['view_hardcopy', 'view_ban_hw', 'view_ban_device'] };
      html = html.filter(function (h) {
        var keys = BEHIND[(h.match(/id="(\w+)"/) || [])[1]];
        return keys === null || (keys || []).some(function (k) { return k in ANSWERED; });
      });
      // Every librarian (elementary, MS/HS, district) sees library checkouts first.
      html.unshift(circSection(circData(live)), soFarSection(live));
    }
    var box = document.getElementById('sections');
    box.className = 'sections aud-' + AUD + (LIB ? ' lib' : '');
    box.innerHTML = html.join('');
    document.getElementById('share-slot').innerHTML = shareCallout();
    wireShare();

    var note = '';
    if (live && live.generated_at) {
      var d = new Date(live.generated_at);
      if (!isNaN(d)) note = 'This report reflects survey data from ' +
        (LIB ? 'librarians, teachers, and administrators' : AUD === 'student' ? 'students' : 'educators') + ' as of ' +
        d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) + '.';
    }
    if (!live) note = 'Sample data. Live results will appear here once enough responses are in.';
    document.getElementById('as-of').textContent = note;
  }

  if (AUD === 'educator') document.title = 'Compare my classroom · Screens in Schools';

  fetch('./results/results-data.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      if (!data || !data.audiences) throw new Error('bad shape');
      render(data);
    })
    .catch(function () { render(null); });
})();
