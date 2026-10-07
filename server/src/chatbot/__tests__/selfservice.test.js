jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// The signed-in user's own information: dashboard numbers, notifications, and the extra
// questions about one ticket (comments, attachments, who manages it), plus the follow-ups
// "the first one" / "its comments". Runs the real chatbot against the in-memory data double;
// only the dashboard service is stood in (it uses raw SQL), computing from the same data.

const dashboardService = require("../../services/dashboard.service");
const service = require("../chatbot.service");
const { users, seedDefault, prismaMock, daysAgo } = require("../testkit/fixtures");

const db = prismaMock.__db;
const proofs = new Map();
const ask = async (user, message, conversationId) => {
  const r = await service.sendMessage(user, { message, conversationId });
  if (r.pendingAction) proofs.set(r.pendingAction.id, { token: r.pendingAction.confirmationToken, conversationId: r.conversationId });
  return r;
};
const confirm = (user, id) => service.confirmAction(user, id, proofs.get(id));

const STATUSES = ["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED"];
beforeEach(() => {
  seedDefault();
  proofs.clear();
  jest.spyOn(dashboardService, "getStats").mockImplementation(async (user, { scope }) => {
    const rows = db.tickets.filter((t) => (scope === "created" ? t.requesterId === user.id : scope === "assigned" ? t.assigneeId === user.id : t.requesterId === user.id || t.assigneeId === user.id));
    return {
      kpis: { total: rows.length },
      byStatus: STATUSES.map((s) => ({ status: s, count: rows.filter((t) => t.status === s).length })),
      byPriority: db.priorities.map((p) => ({ id: p.id, priority: p.name, count: rows.filter((t) => t.priorityId === p.id).length })),
    };
  });
  const t1 = db.tickets.find((t) => t.ticketNumber === "2627001");
  t1.attachments = [{ fileName: "printer-error.png", fileSize: 20480, createdAt: daysAgo(2), uploadedBy: { name: "Alice Employee" } }];
  t1.commentsCount = 1;
  db.notifications.push(
    { id: "n1", userId: users.empA.id, ticketId: t1.id, type: "STATUS_CHANGED", title: "Status changed", message: "Ticket 2627001 is now In Progress", isRead: false, createdAt: daysAgo(0.1) },
    { id: "n2", userId: users.empA.id, ticketId: null, type: "TICKET_ASSIGNED", title: "Assigned", message: "You were assigned a ticket", isRead: false, createdAt: daysAgo(1) },
    { id: "n3", userId: users.empA.id, ticketId: null, type: "NEW_COMMENT", title: "New comment", message: "Someone commented", isRead: true, createdAt: daysAgo(3) },
    { id: "n9", userId: users.empB.id, ticketId: null, type: "NEW_COMMENT", title: "Bob only", message: "BOB-PRIVATE-NOTIFICATION", isRead: false, createdAt: daysAgo(1) }
  );
});
afterEach(() => jest.restoreAllMocks());

const mine = (u, key) => db.tickets.filter((t) => (key === "created" ? t.requesterId === u.id : t.assigneeId === u.id));

describe("dashboard numbers (the same service the Dashboard page uses)", () => {
  test("summary shows both tabs with status counts", async () => {
    const r = await ask(users.empA, "give me my dashboard summary");
    expect(r.intent).toBe("dashboard_summary");
    expect(r.message).toContain("Your ticket summary (the last 30 days)");
    expect(r.message).toContain(`Raised by you: ${mine(users.empA, "created").length}`);
    expect(r.message).toContain(`Assigned to you: ${mine(users.empA, "assigned").length}`);
    expect(r.message).toMatch(/In Progress 1/);
    expect(dashboardService.getStats).toHaveBeenCalledWith(expect.objectContaining({ id: users.empA.id }), expect.objectContaining({ scope: "created", days: 30 }));
  });

  test("counts are answered per dashboard tab, never guessed", async () => {
    const both = await ask(users.empA, "how many resolved tickets do I have");
    expect(both.message).toMatch(/Raised by you: 1/);
    expect(both.message).toMatch(/Assigned to you: 0/);
    const raised = await ask(users.empA, "how many tickets did I raise");
    expect(raised.message).toBe(`You raised ${mine(users.empA, "created").length} tickets (the last 30 days).`);
    const assigned = await ask(users.empC, "how many tickets are assigned to me");
    expect(assigned.message).toBe(`You have ${mine(users.empC, "assigned").length} tickets assigned to you (the last 30 days).`);
  });

  test("a date range in the question is passed to the dashboard", async () => {
    await ask(users.empA, "how many tickets have I created in the last 7 days");
    expect(dashboardService.getStats).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: "created", dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });

  test("the user is always the authenticated one", async () => {
    await ask(users.empB, "show my dashboard");
    for (const [u] of dashboardService.getStats.mock.calls) expect(u.id).toBe(users.empB.id);
  });
});

describe("notifications", () => {
  test("list, unread, count and by ticket: only the caller's own", async () => {
    const all = await ask(users.empA, "show my notifications");
    expect(all.message).toMatch(/3 notifications/);
    expect(all.message).toContain("2 unread in total");
    expect(JSON.stringify(all)).not.toContain("BOB-PRIVATE");
    expect((await ask(users.empA, "show unread notifications")).message).toMatch(/2 unread notifications/);
    expect((await ask(users.empA, "how many unread notifications do I have")).message).toBe("You have 2 unread notifications.");
    expect((await ask(users.empA, "show notifications related to ticket 2627001")).message).toMatch(/1 notification for ticket 2627001/);
    expect((await ask(users.empC, "do I have unread notifications")).message).toBe("You have no unread notifications.");
  });

  test("mark all as read: preview first, then only the caller's rows change", async () => {
    const preview = await ask(users.empA, "mark all notifications as read");
    expect(preview.pendingAction.summary).toBe("Mark your 2 unread notifications as read.");
    expect(db.notifications.filter((n) => n.userId === users.empA.id && !n.isRead)).toHaveLength(2);
    const done = await confirm(users.empA, preview.pendingAction.id);
    expect(done.status).toBe("EXECUTED");
    expect(db.notifications.filter((n) => n.userId === users.empA.id && !n.isRead)).toHaveLength(0);
    expect(db.notifications.find((n) => n.id === "n9").isRead).toBe(false);
  });

  test("clear all: preview first, deletes only the caller's notifications", async () => {
    const preview = await ask(users.empA, "clear all my notifications");
    expect(preview.pendingAction.summary).toBe("Permanently delete all 3 of your notifications.");
    expect(db.notifications).toHaveLength(4);
    await confirm(users.empA, preview.pendingAction.id);
    expect(db.notifications.map((n) => n.id)).toEqual(["n9"]);
  });

  test("mark the latest notification as read", async () => {
    const preview = await ask(users.empA, "mark the latest notification as read");
    await confirm(users.empA, preview.pendingAction.id);
    expect(db.notifications.find((n) => n.id === "n1").isRead).toBe(true);
    expect(db.notifications.find((n) => n.id === "n2").isRead).toBe(false);
  });

  test("nothing to do is said plainly", async () => {
    const r = await ask(users.empC, "mark all notifications as read");
    expect(r.error.code).toBe("CHAT_ACTION_INVALID");
    expect(r.message).toBe("You have no unread notifications.");
  });
});

describe("one ticket: comments, attachments, people", () => {
  test("comments show public ones only", async () => {
    const r = await ask(users.empA, "show comments on ticket 2627001");
    expect(r.intent).toBe("ticket_comments");
    expect(r.message).toContain("We ordered a new toner");
    expect(r.message).not.toContain("INTERNAL-SECRET-NOTE");
  });

  test("attachments list names and sizes, never paths", async () => {
    const r = await ask(users.empA, "does ticket 2627001 have attachments");
    expect(r.message).toContain("printer-error.png (20 KB)");
    expect(JSON.stringify(r)).not.toMatch(/filePath|storage/i);
    expect((await ask(users.empA, "show attachments for ticket 2627004")).message).toBe("Ticket 2627004 has no attachments.");
  });

  test("another department's ticket stays neutral for comments, attachments and people", async () => {
    for (const q of ["show comments on ticket 2627003", "show attachments for ticket 2627003", "who is the manager for ticket 2627003"]) {
      const r = await ask(users.empA, q);
      expect(r.message).toBe("You do not have permission to access this ticket, or the ticket could not be found.");
    }
  });

  test("who manages / leads the ticket's department", async () => {
    const lead = await ask(users.tlD1, "who is the team lead for ticket 2627001");
    expect(lead.message).toContain("Tina Lead — Team Lead");
    expect(lead.message).not.toContain("Alice");
    const emp = await ask(users.empA, "who is the team lead for ticket 2627001");
    expect(emp.error.code).toBe("CHAT_ACCESS_DENIED");
  });

  test("status question gets a one-line answer", async () => {
    expect((await ask(users.empA, "what's the status of ticket 2627001")).message).toBe("Ticket 2627001 is In Progress.");
  });
});

describe("follow-ups that point at a shown ticket", () => {
  test("'the first one' and 'its comments' use what was just shown", async () => {
    const list = await ask(users.empA, "show my tickets");
    const first = list.data.tickets[0].ticketNumber;
    const who = await ask(users.empA, "who is handling the first one", list.conversationId);
    expect(who.message).toContain(`Ticket ${first}`);
    const comments = await ask(users.empA, "show its comments", who.conversationId);
    expect(comments.intent).toBe("ticket_comments");
    expect(comments.message).toContain(first);
  });

  test("the list cannot be used to reach another ticket", async () => {
    const list = await ask(users.empA, "show my tickets");
    const r = await ask(users.empA, "show comments on ticket 2627003", list.conversationId);
    expect(r.message).toBe("You do not have permission to access this ticket, or the ticket could not be found.");
  });
});

describe("transfer a ticket (ticket.service.transferDepartment, with its own role rules)", () => {
  const ticketService = require("../../services/ticket.service");
  const parse = require("../intents/actionParser").parseAction;

  test("parsed with its department and reason; a missing reason is asked for", () => {
    expect(parse("transfer ticket 2627001 to Finance because it is a billing issue")).toMatchObject({ action: "transfer_ticket", args: { ticket: "2627001", department: "Finance", reason: "it is a billing issue" } });
    expect(parse("transfer ticket 2627001 to Finance department")).toMatchObject({ action: "transfer_ticket", missing: ["reason"] });
  });

  test("preview, then the existing service does the transfer; Admin and requesters are refused", async () => {
    const spy = jest.spyOn(ticketService, "transferDepartment").mockResolvedValue({});
    const preview = await ask(users.tlD1, "transfer ticket 2627001 to Finance because it is a billing issue");
    expect(preview.pendingAction.summary).toBe('Transfer ticket 2627001 to Finance because: "it is a billing issue".');
    expect(spy).not.toHaveBeenCalled();
    await confirm(users.tlD1, preview.pendingAction.id);
    expect(spy).toHaveBeenCalledWith(users.tlD1, "id_2627001", { toDepartmentId: "dept_finance", transferReason: "it is a billing issue" });
    const admin = await ask(users.admin, "transfer ticket 2627001 to Finance because x");
    expect(admin.responseType).not.toBe("preview");
    const requester = await ask(users.empA, "transfer ticket 2627001 to Finance because x");
    expect(requester.error.code).toBe("CHAT_INVALID_ROLE_OPERATION");
  });
});

describe("ticket dates", () => {
  test("created and last updated, in UTC; no ticket number asks which one", async () => {
    const t = db.tickets.find((x) => x.ticketNumber === "2627001");
    const created = await ask(users.empA, "ticket 2627001 is created at ?");
    expect(created.intent).toBe("ticket_dates");
    expect(created.message).toMatch(/^Ticket 2627001 was created on \d{1,2} \w{3,4} \d{4} \d{2}:\d{2} UTC\./);
    expect(created.message).toContain(new Date(t.createdAt).getUTCFullYear().toString());
    expect((await ask(users.empA, "when was ticket 2627001 last updated")).message).toMatch(/^Ticket 2627001 was last updated on /);
    const noNumber = await ask(users.empA, "when the ticket is created ?");
    expect(noNumber.message).toMatch(/Which ticket/i);
  });
  test("another department's ticket stays neutral", async () => {
    expect((await ask(users.empA, "when was ticket 2627003 created")).message).toBe("You do not have permission to access this ticket, or the ticket could not be found.");
  });
});

describe("what's new", () => {
  const ROLE_USERS = () => ({ EMPLOYEE: users.empA, TEAMLEAD: users.tlD1, MANAGER: users.mgrD2, ADMIN: users.admin });

  test.each(["what new", "what's new", "whats new", "anything new?", "what did I miss", "catch me up"])("'%s' gives a digest to every role", async (q) => {
    for (const [role, user] of Object.entries(ROLE_USERS())) {
      const r = await ask(user, q);
      expect({ role, intent: r.intent }).toEqual({ role, intent: "whats_new" });
      expect(r.message).toMatch(/^What's new \(the last 7 days\)|^Nothing new/);
    }
  });

  test("an Employee sees their own notifications and tickets, nothing departmental", async () => {
    const r = await ask(users.empA, "what's new");
    expect(r.message).toContain("• Notifications: 2 unread");
    expect(r.message).toContain("• Your tickets updated:");
    expect(r.message).not.toMatch(/New tickets created|nobody assigned|Department tickets/);
    expect(r.message).toContain("Latest notifications:");
    expect(JSON.stringify(r)).not.toContain("BOB-PRIVATE");
    for (const t of r.data.tickets) expect([t.raisedBy, t.assignedTo]).toContain("Alice Employee");
  });

  test("staff also see new and unassigned tickets, only inside their departments", async () => {
    const tl = await ask(users.tlD1, "what's new");
    expect(tl.message).toMatch(/Department tickets updated: \d+/);
    expect(tl.message).toMatch(/New tickets created: \d+/);
    expect(tl.message).toMatch(/Open tickets with nobody assigned: \d+/);
    expect(tl.message).toMatch(/Assigned to you and updated: \d+/);
    for (const t of tl.data.tickets) expect(t.department).toBe("IT Support");
    const mgr = await ask(users.mgrD2, "what's new");
    expect(mgr.message).not.toMatch(/Assigned to you/);
    for (const t of mgr.data.tickets) expect(t.department).toBe("Finance");
    expect((await ask(users.admin, "what's new")).message).toMatch(/Tickets updated: \d+/);
  });

  test("a range changes the window, and nothing odd is printed for a quiet account", async () => {
    expect((await ask(users.empA, "what's new today")).message).toMatch(/^What's new \(today\)|^Nothing new in today/);
    expect((await ask(users.empC, "what's new")).message).not.toMatch(/undefined|NaN/);
  });
});
