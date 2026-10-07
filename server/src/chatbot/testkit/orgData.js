// A small organisation used by the end-to-end tests: BI/Copilot, Hardware and Cloud, two people
// named Manoj, and six tickets. TEST data only; production code never imports this directory.
const { users, seedDefault, prismaMock } = require("./fixtures");

const db = prismaMock.__db;
const ROLE_LABELS = { ADMIN: "Admin", MANAGER: "Manager", TEAMLEAD: "Team Lead", EMPLOYEE: "Employee" };
const dept = (id, name) => ({ id, name });
const BI = dept("dept_bi", "BI/Copilot");
const HW = dept("dept_hw", "Hardware");
const CLOUD = dept("dept_cloud", "Cloud");

function person(id, name, role, department) {
  return {
    id, name, email: `${id}@example.test`, isActive: true, createdAt: new Date("2026-01-01T00:00:00Z"),
    departmentId: department?.id ?? null, department: department ? { ...department } : null,
    role: { name: role, label: ROLE_LABELS[role] },
  };
}
const P = {
  mgrBI: person("u_mgrBI", "Jayakumar J", "MANAGER", null),
  tlBI: person("u_tlBI", "Pavithran M", "TEAMLEAD", null),
  empBI: person("u_empBI", "Srihari", "EMPLOYEE", BI),
  manojR: person("u_manojR", "Manoj Kumar R", "EMPLOYEE", BI),
  mgrHW: person("u_mgrHW", "Hari Manager", "MANAGER", null),
  tlHW: person("u_tlHW", "Hema Lead", "TEAMLEAD", null),
  manojS: person("u_manojS", "Manoj Kumar S", "EMPLOYEE", HW),
  empCloud: person("u_empCloud", "Cora Cloud", "EMPLOYEE", CLOUD),
};

const days = (n) => new Date(Date.now() - n * 86400000);
function mkTicket(num, title, d, status, requester, assignee, priority) {
  return {
    id: `id_${num}`, ticketNumber: num, title, problemSummary: "<p>x</p>", status, createdAt: days(5), updatedAt: days(1),
    priorityId: priority.id, requesterId: requester.id, assigneeId: assignee?.id ?? null, toDepartmentId: d.id,
    resolutionNotes: null, onHoldReason: null, attachmentsCount: 0,
    priority: { name: priority.name, level: priority.level, color: priority.color }, category: null,
    assignee: assignee ? { name: assignee.name } : null, requester: { name: requester.name }, toDepartment: { name: d.name },
    comments: [], history: [],
  };
}

function seed() {
  seedDefault();
  const [low, high] = db.priorities.slice().sort((a, b) => a.level - b.level);
  const members = (d, list) => list.filter((p) => p.departmentId === d.id).map((p) => ({ name: p.name, isActive: true, role: { name: p.role.name } }));
  const access = (list) => list.map((p) => ({ user: { name: p.name, isActive: true, role: { name: p.role.name } } }));
  db.departments.push(
    { ...BI, users: members(BI, [P.empBI, P.manojR]), userAccess: access([P.mgrBI, P.tlBI]) },
    { ...HW, users: members(HW, [P.manojS]), userAccess: access([P.mgrHW, P.tlHW]) },
    { ...CLOUD, users: members(CLOUD, [P.empCloud]), userAccess: [] }
  );
  db.users.push(...Object.values(P).map((u) => ({ ...u, roleId: { ADMIN: "r_admin", MANAGER: "r_mgr", TEAMLEAD: "r_tl", EMPLOYEE: "r_emp" }[u.role.name] })));
  db.access.push(
    { userId: P.mgrBI.id, departmentId: BI.id }, { userId: P.tlBI.id, departmentId: BI.id },
    { userId: P.mgrHW.id, departmentId: HW.id }, { userId: P.tlHW.id, departmentId: HW.id }
  );
  db.tickets.push(
    mkTicket("2600269", "Copilot Output Issue", BI, "IN_PROGRESS", P.empBI, P.manojR, high),
    mkTicket("2600270", "Power BI Issue", BI, "OPEN", P.empBI, P.manojR, low),
    mkTicket("2600271", "Dashboard refresh is slow", BI, "RESOLVED", P.manojR, P.tlBI, low),
    mkTicket("2600272", "Old BI report request", BI, "CLOSED", P.empBI, null, low),
    mkTicket("2600280", "Laptop order", HW, "OPEN", P.manojS, null, high),
    mkTicket("2600281", "Monitor flicker", HW, "RESOLVED", P.manojS, P.tlHW, low)
  );
  // The relations the application's own ticket page reads, so ticket.service.getTicketById runs
  // against this data (used as the "what the web app would open" oracle).
  for (const t of db.tickets) {
    t.ccUsers = t.ccUsers || [];
    t.attachments = t.attachments || [];
    t.toDepartment = { id: t.toDepartmentId, ...t.toDepartment, userAccess: [] };
  }
}


module.exports = { seed, P, BI, HW, CLOUD, db };
