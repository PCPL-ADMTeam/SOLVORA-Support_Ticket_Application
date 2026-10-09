const { extractDateRange } = require("./entities/dates");

// Date windows for answers such as "what's new today" or "my ticket summary for the last 7 days".
// A calendar day starts at midnight in the user's own time zone (sent by their browser, checked
// here); without a usable one, UTC. Every window carries what it covers (`label` and `rangeText`),
// so a count is never shown as covering a different period than the one it was counted over.

const DAY_MS = 24 * 60 * 60 * 1000;

// An IANA zone the runtime knows ("Asia/Kolkata"), else "UTC". Never used for any access decision.
function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

// The calendar date and clock time of `date` as seen in `timeZone`.
function partsIn(date, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute, second: p.second };
}

// How far `timeZone` is ahead of UTC at the instant `date`, in ms.
function offsetAt(date, timeZone) {
  const p = partsIn(date, timeZone);
  const t = date.getTime();
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (t - (((t % 1000) + 1000) % 1000));
}

// The instant the local calendar day y-m-d begins in `timeZone` (checked twice for daylight-saving changes).
function startOfLocalDay(y, m, d, timeZone) {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetAt(new Date(guess), timeZone);
  return new Date(guess - offsetAt(new Date(first), timeZone));
}

const ymdParts = (ymd) => ymd.split("-").map(Number);
const addDaysYmd = ([y, m, d], n) => {
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()];
};

function formatDay(date, timeZone, withYear = true) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) }).format(date);
}

// "Oct 9, 2026" for one day, "Oct 3 – Oct 9, 2026" for several (the end shown is the last day included).
function rangeText(from, toExclusive, timeZone) {
  const last = new Date(toExclusive.getTime() - 1);
  const a = formatDay(from, timeZone);
  const b = formatDay(last, timeZone);
  if (a === b) return b;
  const sameYear = partsIn(from, timeZone).year === partsIn(last, timeZone).year;
  return `${formatDay(from, timeZone, !sameYear)} – ${b}`;
}

const titleCase = (s) => {
  const t = String(s).replace(/^the\s+/i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// The window a question asks about, or the last `defaultDays` days when it names none.
// `rolling: true` makes that default exactly `defaultDays` x 24 hours back from now, which is what
// the Dashboard page's "Last N days" filter means; otherwise it is today plus the days before it.
// Returns { from, to } as Dates (`to` is exclusive; "now" for a window that runs up to today),
// plus `label` ("Today", "Last 7 days"), `rangeText` ("Oct 3 – Oct 9, 2026") and `timeZone`.
// { ambiguous: true } when a date like 4/10/2026 could be read two ways.
function resolvePeriod({ question = "", defaultDays = 7, rolling = false, timeZone = "UTC", now = new Date() } = {}) {
  const tz = validTimeZone(timeZone);
  const today = partsIn(now, tz);
  // The date parser reads the calendar from a Date; give it one showing the user's local date and time.
  const localNow = new Date(today.year, today.month - 1, today.day, today.hour, today.minute, today.second);
  let range = extractDateRange(String(question).toLowerCase(), localNow);
  if (range?.ambiguous) return { ambiguous: true };

  // With `rolling`, "the last 7 days" in the question means what the Dashboard's "Last 7 days" means too.
  const typedDays = rolling && range ? Number((range.label.match(/^the last (\d+) days$/) || [])[1]) || null : null;
  if ((!range || typedDays) && rolling) {
    const days = typedDays || defaultDays;
    const from = new Date(now.getTime() - days * DAY_MS);
    return { key: "rolling", days, from, to: now, label: `Last ${days} days`, rangeText: rangeText(from, now, tz), timeZone: tz };
  }
  if (!range) {
    const first = addDaysYmd([today.year, today.month, today.day], -(defaultDays - 1)).map((n) => String(n).padStart(2, "0")).join("-");
    const last = [today.year, today.month, today.day].map((n) => String(n).padStart(2, "0")).join("-");
    range = defaultDays === 1 ? { from: last, to: last, label: "today" } : { from: first, to: last, label: `the last ${defaultDays} days` };
  }

  const todayYmd = [today.year, today.month, today.day];
  const toYmd = ymdParts(range.to);
  const runsToToday = toYmd.join("-") === todayYmd.join("-") || startOfLocalDay(...toYmd, tz) > now;
  const from = startOfLocalDay(...ymdParts(range.from), tz);
  const to = runsToToday ? now : startOfLocalDay(...addDaysYmd(toYmd, 1), tz);
  const text = rangeText(from, runsToToday ? startOfLocalDay(...addDaysYmd(todayYmd, 1), tz) : to, tz);
  const label = /\d{4}-\d{2}-\d{2}/.test(range.label) ? (range.label.startsWith("until") ? `Until ${formatDay(new Date(to.getTime() - 1), tz)}` : text) : titleCase(range.label);
  return { key: range.label === "today" ? "today" : "range", days: Math.max(1, Math.ceil((to - from) / DAY_MS)), from, to, label, rangeText: text, timeZone: tz };
}

// What travels to the browser: plain values only.
const periodView = (p) => ({ label: p.label, rangeText: p.rangeText, from: p.from.toISOString(), to: p.to.toISOString(), timeZone: p.timeZone });

module.exports = { validTimeZone, resolvePeriod, periodView, startOfLocalDay, partsIn, DAY_MS };
