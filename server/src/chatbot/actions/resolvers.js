const prisma = require("../../config/prisma");
const { ChatError, CODES } = require("../chatbot.errors");
const { matchDepartments } = require("../departmentMatch");

// Turn names typed by an admin into real records. Anything ambiguous or
// missing becomes a clear, user-safe CHAT_ACTION_INVALID message — the action
// is never prepared on a guess.

const invalid = (message, choices) => new ChatError(CODES.ACTION_INVALID, { message, choices });
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// `allowed` (names) limits what the caller may even refer to: staff roles can only
// name departments they have access to, and a miss never lists other departments.
async function resolveDepartment(text, allowed = null) {
  let rows = await prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (allowed) rows = rows.filter((r) => allowed.includes(r.name));
  const exact = rows.filter((r) => norm(r.name) === norm(text));
  const found = exact.length ? exact : rows.filter((r) => matchDepartments(text, [r.name]).length);
  if (found.length === 1) return found[0];
  if (found.length > 1) throw invalid(`"${text}" matches more than one department: ${found.map((f) => f.name).join(", ")}. Please use the exact name.`);
  if (allowed) throw invalid(`I couldn't find a department called "${text}" that you have access to.`);
  throw invalid(`I couldn't find a department called "${text}". Departments: ${rows.map((r) => r.name).join(", ")}.`);
}

const USER_SELECT = {
  id: true,
  name: true,
  isActive: true,
  departmentId: true,
  role: { select: { name: true, label: true } },
  department: { select: { name: true } },
};

// Matches by exact name or exact email first, then by partial name. Emails are
// accepted as INPUT (to disambiguate) but are never shown back.
// `scopeDeptIds` (non-admin callers): only people who belong to those departments (home
// department, or Manager/Team Lead access) can be found, so a name outside the
// caller's scope is indistinguishable from a name that does not exist.
const inScope = (scopeDeptIds) => (scopeDeptIds ? { AND: [{ OR: [{ departmentId: { in: scopeDeptIds } }, { departmentAccess: { some: { departmentId: { in: scopeDeptIds } } } }] }] } : {});

async function resolveUser(text, scopeDeptIds = null) {
  const t = String(text).trim();
  let rows = await prisma.user.findMany({
    where: { ...inScope(scopeDeptIds), OR: [{ name: { equals: t, mode: "insensitive" } }, { email: { equals: t, mode: "insensitive" } }] },
    select: USER_SELECT,
    take: 6,
  });
  if (!rows.length) {
    rows = await prisma.user.findMany({ where: { ...inScope(scopeDeptIds), name: { contains: t, mode: "insensitive" } }, select: USER_SELECT, take: 6 });
  }
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw invalid(scopeDeptIds ? `I couldn't find a person named "${t}" in your departments.` : `I couldn't find a user named "${t}".`);
  const label = (u) => `${u.name} (${u.role.label}${u.department?.name ? `, ${u.department.name}` : ""})`;
  const numbered = rows.map((u, i) => `${i + 1}. ${label(u)}`).join("\n");
  // Choices keep ids SERVER-side (stored in conversation state); the user picks by number or label.
  throw invalid(`More than one user matches "${t}". Which one do you mean? Reply with the number.\n${numbered}`, rows.map((u) => ({ field: "user", id: u.id, label: label(u) })));
}

// `args.userId` is set ONLY by the server after an entity-selection step (never
// by the parser or the model); it is re-loaded and re-checked here.
async function resolveUserArg(args, key = "user", cleanName, scopeDeptIds = null) {
  if (args.userId) {
    const u = await prisma.user.findUnique({ where: { id: args.userId }, select: USER_SELECT });
    if (!u) throw invalid("That user no longer exists.");
    return u;
  }
  return resolveUser(cleanName(args[key], "user"), scopeDeptIds);
}

async function resolvePriority(text) {
  const rows = await prisma.priority.findMany({ select: { id: true, name: true, level: true }, orderBy: { level: "asc" } });
  const found = rows.find((r) => norm(r.name) === norm(text));
  if (!found) throw invalid(`"${text}" is not a priority. Available priorities: ${rows.map((r) => r.name).join(", ")}.`);
  return found;
}

module.exports = { resolveDepartment, resolveUser, resolveUserArg, resolvePriority, invalid };
