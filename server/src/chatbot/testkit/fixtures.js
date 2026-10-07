// Shared test data. These are TEST fixtures only — production code never
// imports this directory.
const prismaMock = require("./prismaMock");

const ROLE_LABELS = { ADMIN: "Admin", MANAGER: "Manager", TEAMLEAD: "Team Lead", EMPLOYEE: "Employee" };

const D1 = { id: "dept_support", name: "IT Support" };
const D2 = { id: "dept_finance", name: "Finance" };

function user(id, name, role, department) {
  return {
    id,
    name,
    email: `${id}@example.test`,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    departmentId: department?.id ?? null,
    department: department ? { id: department.id, name: department.name } : null,
    role: { name: role, label: ROLE_LABELS[role] },
  };
}

const users = {
  empA: user("u_empA", "Alice Employee", "EMPLOYEE", D1),
  empB: user("u_empB", "Bob Employee", "EMPLOYEE", D1),
  empC: user("u_empC", "Carol Worker", "EMPLOYEE", D1),
  empD: user("u_empD", "Dan Finance", "EMPLOYEE", D2),
  tlD1: user("u_tlD1", "Tina Lead", "TEAMLEAD", D1),
  mgrD2: user("u_mgrD2", "Mark Manager", "MANAGER", null),
  admin: user("u_admin", "Ada Admin", "ADMIN", null),
  admin2: user("u_admin2", "Other Admin", "ADMIN", null),
  // People used by the admin-action tests.
  ravi: user("u_ravi", "Ravi Kumar", "EMPLOYEE", D1),
  john: user("u_john", "John Manager", "MANAGER", null),
  samA: user("u_samA", "Sam Smith", "EMPLOYEE", D1),
  samB: user("u_samB", "Sam Smith", "EMPLOYEE", D2),
  tl2: user("u_tl2", "Tessa Lead", "TEAMLEAD", D1),
  tlFree: user("u_tlFree", "Free Lead", "TEAMLEAD", null),
  dormant: { ...user("u_dormant", "Dormant Dan", "EMPLOYEE", D1), isActive: false },
};

const PRIORITIES = [
  { id: "p_low", name: "Low", level: 1, color: "#00ff00" },
  { id: "p_high", name: "High", level: 3, color: "#ff0000" },
];

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

function ticket(over) {
  const priority = over.priority || PRIORITIES[1];
  const requester = over.requester;
  const assignee = over.assignee || null;
  const dept = over.dept;
  return {
    id: `id_${over.ticketNumber}`,
    ticketNumber: over.ticketNumber,
    title: over.title || `Ticket ${over.ticketNumber}`,
    problemSummary: over.problemSummary || "<p>Something is wrong</p>",
    status: over.status || "OPEN",
    createdAt: over.createdAt || daysAgo(10),
    updatedAt: over.updatedAt || daysAgo(1),
    priorityId: priority.id,
    requesterId: requester.id,
    assigneeId: assignee?.id ?? null,
    toDepartmentId: dept.id,
    resolutionNotes: over.resolutionNotes ?? null,
    onHoldReason: over.onHoldReason ?? null,
    attachmentsCount: over.attachmentsCount ?? 0,
    priority: { name: priority.name, level: priority.level, color: priority.color },
    category: over.category ?? null,
    assignee: assignee ? { name: assignee.name } : null,
    requester: { name: requester.name },
    toDepartment: { name: dept.name },
    comments: over.comments || [],
    history: over.history || [],
  };
}

const INTERNAL_NOTE = "INTERNAL-SECRET-NOTE do not share";

function seedDefault() {
  prismaMock.__reset({
    priorities: [...PRIORITIES],
    departments: [
      {
        ...D1,
        users: [
          { name: users.empA.name, isActive: true, role: { name: "EMPLOYEE" } },
          { name: users.empB.name, isActive: true, role: { name: "EMPLOYEE" } },
          { name: "Gone Person", isActive: false, role: { name: "EMPLOYEE" } },
        ],
        userAccess: [
          { user: { name: users.tlD1.name, isActive: true, role: { name: "TEAMLEAD" } } },
          { user: { name: "Gone Lead", isActive: false, role: { name: "TEAMLEAD" } } },
        ],
      },
      {
        ...D2,
        users: [{ name: users.empD.name, isActive: true, role: { name: "EMPLOYEE" } }],
        userAccess: [{ user: { name: users.mgrD2.name, isActive: true, role: { name: "MANAGER" } } }],
      },
    ],
    access: [
      { userId: users.tlD1.id, departmentId: D1.id },
      { userId: users.tl2.id, departmentId: D1.id },
      { userId: users.mgrD2.id, departmentId: D2.id },
    ],
    users: Object.values(users).map((u) => ({ ...u, roleId: { ADMIN: "r_admin", MANAGER: "r_mgr", TEAMLEAD: "r_tl", EMPLOYEE: "r_emp" }[u.role.name] })),
    roles: [
      { id: "r_admin", name: "ADMIN", label: "Admin" },
      { id: "r_mgr", name: "MANAGER", label: "Manager" },
      { id: "r_tl", name: "TEAMLEAD", label: "Team Lead" },
      { id: "r_emp", name: "EMPLOYEE", label: "Employee" },
    ],
    tickets: [
      ticket({
        ticketNumber: "2627001",
        title: "Printer on floor 2 is broken",
        requester: users.empA,
        assignee: users.empC,
        dept: D1,
        status: "IN_PROGRESS",
        comments: [
          { body: "<p>We ordered a new toner</p>", isInternal: false, createdAt: daysAgo(2), author: { name: "Carol Worker" } },
          { body: INTERNAL_NOTE, isInternal: true, createdAt: daysAgo(1), author: { name: "Tina Lead" } },
        ],
        history: [
          { action: "STATUS_CHANGE", oldValue: "OPEN", newValue: "IN_PROGRESS", createdAt: daysAgo(3), user: { name: "Tina Lead" } },
          { action: "CREATED", oldValue: null, newValue: null, createdAt: daysAgo(10), user: { name: "Alice Employee" } },
        ],
        attachmentsCount: 2,
      }),
      ticket({
        ticketNumber: "2627002",
        title: "Bob's VPN problem",
        requester: users.empB,
        dept: D1,
        status: "ON_HOLD",
        onHoldReason: "Waiting for vendor",
        updatedAt: daysAgo(12),
      }),
      ticket({ ticketNumber: "2627003", title: "Finance report access", requester: users.empD, dept: D2, status: "IN_PROGRESS", assignee: users.empD }),
      ticket({
        ticketNumber: "2627004",
        title: "Old laptop request",
        requester: users.empA,
        dept: D1,
        status: "RESOLVED",
        assignee: users.empC,
        resolutionNotes: "Replacement laptop issued",
        history: [{ action: "RESOLUTION_NOTES", oldValue: null, newValue: "Replacement laptop issued", createdAt: daysAgo(1), user: { name: "Carol Worker" } }],
      }),
    ],
  });
}

module.exports = { users, D1, D2, PRIORITIES, INTERNAL_NOTE, ticket, seedDefault, daysAgo, prismaMock };
