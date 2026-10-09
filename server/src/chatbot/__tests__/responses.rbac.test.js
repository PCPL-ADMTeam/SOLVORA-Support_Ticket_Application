jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// The structured answers (What's New, ticket summary, lists, people, notifications) for each role:
// the numbers match the application's own scope rules, nothing outside the role's scope appears,
// refusals stay neutral, and the suggestions offered for an unclear question all work for that role.

const dashboardService = require("../../services/dashboard.service");
const service = require("../chatbot.service");
const { users, seedDefault, prismaMock, daysAgo, D1, D2 } = require("../testkit/fixtures");
const { resolvePeriod } = require("../period");

const db = prismaMock.__db;
const ask = (user, message, extra = {}) => service.sendMessage(user, { message, ...extra });
const ROLES = () => ({ EMPLOYEE: users.empA, TEAMLEAD: users.tlD1, MANAGER: users.mgrD2, ADMIN: users.admin });
const NEUTRAL = "You do not have permission to access this ticket, or the ticket could not be found.";

// What each role may see, written out from the application's rules (not from chatbot code).
const inScope = (role, user, t) =>
  role === "ADMIN" ? true : role === "EMPLOYEE" ? t.requesterId === user.id || t.assigneeId === user.id : t.toDepartmentId === (role === "TEAMLEAD" ? D1.id : D2.id);

beforeEach(() => {
  seedDefault();
  jest.spyOn(dashboardService, "getStats").mockImplementation(async (user, { scope }) => {
    const rows = db.tickets.filter((t) => (scope === "created" ? t.requesterId === user.id : scope === "assigned" ? t.assigneeId === user.id : t.requesterId === user.id || t.assigneeId === user.id));
    return { kpis: { total: rows.length }, byStatus: ["OPEN", "IN_PROGRESS"].map((s) => ({ status: s, count: rows.filter((t) => t.status === s).length })), byPriority: [] };
  });
  // A few more tickets so every role has something recent.
  const extra = [
    { ticketNumber: "2627010", requesterId: users.empD.id, toDepartmentId: D2.id, dept: D2, requester: users.empD, updatedAt: daysAgo(2) },
    { ticketNumber: "2627011", requesterId: users.empB.id, toDepartmentId: D1.id, dept: D1, requester: users.empB, updatedAt: daysAgo(3), assigneeId: users.tlD1.id, assignee: users.tlD1 },
  ];
  for (const e of extra) {
    db.tickets.push({ ...db.tickets[0], id: `id_${e.ticketNumber}`, ticketNumber: e.ticketNumber, title: `Ticket ${e.ticketNumber}`, requesterId: e.requesterId, assigneeId: e.assigneeId || null, toDepartmentId: e.toDepartmentId, updatedAt: e.updatedAt, createdAt: daysAgo(4), requester: { name: e.requester.name }, assignee: e.assignee ? { name: e.assignee.name } : null, toDepartment: { name: e.dept.name }, status: "OPEN", comments: [], history: [] });
  }
  db.notifications.push(
    { id: "nA", userId: users.empA.id, ticketId: "id_2627001", type: "STATUS_CHANGED", title: "For Alice", message: "ALICE-ONLY", isRead: false, createdAt: daysAgo(0.1) },
    { id: "nD", userId: users.empD.id, ticketId: "id_2627003", type: "STATUS_CHANGED", title: "For Dan", message: "DAN-ONLY", isRead: false, createdAt: daysAgo(0.1) }
  );
});
afterEach(() => jest.restoreAllMocks());

describe("What's New matches each role's scope exactly", () => {
  test.each(["EMPLOYEE", "TEAMLEAD", "MANAGER", "ADMIN"])("%s: the 'updated' count is the number of in-scope tickets updated in the window", async (role) => {
    const user = ROLES()[role];
    const r = await ask(user, "what's new");
    const { from, to } = resolvePeriod({ question: "what's new", defaultDays: 7 });
    const expected = db.tickets.filter((t) => inScope(role, user, t) && t.updatedAt >= from && t.updatedAt < to).length;
    expect(r.data.digest.updated.count).toBe(expected);
    for (const t of [...(r.data.digest.assigned?.tickets || []), ...r.data.digest.updated.tickets]) {
      expect(inScope(role, user, db.tickets.find((x) => x.ticketNumber === t.ticketNumber))).toBe(true);
    }
  });

  test.each(["EMPLOYEE", "TEAMLEAD", "MANAGER", "ADMIN"])("%s: only their own notifications", async (role) => {
    const user = ROLES()[role];
    const text = JSON.stringify(await ask(user, "what's new"));
    if (user.id !== users.empA.id) expect(text).not.toContain("For Alice");
    expect(text).not.toContain("For Dan");
  });

  test("only Employees and Team Leads get an 'Assigned to you' section (Managers and Admins are never assignees)", async () => {
    expect((await ask(users.empA, "what's new")).data.digest.assigned).not.toBeNull();
    expect((await ask(users.tlD1, "what's new")).data.digest.assigned.tickets.map((t) => t.ticketNumber)).toEqual(["2627011"]);
    expect((await ask(users.mgrD2, "what's new")).data.digest.assigned).toBeNull();
    expect((await ask(users.admin, "what's new")).data.digest.assigned).toBeNull();
  });
});

describe("refusals", () => {
  test.each([
    ["EMPLOYEE", "show Finance tickets"],
    ["TEAMLEAD", "show Finance tickets"],
    ["MANAGER", "show IT Support tickets"],
  ])("%s asking about a department outside their access is refused, with working alternatives", async (role, q) => {
    const r = await ask(ROLES()[role], q);
    expect(r.error.code).toBe("CHAT_ACCESS_DENIED");
    expect(r.data.tickets).toBeUndefined();
    expect(r.suggestedActions.length).toBeGreaterThanOrEqual(3);
    for (const a of r.suggestedActions) {
      const follow = await ask(ROLES()[role], a.prompt);
      expect({ prompt: a.prompt, code: follow.error?.code }).not.toEqual({ prompt: a.prompt, code: "CHAT_ACCESS_DENIED" });
    }
  });

  test("an Admin may ask about any department", async () => {
    const r = await ask(users.admin, "show Finance tickets");
    expect(r.error).toBeNull();
    for (const t of r.data.tickets) expect(t.department).toBe("Finance");
  });

  test("a ticket outside the user's scope is answered neutrally and nothing about it leaks", async () => {
    const r = await ask(users.empB, "show ticket 2627001");
    expect(r.message).toBe(NEUTRAL);
    expect(JSON.stringify(r)).not.toMatch(/Printer on floor 2|Alice Employee|id_2627001/);
  });

  test("being on a ticket's Custom CC list alone does not open it (the same rule as the ticket page)", async () => {
    // The application sends CC'd people e-mail copies; viewing still needs requester, assignee or department access.
    db.tickets.find((t) => t.ticketNumber === "2627001").ccUsers = [{ user: { id: users.empB.id, name: users.empB.name } }];
    expect((await ask(users.empB, "show ticket 2627001")).message).toBe(NEUTRAL);
    const digest = (await ask(users.empB, "what's new")).data.digest;
    expect(digest.updated.tickets.map((t) => t.ticketNumber)).not.toContain("2627001");
    // ...and it never widens what else they can see.
    for (const t of (await ask(users.empB, "show my tickets")).data.tickets || []) expect([t.raisedBy, t.assignedTo]).toContain("Bob Employee");
  });

  test("an Employee cannot ask for workload, people or another person's tickets", async () => {
    for (const q of ["show employee workload", "who works in IT Support", "show tickets assigned to Carol Worker"]) {
      const r = await ask(users.empA, q);
      expect({ q, code: r.error?.code }).toEqual({ q, code: "CHAT_ACCESS_DENIED" });
    }
  });
});

describe("request fields cannot widen anything", () => {
  test("a time zone only moves where 'today' starts; it never changes whose data is used", async () => {
    const a = await ask(users.empA, "what's new today", { timeZone: "Pacific/Kiritimati" });
    const b = await ask(users.empA, "what's new today", { timeZone: "America/Adak" });
    for (const r of [a, b]) {
      expect(JSON.stringify(r)).not.toMatch(/DAN-ONLY|For Dan/);
      for (const t of r.data.digest.updated.tickets) expect(inScope("EMPLOYEE", users.empA, db.tickets.find((x) => x.ticketNumber === t.ticketNumber))).toBe(true);
    }
    expect(a.data.digest.period.timeZone).toBe("Pacific/Kiritimati");
  });

  test("the summary is always the signed-in user's own", async () => {
    await ask(users.empB, "give me my dashboard summary", { userId: users.empA.id, role: "ADMIN" });
    for (const [u] of dashboardService.getStats.mock.calls) expect(u.id).toBe(users.empB.id);
  });
});

describe("suggestions for an unclear question", () => {
  test.each(["EMPLOYEE", "TEAMLEAD", "MANAGER", "ADMIN"])("%s: 3 to 5 suggestions, and every one of them works for this role", async (role) => {
    const user = ROLES()[role];
    const r = await ask(user, "flibbertigibbet wobble");
    expect(r.error.code).toBe("CHAT_UNSUPPORTED_INTENT");
    expect(r.suggestedActions.length).toBeGreaterThanOrEqual(3);
    expect(r.suggestedActions.length).toBeLessThanOrEqual(5);
    for (const a of r.suggestedActions) {
      const follow = await ask(user, a.prompt);
      expect({ prompt: a.prompt, code: follow.error?.code || null }).toEqual({ prompt: a.prompt, code: expect.not.stringMatching(/ACCESS_DENIED|UNSUPPORTED_INTENT/) });
    }
  });
});
