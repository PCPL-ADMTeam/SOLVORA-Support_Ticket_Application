// One-time data upgrade: TicketHistory.oldValue/newValue are plain display
// strings rendered VERBATIM by the Activity History UI (see
// client/src/components/tickets/ActivityTimeline.jsx) — but for several
// actions (ASSIGNED, MANAGER_CHANGE, TEAM_CHANGE, CATEGORY_CHANGE,
// DEPARTMENT_CHANGE, PRIORITY_CHANGE, and the legacy ISSUE_CHANGE), the
// code used to store the raw foreign-key id instead of the referenced
// row's name (e.g. a ticket reassignment showed a bare CUID like
// "cmui1r759005mjydi9q6ygh65" instead of "Ravi Kumar"). ticket.service.js
// has been fixed to store the resolved name going forward — this script
// backfills every EXISTING row still holding a raw id, so already-created
// Activity History entries stop exposing internal identifiers too.
//
// For each affected row, oldValue/newValue is looked up against the
// relevant table (User for ASSIGNED/MANAGER_CHANGE, Team, Category,
// Department, Priority, or the legacy Issue model) and replaced with that
// row's name if found; a value that no longer resolves (e.g. a deleted
// user) is replaced with "—" rather than ever leaving a raw id in place.
// A value that already looks like a name (doesn't match any row's id in
// the relevant table) is left completely untouched — this is what makes
// the script safe to re-run.
//
// Run once: node prisma/backfillTicketHistoryDisplayNames.js
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const RESOLVERS = {
  ASSIGNED: async (id) => (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name,
  MANAGER_CHANGE: async (id) => (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name,
  TEAM_CHANGE: async (id) => (await prisma.team.findUnique({ where: { id }, select: { name: true } }))?.name,
  CATEGORY_CHANGE: async (id) => (await prisma.category.findUnique({ where: { id }, select: { name: true } }))?.name,
  DEPARTMENT_CHANGE: async (id) => (await prisma.department.findUnique({ where: { id }, select: { name: true } }))?.name,
  PRIORITY_CHANGE: async (id) => (await prisma.priority.findUnique({ where: { id }, select: { name: true } }))?.name,
  ISSUE_CHANGE: async (id) => (await prisma.issue.findUnique({ where: { id }, select: { name: true } }))?.name,
};

// Prisma's default cuid() ids look like "cmui1r759005mjydi9q6ygh65" — 25
// lowercase alphanumeric characters starting with "c". A real display name
// (a person's name, a team/category/department/priority name) essentially
// never matches this shape (spaces, mixed case, punctuation are all
// disqualifying). This heuristic is what makes the script SAFE to run
// against already-correct data: a value is only ever touched if it looks
// like a raw id in the first place; anything that already looks like a
// name is left completely untouched, regardless of what a resolver lookup
// would have returned.
const CUID_PATTERN = /^c[a-z0-9]{20,}$/;
function looksLikeId(value) {
  return typeof value === "string" && CUID_PATTERN.test(value);
}

// Prisma throws on some malformed ids rather than just returning null, so
// this is wrapped defensively; any error is treated the same as "no match
// found" (falls back to "—" below).
async function resolveName(action, value) {
  try {
    return await RESOLVERS[action](value);
  } catch {
    return undefined;
  }
}

async function main() {
  const actions = Object.keys(RESOLVERS);
  const rows = await prisma.ticketHistory.findMany({ where: { action: { in: actions } } });
  console.log(`Found ${rows.length} history row(s) for actions: ${actions.join(", ")}`);

  let updated = 0;
  for (const row of rows) {
    const data = {};

    if (looksLikeId(row.oldValue)) {
      const name = await resolveName(row.action, row.oldValue);
      data.oldValue = name || "—"; // "—" only for a raw id whose target row no longer exists
    }
    if (looksLikeId(row.newValue)) {
      const name = await resolveName(row.action, row.newValue);
      data.newValue = name || "—";
    }

    if (Object.keys(data).length === 0) continue; // already a plain name (or null) on both sides

    await prisma.ticketHistory.update({ where: { id: row.id }, data });
    updated += 1;
    console.log(`[updated] ${row.id} (${row.action}): "${row.oldValue}" -> "${data.oldValue ?? row.oldValue}", "${row.newValue}" -> "${data.newValue ?? row.newValue}"`);
  }

  console.log(`\n${updated} row(s) updated, ${rows.length - updated} already clean.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
