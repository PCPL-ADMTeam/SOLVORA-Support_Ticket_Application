// DB-backed regression tests for the Employee Ticket Log (Raised By Me /
// Assigned To Me / Department Tickets), department-ticket and Custom CC
// participant access, and the email "View Ticket" path, run against the
// real ticket.service.js / Express app.
//
// Opt-in: runs only with RUN_DB_TESTS=1 (see `npm run test:db`), because
// it writes to the database in DATABASE_URL. Every record it creates is
// prefixed/isolated (its own departments, users and tickets with ticket
// numbers in a reserved 99xxxxxxx range that never advances the real
// ticket sequence) and deleted in afterAll — nothing pre-existing is
// touched. Email and blob storage are mocked: no real email is ever sent.
//
// sanitize-html ships ESM-only (htmlparser2) and can't be require()'d under
// Jest's default CJS transform, so it's replaced with an identity function
// here — sanitization itself is not what these tests exercise.
jest.mock("sanitize-html", () => (value) => String(value ?? ""));
jest.mock("../notification.service", () => ({ notify: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../blobStorage.service", () => ({
  uploadBuffer: jest.fn().mockResolvedValue("test-blob"),
  deleteBlob: jest.fn().mockResolvedValue(undefined),
  downloadBlobBuffer: jest.fn().mockResolvedValue(Buffer.from("")),
}));

require("dotenv").config();

// `npm run test:db` (cross-platform) or RUN_DB_TESTS=1; never in production.
const RUN =
  (process.env.RUN_DB_TESTS === "1" || process.env.npm_lifecycle_event === "test:db") && process.env.NODE_ENV !== "production";
const describeDb = RUN ? describe : describe.skip;

const prisma = require("../../config/prisma");
const env = require("../../config/env");
const ticketService = require("../ticket.service");
const notificationService = require("../notification.service");
const emailTemplateService = require("../emailTemplate.service");
const userService = require("../user.service");
const { signAccessToken } = require("../../utils/jwt");

const TAG = `zt${Date.now().toString(36)}`;
let seq = 990000000 + Math.floor(Math.random() * 900000);

const ids = { departments: [], users: [], tickets: [] };
const U = {}; // users, with role included
const D = {}; // departments
const T = {}; // tickets
let priorities;
let server;
let baseUrl;

async function makeDepartment(key) {
  const d = await prisma.department.create({ data: { name: `${TAG}-${key}` } });
  ids.departments.push(d.id);
  D[key] = d;
}

async function makeUser(key, roleName, { departmentId = null, accessTo = [], isActive = true } = {}) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  const u = await prisma.user.create({
    data: { name: `${TAG} ${key}`, email: `${TAG}-${key}@test.invalid`, passwordHash: "x", roleId: role.id, departmentId, isActive },
    include: { role: true },
  });
  ids.users.push(u.id);
  for (const depId of accessTo) {
    await prisma.userDepartmentAccess.create({ data: { userId: u.id, departmentId: depId } });
  }
  U[key] = u;
}

async function makeTicket(key, { requester, assignee = null, dept, priority = 0, status = "OPEN", createdAt, cc = [] }) {
  seq += 1;
  const t = await prisma.ticket.create({
    data: {
      seq,
      ticketNumber: `${seq}`,
      title: `${TAG} ${key}`,
      problemSummary: "<p>test</p>",
      status,
      priorityId: priorities[priority].id,
      requesterId: U[requester].id,
      assigneeId: assignee ? U[assignee].id : null,
      toDepartmentId: D[dept].id,
      fromDepartmentId: D[dept].id,
      ...(createdAt ? { createdAt } : {}),
    },
  });
  for (const ccKey of cc) {
    await prisma.ticketCC.create({ data: { ticketId: t.id, userId: U[ccKey].id } });
  }
  ids.tickets.push(t.id);
  T[key] = t;
}

const list = (userKey, query = {}) => ticketService.listTickets(U[userKey], { limit: "100", ...query });
const titles = (result) => result.data.map((t) => t.title).sort();
const title = (key) => `${TAG} ${key}`;

async function expectForbidden(promise) {
  await expect(promise).rejects.toMatchObject({ statusCode: 403 });
}

async function http(method, path, userKey, body) {
  const headers = { "Content-Type": "application/json" };
  if (userKey) headers.Authorization = `Bearer ${signAccessToken(U[userKey])}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

describeDb("Ticket access — Employee Ticket Log, Department Tickets, Custom CC, View Ticket", () => {
  beforeAll(async () => {
    priorities = await prisma.priority.findMany({ orderBy: { name: "asc" }, take: 2 });
    if (priorities.length < 2) throw new Error("Need at least 2 priorities in the database");

    await makeDepartment("A");
    await makeDepartment("B");

    await makeUser("empA1", "EMPLOYEE", { departmentId: D.A.id }); // requester
    await makeUser("empA2", "EMPLOYEE", { departmentId: D.A.id }); // assignee
    await makeUser("empA3", "EMPLOYEE", { departmentId: D.A.id }); // department-only viewer
    await makeUser("empB", "EMPLOYEE", { departmentId: D.B.id }); // Custom CC recipient on T1
    await makeUser("empB2", "EMPLOYEE", { departmentId: D.B.id }); // unrelated
    await makeUser("empNoDept", "EMPLOYEE", { departmentId: null });
    await makeUser("empInactive", "EMPLOYEE", { departmentId: D.B.id, isActive: false });
    await makeUser("tlA", "TEAMLEAD", { accessTo: [D.A.id] });
    await makeUser("mgrB", "MANAGER", { accessTo: [D.B.id] }); // also CC'd on T1
    await makeUser("admin", "ADMIN");

    const jan = (d) => new Date(Date.UTC(2026, 0, d, 10));
    // T1: dept A, raised by A1, assigned A2, CC empB + mgrB + empInactive
    await makeTicket("T1", { requester: "empA1", assignee: "empA2", dept: "A", priority: 0, status: "OPEN", createdAt: jan(5), cc: ["empB", "mgrB", "empInactive"] });
    // T2: dept A, raised by A2, unassigned
    await makeTicket("T2", { requester: "empA2", dept: "A", priority: 1, status: "IN_PROGRESS", createdAt: jan(10) });
    // T3: dept B, raised by B2
    await makeTicket("T3", { requester: "empB2", dept: "B", priority: 0, createdAt: jan(12) });
    // T4: dept A, raised by AND assigned to A1 (matches both personal scopes)
    await makeTicket("T4", { requester: "empA1", assignee: "empA1", dept: "A", priority: 1, status: "RESOLVED", createdAt: jan(20) });

    // An internal note on T1 (by the department Team Lead) — must stay hidden
    // from department/CC participants.
    await prisma.ticketComment.create({ data: { ticketId: T1id(), authorId: U.tlA.id, body: "<p>internal secret</p>", isInternal: true } });

    const app = require("../../app");
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  }, 60000);

  function T1id() { return T.T1.id; }

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    const ticketIds = ids.tickets;
    const userIds = ids.users;
    await prisma.ticketHistory.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticketAttachment.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticketComment.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticketCC.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.notification.deleteMany({ where: { OR: [{ ticketId: { in: ticketIds } }, { userId: { in: userIds } }] } });
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userDepartmentAccess.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.department.deleteMany({ where: { id: { in: ids.departments } } });
    await prisma.$disconnect();
  }, 60000);

  beforeEach(() => notificationService.notify.mockClear());

  // ---------------------------------------------------------------- A
  describe("A. Employee Ticket Log — Raised By Me / Assigned To Me", () => {
    test("Raised By Me returns only tickets the employee raised", async () => {
      expect(titles(await list("empA1", { scope: "created" }))).toEqual([title("T1"), title("T4")]);
      expect(titles(await list("empA2", { scope: "created" }))).toEqual([title("T2")]);
    });

    test("Assigned To Me returns only tickets currently assigned to the employee", async () => {
      expect(titles(await list("empA2", { scope: "assigned" }))).toEqual([title("T1")]);
      expect(titles(await list("empA1", { scope: "assigned" }))).toEqual([title("T4")]);
    });

    test("switching scope returns different, correct result sets", async () => {
      const created = await list("empA2", { scope: "created" });
      const assigned = await list("empA2", { scope: "assigned" });
      expect(created.data.every((t) => t.requesterId === U.empA2.id)).toBe(true);
      expect(assigned.data.every((t) => t.assigneeId === U.empA2.id)).toBe(true);
    });

    test("status filter", async () => {
      expect(titles(await list("empA1", { scope: "created", status: "RESOLVED" }))).toEqual([title("T4")]);
    });

    test("priority filter", async () => {
      expect(titles(await list("empA1", { scope: "created", priorityId: priorities[0].id }))).toEqual([title("T1")]);
    });

    test("date filters (inclusive To date)", async () => {
      expect(titles(await list("empA1", { scope: "created", dateFrom: "2026-01-06" }))).toEqual([title("T4")]);
      expect(titles(await list("empA1", { scope: "created", dateTo: "2026-01-05" }))).toEqual([title("T1")]);
    });

    test("cleared filters return the full tab again", async () => {
      expect((await list("empA1", { scope: "created" })).pagination.total).toBe(2);
    });

    test("pagination totals and sorting", async () => {
      const page1 = await list("empA1", { scope: "created", limit: "1", page: "1", sortBy: "createdAt", sortOrder: "asc" });
      const page2 = await list("empA1", { scope: "created", limit: "1", page: "2", sortBy: "createdAt", sortOrder: "asc" });
      expect(page1.pagination.total).toBe(2);
      expect(page1.data[0].title).toBe(title("T1"));
      expect(page2.data[0].title).toBe(title("T4"));
      const desc = await list("empA1", { scope: "created", sortBy: "createdAt", sortOrder: "desc" });
      expect(desc.data.map((t) => t.title)).toEqual([title("T4"), title("T1")]);
    });

    test("a ticket in both scopes is not duplicated within a result set", async () => {
      const created = await list("empA1", { scope: "created" });
      expect(created.data.filter((t) => t.id === T.T4.id)).toHaveLength(1);
      const all = await list("empA1"); // default = raised OR assigned
      expect(all.data.filter((t) => t.id === T.T4.id)).toHaveLength(1);
      expect(all.pagination.total).toBe(2);
    });

    test("returned row data matches the database record", async () => {
      const row = (await list("empA1", { scope: "created" })).data.find((t) => t.id === T.T1.id);
      expect(row).toMatchObject({ ticketNumber: T.T1.ticketNumber, title: title("T1"), status: "OPEN" });
      expect(row.toDepartment.name).toBe(D.A.name);
      expect(row.requester.id).toBe(U.empA1.id);
      expect(row.assignee.id).toBe(U.empA2.id);
      expect(row.priority.id).toBe(priorities[0].id);
    });
  });

  // ---------------------------------------------------------------- B
  describe("B. Department Tickets — employee", () => {
    test("employee sees exactly their own department's tickets", async () => {
      const r = await list("empA3", { scope: "department" });
      expect(titles(r)).toEqual([title("T1"), title("T2"), title("T4")]);
      expect(r.pagination.total).toBe(3);
    });

    test("status and priority filters", async () => {
      expect(titles(await list("empA3", { scope: "department", status: "IN_PROGRESS" }))).toEqual([title("T2")]);
      expect(titles(await list("empA3", { scope: "department", priorityId: priorities[1].id }))).toEqual([title("T2"), title("T4")]);
    });

    test("assignee and assignment-state filters", async () => {
      expect(titles(await list("empA3", { scope: "department", assigneeId: U.empA2.id }))).toEqual([title("T1")]);
      expect(titles(await list("empA3", { scope: "department", assigned: "false" }))).toEqual([title("T2")]);
      expect(titles(await list("empA3", { scope: "department", assigned: "true" }))).toEqual([title("T1"), title("T4")]);
    });

    test("cannot reach another department by altering request parameters", async () => {
      const r = await list("empA3", { scope: "department", departmentId: D.B.id });
      expect(r.data).toHaveLength(0);
      expect(r.pagination.total).toBe(0);
      const viaHttp = await http("GET", `/tickets?scope=department&departmentId=${D.B.id}`, "empA3");
      expect(viaHttp.status).toBe(200);
      expect(viaHttp.json.pagination.total).toBe(0);
    });

    test("employee without a department gets an empty, zero-count result", async () => {
      const r = await list("empNoDept", { scope: "department" });
      expect(r.data).toHaveLength(0);
      expect(r.pagination.total).toBe(0);
    });

    test("counts never include other departments' tickets", async () => {
      const r = await list("empB2", { scope: "department" });
      expect(titles(r)).toEqual([title("T3")]);
      expect(r.pagination.total).toBe(1);
    });

    test("Assignee filter options are the employee's own department only", async () => {
      const opts = await userService.listAssignableEmployees(U.empA3, { departmentId: D.B.id });
      const optIds = opts.map((o) => o.id);
      expect(optIds).toEqual(expect.arrayContaining([U.empA1.id, U.empA2.id, U.empA3.id, U.tlA.id]));
      expect(optIds).not.toContain(U.empB.id);
      expect(optIds).not.toContain(U.empB2.id);
    });

    test("employee can open a department ticket (participant), internal notes hidden", async () => {
      const t = await ticketService.getTicketById(U.empA3, T.T2.id);
      expect(t.id).toBe(T.T2.id);
      expect(t.viewerAccess).toBe("participant");
      const t1 = await ticketService.getTicketById(U.empA3, T.T1.id);
      expect(t1.comments.some((c) => c.isInternal)).toBe(false);
    });

    test("employee can add a public comment; it persists and notifies by the existing rule", async () => {
      const comment = await ticketService.addComment(U.empA3, T.T1.id, { body: "<p>dept comment</p>", isInternal: false });
      const saved = await prisma.ticketComment.findUnique({ where: { id: comment.id } });
      expect(saved).toMatchObject({ ticketId: T.T1.id, authorId: U.empA3.id, isInternal: false });
      expect(notificationService.notify).toHaveBeenCalledTimes(1);
      const call = notificationService.notify.mock.calls[0][0];
      expect(call.eventKey).toBe("TICKET_COMMENT_ADDED");
      expect(call.userIds).toEqual([U.empA2.id]); // TO = assignee
      expect(call.ccUserIds).toEqual(expect.arrayContaining([U.empA1.id, U.tlA.id, U.empB.id, U.mgrB.id]));
      const view = await ticketService.getTicketById(U.empA1, T.T1.id);
      expect(view.comments.some((c) => c.id === comment.id)).toBe(true);
    });

    test("department visibility grants no management operations", async () => {
      await expectForbidden(ticketService.updateTicket(U.empA3, T.T2.id, { status: "RESOLVED", resolutionNotes: "x" }));
      await expectForbidden(ticketService.updateTicket(U.empA3, T.T2.id, { assigneeId: U.empA3.id }));
      await expectForbidden(ticketService.updateTicket(U.empA3, T.T2.id, { assignToMe: true }));
      await expectForbidden(ticketService.updateTicket(U.empA3, T.T2.id, { title: "hijack" }));
      await expectForbidden(ticketService.updateTicket(U.empA3, T.T4.id, { status: "REOPENED", reopenedReason: "x" }));
      await expectForbidden(ticketService.transferDepartment(U.empA3, T.T2.id, { toDepartmentId: D.B.id, transferReason: "x" }));
      await expectForbidden(ticketService.addComment(U.empA3, T.T2.id, { body: "<p>n</p>", isInternal: true }));
      await expectForbidden(ticketService.addAttachment(U.empA3, T.T2.id, { originalname: "a.txt", size: 1, buffer: Buffer.from("a") }));
      const t2 = await prisma.ticket.findUnique({ where: { id: T.T2.id } });
      expect(t2).toMatchObject({ status: "IN_PROGRESS", assigneeId: null, title: title("T2"), toDepartmentId: D.A.id });
    });

    test("employee cannot open another department's ticket", async () => {
      await expectForbidden(ticketService.getTicketById(U.empA3, T.T3.id));
    });
  });

  // ---------------------------------------------------------------- C
  describe("C. Custom CC", () => {
    test("CC recipient from another department can open the specific ticket", async () => {
      const t = await ticketService.getTicketById(U.empB, T.T1.id);
      expect(t.id).toBe(T.T1.id);
      expect(t.viewerAccess).toBe("participant");
      expect(t.comments.some((c) => c.isInternal)).toBe(false);
      expect(t.ccUsers.map((c) => c.id)).toContain(U.empB.id);
    });

    test("CC recipient can add a public comment that appears in the conversation", async () => {
      const comment = await ticketService.addComment(U.empB, T.T1.id, { body: "<p>cc comment</p>", isInternal: false });
      expect(await prisma.ticketComment.count({ where: { id: comment.id, authorId: U.empB.id, isInternal: false } })).toBe(1);
      const requesterView = await ticketService.getTicketById(U.empA1, T.T1.id);
      expect(requesterView.comments.some((c) => c.id === comment.id)).toBe(true);
      expect(notificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ eventKey: "TICKET_COMMENT_ADDED", userIds: [U.empA2.id] }));
    });

    test("CC recipient cannot access unrelated tickets in the destination department", async () => {
      await expectForbidden(ticketService.getTicketById(U.empB, T.T2.id));
      await expectForbidden(ticketService.addComment(U.empB, T.T2.id, { body: "<p>x</p>", isInternal: false }));
      const deptList = await list("empB", { scope: "department" });
      expect(deptList.data.map((t) => t.id)).not.toContain(T.T1.id);
    });

    test("cannot guess other tickets: only the CC'd ticket appears in search scope", async () => {
      const r = await list("empB", { scope: "authorized", search: TAG });
      expect(r.data.map((t) => t.id)).toContain(T.T1.id);
      expect(r.data.map((t) => t.id)).not.toContain(T.T2.id);
      expect(r.data.map((t) => t.id)).not.toContain(T.T4.id);
    });

    test("CC grants no assign / reassign / transfer / status / reopen", async () => {
      await expectForbidden(ticketService.updateTicket(U.empB, T.T1.id, { assigneeId: U.empB.id }));
      await expectForbidden(ticketService.updateTicket(U.empB, T.T1.id, { status: "IN_PROGRESS" }));
      await expectForbidden(ticketService.updateTicket(U.empB, T.T1.id, { status: "RESOLVED", resolutionNotes: "x" }));
      await expectForbidden(ticketService.transferDepartment(U.empB, T.T1.id, { toDepartmentId: D.B.id, transferReason: "x" }));
      await expectForbidden(ticketService.updateTicket(U.mgrB, T.T1.id, { assigneeId: U.empB.id }));
      await expectForbidden(ticketService.updateTicket(U.mgrB, T.T1.id, { status: "IN_PROGRESS" }));
      await expectForbidden(ticketService.transferDepartment(U.mgrB, T.T1.id, { toDepartmentId: D.B.id, transferReason: "x" }));
      const t1 = await prisma.ticket.findUnique({ where: { id: T.T1.id } });
      expect(t1).toMatchObject({ status: "OPEN", assigneeId: U.empA2.id, toDepartmentId: D.A.id });
    });

    test("CC recipient (even a Manager) cannot read or create internal notes", async () => {
      await expectForbidden(ticketService.addComment(U.empB, T.T1.id, { body: "<p>n</p>", isInternal: true }));
      await expectForbidden(ticketService.addComment(U.mgrB, T.T1.id, { body: "<p>n</p>", isInternal: true }));
      const mgrView = await ticketService.getTicketById(U.mgrB, T.T1.id);
      expect(mgrView.viewerAccess).toBe("participant");
      expect(mgrView.comments.some((c) => c.isInternal)).toBe(false);
    });

    test("removing the Custom CC row removes CC-based access", async () => {
      await prisma.ticketCC.delete({ where: { ticketId_userId: { ticketId: T.T1.id, userId: U.empB.id } } });
      try {
        await expectForbidden(ticketService.getTicketById(U.empB, T.T1.id));
        await expectForbidden(ticketService.addComment(U.empB, T.T1.id, { body: "<p>x</p>", isInternal: false }));
      } finally {
        await prisma.ticketCC.create({ data: { ticketId: T.T1.id, userId: U.empB.id } });
      }
      // A requester who is ALSO CC'd keeps full access through the other relationship.
      await prisma.ticketCC.create({ data: { ticketId: T.T4.id, userId: U.empA1.id } });
      const t4 = await ticketService.getTicketById(U.empA1, T.T4.id);
      expect(t4.viewerAccess).toBe("full");
    });

    test("inactive CC recipient cannot authenticate (existing rule)", async () => {
      const r = await http("GET", `/tickets/${T.T1.id}`, "empInactive");
      expect(r.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------- D
  describe("D. Email View Ticket link", () => {
    test("the email link is CLIENT_URL/tickets/<id> — no data or credentials in the URL", async () => {
      const ticket = await prisma.ticket.findUnique({
        where: { id: T.T1.id },
        include: { priority: true, toDepartment: true, requester: true, assignee: true, manager: true },
      });
      const rendered = await emailTemplateService.renderTemplate("TICKET_COMMENT_ADDED", { ticket, comment: { body: "<p>x</p>", author: { name: "x" } } });
      expect(rendered).not.toBeNull();
      expect(rendered.body).toContain(`${env.clientUrl}/tickets/${T.T1.id}`);
    });

    test("unauthenticated access is rejected (no public ticket endpoint)", async () => {
      for (const [method, path] of [
        ["GET", `/tickets/${T.T1.id}`],
        ["GET", "/tickets"],
        ["POST", `/tickets/${T.T1.id}/comments`],
        ["GET", `/tickets/${T.T1.id}/attachments/x/download`],
      ]) {
        const r = await http(method, path, null);
        expect(r.status).toBe(401);
        expect(r.text).not.toContain(title("T1"));
      }
    });

    test("authenticated CC recipient opens the same URL's ticket (authorization re-checked server-side)", async () => {
      const r = await http("GET", `/tickets/${T.T1.id}`, "empB");
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({ id: T.T1.id, ticketNumber: T.T1.ticketNumber, viewerAccess: "participant" });
    });

    test("an unrelated authenticated user is denied the same URL, without leaking ticket data", async () => {
      const r = await http("GET", `/tickets/${T.T1.id}`, "empB2");
      expect(r.status).toBe(403);
      expect(r.text).not.toContain(title("T1"));
    });

    test("requester and assignee links still work with full access", async () => {
      for (const key of ["empA1", "empA2"]) {
        const r = await http("GET", `/tickets/${T.T1.id}`, key);
        expect(r.status).toBe(200);
        expect(r.json.data.viewerAccess).toBe("full");
      }
    });

    test("CC recipient can post a public comment over HTTP", async () => {
      const r = await http("POST", `/tickets/${T.T1.id}/comments`, "empB", { body: "<p>via http</p>" });
      expect(r.status).toBe(201);
      expect(await prisma.ticketComment.count({ where: { ticketId: T.T1.id, authorId: U.empB.id, body: "<p>via http</p>" } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------- E
  describe("E. Role regression", () => {
    test("EMPLOYEE requester/assignee keep full access and existing operations", async () => {
      expect((await ticketService.getTicketById(U.empA2, T.T1.id)).viewerAccess).toBe("full");
      const updated = await ticketService.updateTicket(U.empA2, T.T1.id, { status: "IN_PROGRESS" });
      expect(updated.status).toBe("IN_PROGRESS");
      await ticketService.updateTicket(U.empA2, T.T1.id, { status: "ON_HOLD", onHoldReason: "wait" });
      const assigneeView = await ticketService.getTicketById(U.empA2, T.T1.id);
      expect(assigneeView.comments.some((c) => c.isInternal)).toBe(true); // assignee still sees internal notes
    });

    test("TEAMLEAD: full on own department, internal notes allowed, other department denied", async () => {
      const t = await ticketService.getTicketById(U.tlA, T.T1.id);
      expect(t.viewerAccess).toBe("full");
      expect(t.comments.some((c) => c.isInternal)).toBe(true);
      const note = await ticketService.addComment(U.tlA, T.T1.id, { body: "<p>tl note</p>", isInternal: true });
      expect(note.isInternal).toBe(true);
      await expectForbidden(ticketService.getTicketById(U.tlA, T.T3.id));
      const r = await list("tlA");
      expect(titles(r)).toEqual([title("T1"), title("T2"), title("T4")]);
    });

    test("MANAGER: full on accessible department, unchanged list scope", async () => {
      expect((await ticketService.getTicketById(U.mgrB, T.T3.id)).viewerAccess).toBe("full");
      expect(titles(await list("mgrB"))).toEqual([title("T3")]);
    });

    test("ADMIN: full access everywhere, still cannot assign", async () => {
      expect((await ticketService.getTicketById(U.admin, T.T3.id)).viewerAccess).toBe("full");
      await expect(ticketService.updateTicket(U.admin, T.T2.id, { assigneeId: U.empA3.id })).resolves.toBeDefined();
      const t2 = await prisma.ticket.findUnique({ where: { id: T.T2.id } });
      expect(t2.assigneeId).toBeNull(); // Admin's assigneeId is ignored (existing rule)
    });

    test("EMPLOYEE default list scope unchanged (raised OR assigned only)", async () => {
      expect(titles(await list("empA3"))).toEqual([]);
      expect(titles(await list("empB"))).toEqual([]);
    });
  });
});

if (!RUN) {
  test.skip("DB integration tests skipped — set RUN_DB_TESTS=1 to run", () => {});
}
