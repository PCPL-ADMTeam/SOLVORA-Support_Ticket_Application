// Deterministic test organisation for the chatbot regression suite. TEST data only, held in the
// in-memory Prisma stand-in (src/chatbot/testkit/prismaMock.js): nothing here can touch a real
// database. It extends the shared test organisation (BI/Copilot, Hardware, Cloud) with an HR
// department the BI/Copilot people have NO access to, a "Jamie User" assignee and notifications.
const { seed, P, BI, HW, CLOUD, db } = require("../testkit/orgData");
const { users } = require("../testkit/fixtures");

const HR = { id: "dept_hr", name: "HR" };
const ROLE_ID = { ADMIN: "r_admin", MANAGER: "r_mgr", TEAMLEAD: "r_tl", EMPLOYEE: "r_emp" };
const ROLE_LABEL = { ADMIN: "Admin", MANAGER: "Manager", TEAMLEAD: "Team Lead", EMPLOYEE: "Employee" };

function person(id, name, role, department) {
  return {
    id, name, email: `${id}@example.test`, isActive: true, createdAt: new Date("2026-01-01T00:00:00Z"),
    departmentId: department?.id ?? null, department: department ? { ...department } : null,
    role: { name: role, label: ROLE_LABEL[role] }, roleId: ROLE_ID[role],
  };
}
const EXTRA = {
  jamie: person("u_jamie", "Jamie User", "EMPLOYEE", BI),
  hannah: person("u_hannah", "Hannah HR", "EMPLOYEE", HR),
};

const days = (n) => new Date(Date.now() - n * 86400000);
function makeTicket(num, title, dept, status, requester, assignee, priority, extra = {}) {
  return {
    id: `id_${num}`, ticketNumber: num, title, problemSummary: "<p>x</p>", status, createdAt: days(5), updatedAt: days(1),
    priorityId: priority.id, requesterId: requester.id, assigneeId: assignee?.id ?? null, toDepartmentId: dept.id,
    resolutionNotes: null, onHoldReason: null, closedReason: null, reopenedReason: null, attachmentsCount: 0,
    priority: { name: priority.name, level: priority.level, color: priority.color }, category: null,
    assignee: assignee ? { name: assignee.name } : null, requester: { name: requester.name }, toDepartment: { id: dept.id, name: dept.name, userAccess: [] },
    comments: [], history: [], ccUsers: [], attachments: [], ...extra,
  };
}

// Resets the in-memory database to the regression fixture.
function seedRegression() {
  seed();
  const [low, high] = db.priorities.slice().sort((a, b) => a.level - b.level);
  db.departments.push({ ...HR, users: [{ name: EXTRA.hannah.name, isActive: true, role: { name: "EMPLOYEE" } }], userAccess: [] });
  db.departments.find((d) => d.id === BI.id).users.push({ name: EXTRA.jamie.name, isActive: true, role: { name: "EMPLOYEE" } });
  db.users.push(EXTRA.jamie, EXTRA.hannah);
  if (!db.priorities.some((p) => p.name === "Critical")) db.priorities.push({ id: "p_crit", name: "Critical", level: 4, color: "#b71c1c" });
  db.tickets.push(
    makeTicket("2600291", "Report access request", BI, "ON_HOLD", P.empBI, EXTRA.jamie, low, { onHoldReason: "Waiting for the vendor" }),
    makeTicket("2600290", "Payroll query", HR, "OPEN", EXTRA.hannah, null, high)
  );
  // A comment on 2600269, as the ticket page would return it.
  const t = db.tickets.find((x) => x.ticketNumber === "2600269");
  t.comments = [{ id: "c1", body: "Looking at the report now", isInternal: false, createdAt: days(2), author: { name: P.manojR.name } }];
  db.notifications.push(
    { id: "n1", userId: P.empBI.id, ticketId: "id_2600269", type: "NEW_COMMENT", title: "New comment", message: "Manoj commented", isRead: false, createdAt: new Date() },
    { id: "n2", userId: P.empBI.id, ticketId: "id_2600270", type: "STATUS", title: "Status changed", message: "Now Open", isRead: false, createdAt: days(3) },
    { id: "n3", userId: P.empBI.id, ticketId: null, type: "INFO", title: "Welcome", message: "Hello", isRead: true, createdAt: days(9) },
    { id: "n4", userId: P.mgrBI.id, ticketId: "id_2600270", type: "STATUS", title: "Manager note", message: "Check", isRead: false, createdAt: days(1) },
    { id: "n5", userId: P.tlBI.id, ticketId: "id_2600271", type: "STATUS", title: "Lead note", message: "Review", isRead: false, createdAt: days(1) },
    { id: "n6", userId: users.admin.id, ticketId: null, type: "INFO", title: "Admin note", message: "System", isRead: false, createdAt: days(1) }
  );
}

// The signed-in user of each role, and what each of them may reach BY CONSTRUCTION of the fixture.
const WHO = { EMPLOYEE: P.empBI, TEAMLEAD: P.tlBI, MANAGER: P.mgrBI, ADMIN: users.admin };
const ACCESS = {
  EMPLOYEE: { departments: ["BI/Copilot"], blocked: ["Hardware", "HR", "Cloud"] },
  TEAMLEAD: { departments: ["BI/Copilot"], blocked: ["Hardware", "HR", "Cloud"] },
  MANAGER: { departments: ["BI/Copilot"], blocked: ["Hardware", "HR", "Cloud"] },
  ADMIN: { departments: ["BI/Copilot", "Hardware", "HR", "Cloud"], blocked: [] },
};
// Ticket numbers (and titles) in departments the BI/Copilot people cannot reach.
const OUTSIDE_BI = { numbers: ["2600280", "2600281", "2600290"], titles: ["Laptop order", "Monitor flicker", "Payroll query"], people: ["Hannah HR", "Hari Manager", "Hema Lead", "Manoj Kumar S", "Cora Cloud"] };

module.exports = { seedRegression, WHO, ACCESS, OUTSIDE_BI, P, BI, HW, CLOUD, HR, EXTRA, db, users };
