// Relative dates in plain words -> an inclusive { from, to } of YYYY-MM-DD, or null.
// Weeks start on Monday. Only phrases listed here are understood; anything else
// is left alone rather than guessed.

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));

const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
// "October 1", "1 Oct", "Oct 1st 2026", "2026-10-01". A missing year means this year.
const DATE_TOKEN = new RegExp(
  `(?:(\\d{4})-(\\d{2})-(\\d{2}))|(?:\\b${MONTH_RE}\\.? ?(\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b)|(?:\\b(\\d{1,2})(?:st|nd|rd|th)? ?${MONTH_RE}\\b(?:,? (\\d{4}))?)`,
  "g"
);

function parseDates(m, now) {
  const out = [];
  for (const hit of m.matchAll(DATE_TOKEN)) {
    let y;
    let mo;
    let da;
    if (hit[1]) [y, mo, da] = [Number(hit[1]), Number(hit[2]) - 1, Number(hit[3])];
    else if (hit[4]) [mo, da, y] = [MONTHS[hit[4]], Number(hit[5]), hit[6] ? Number(hit[6]) : now.getFullYear()];
    else [da, mo, y] = [Number(hit[7]), MONTHS[hit[8]], hit[9] ? Number(hit[9]) : now.getFullYear()];
    const d = new Date(y, mo, da);
    if (d.getMonth() === mo && d.getDate() === da) out.push({ d, index: hit.index });
  }
  return out;
}

function extractDateRange(m, now = new Date()) {
  // 4/10/2026 could be 4 October or April 10: ask rather than guess.
  const slash = m.match(/(?:^|[^0-9])(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?![0-9])/);
  if (slash && Number(slash[1]) <= 12 && Number(slash[2]) <= 12 && slash[1] !== slash[2]) return { ambiguous: true };
  const dates = parseDates(m, now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dates.length >= 2) {
    const [a, b] = dates.map((x) => x.d).sort((x, y) => x - y);
    return { from: ymd(a), to: ymd(b), label: `${ymd(a)} to ${ymd(b)}` };
  }
  if (dates.length === 1) {
    const day = dates[0].d;
    if (/\b(?:since|from|after)\b/.test(m)) return { from: ymd(day), to: ymd(today), label: `since ${ymd(day)}` };
    if (/\b(?:before|until|till|up to)\b/.test(m)) return { from: "2000-01-01", to: ymd(day), label: `until ${ymd(day)}` };
    return { from: ymd(day), to: ymd(day), label: ymd(day) };
  }
  if (/\bthis year\b/.test(m)) return { from: ymd(new Date(now.getFullYear(), 0, 1)), to: ymd(today), label: "this year" };
  return extractRelativeRange(m, now);
}


function extractRelativeRange(m, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let hit;
  if (/\btoday\b/.test(m)) return { from: ymd(today), to: ymd(today), label: "today" };
  if (/\byesterday\b/.test(m)) return { from: ymd(addDays(today, -1)), to: ymd(addDays(today, -1)), label: "yesterday" };
  if ((hit = m.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/))) {
    const n = Math.min(Number(hit[1]), 365);
    return { from: ymd(addDays(today, -(n - 1))), to: ymd(today), label: `the last ${n} days` };
  }
  if (/\b(last|past|previous)\s+week\b/.test(m)) {
    const start = addDays(startOfWeek(today), -7);
    return { from: ymd(start), to: ymd(addDays(start, 6)), label: "last week" };
  }
  if (/\bthis week\b/.test(m)) return { from: ymd(startOfWeek(today)), to: ymd(today), label: "this week" };
  if (/\b(last|previous)\s+month\b/.test(m)) {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { from: ymd(first), to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)), label: "last month" };
  }
  if (/\bthis month\b/.test(m)) return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today), label: "this month" };
  return null;
}

module.exports = { extractDateRange };
