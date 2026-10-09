jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// The signed-in user's own information: dashboard numbers, notifications, and the extra
// questions about one ticket (comments, attachments, who manages it), plus the follow-ups
// "the first one" / "its comments". Runs the real chatbot against the in-memory data double;
// only the dashboard service is stood in (it uses raw SQL), computing from the same data.

const dashboardService = require("../../services/dashboard.service");
const service = require("../chatbot.service");
const { users, seedDefault, prismaMock, daysAgo } = require("../testkit/fixtures");
const { partsIn, startOfLocalDay } = require("../period");

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
    expect(r.message).toMatch(/^Your ticket summary — Last 30 days \(/);
    expect(r.message).toContain(`Raised by you: ${mine(users.empA, "created").length}`);
    expect(r.message).toContain(`Assigned to you: ${mine(users.empA, "assigned").length}`);
    expect(r.message).toMatch(/In Progress 1/);
    expect(dashboardService.getStats).toHaveBeenCalledWith(expect.objectContaining({ id: users.empA.id }), expect.objectContaining({ scope: "created", days: 30 }));
    // The structured card: one section per tab, each with its own status and priority counts.
    const report = r.data.summaryReport;
    expect(report.period.label).toBe("Last 30 days");
    expect(report.sections.map((s) => [s.key, s.label, s.total])).toEqual([
      ["created", "Raised by you", mine(users.empA, "created").length],
      ["assigned", "Assigned to you", mine(users.empA, "assigned").length],
    ]);
    expect(report.sections[0].byStatus.find((s) => s.status === "IN_PROGRESS")).toEqual({ status: "IN_PROGRESS", label: "In Progress", count: 1 });
    expect(r.data.headline).toBe("Here's your ticket summary for the last 30 days.");
    expect(r.navigationTarget).toMatchObject({ path: "/portal", label: "View Dashboard" });
  });

  test("'last 30 days' covers exactly the last 30 days, as the Dashboard page sends it (not all time)", async () => {
    const before = Date.now();
    await ask(users.empA, "give me my dashboard summary");
    const { dateFrom } = dashboardService.getStats.mock.calls[0][1];
    const from = new Date(dateFrom).getTime();
    expect(from).toBeGreaterThanOrEqual(before - 30 * 86400000 - 1000);
    expect(from).toBeLessThanOrEqual(Date.now() - 30 * 86400000 + 1000);
  });

  test("raised-by and assigned-to priorities are never mixed", async () => {
    // Alice raised 2 High tickets and has none assigned; Carol has those 2 assigned and raised none.
    const alice = (await ask(users.empA, "give me my dashboard summary")).data.summaryReport.sections;
    expect(alice.find((s) => s.key === "created").byPriority.find((p) => p.priority === "High").count).toBe(2);
    expect(alice.find((s) => s.key === "assigned").byPriority.every((p) => p.count === 0)).toBe(true);
    const carol = (await ask(users.empC, "give me my dashboard summary")).data.summaryReport.sections;
    expect(carol.find((s) => s.key === "created").total).toBe(0);
    expect(carol.find((s) => s.key === "assigned").byPriority.find((p) => p.priority === "High").count).toBe(2);
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
    expect(dashboardService.getStats).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: "created", dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) }));
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

  test("the answer carries each notification as a structured item (newest first), with unread and total kept apart", async () => {
    const all = await ask(users.empA, "show my notifications");
    const { notifications } = all.data;
    expect(notifications).toMatchObject({ unread: 2, shown: 3, matching: 3 });
    expect(notifications.items.map((n) => [n.id, n.isRead])).toEqual([["n1", false], ["n2", false], ["n3", true]]);
    expect(notifications.items[0]).toMatchObject({ type: "STATUS_CHANGED", title: "Status changed", ticketNumber: "2627001", ticketRouteId: "id_2627001" });
    expect(notifications.items[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(all.data.headline).toBe("3 notifications.");
    // Each card has its own Open Ticket button, so no extra link is put under the answer.
    expect(all.navigationTarget).toBeNull();
  });

  test("a notification about a ticket the user can no longer see has no ticket link", async () => {
    // 2627003 is a Finance ticket: outside Alice's scope, though she has a (stale) notification about it.
    db.notifications.push({ id: "n4", userId: users.empA.id, ticketId: "id_2627003", type: "STATUS_CHANGED", title: "Moved", message: "Ticket moved", isRead: false, createdAt: daysAgo(0.05) });
    const items = (await ask(users.empA, "show my notifications")).data.notifications.items;
    expect(items.find((n) => n.id === "n4").ticketRouteId).toBeNull();
    expect(items.find((n) => n.id === "n1").ticketRouteId).toBe("id_2627001");
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

  const digestTickets = (r) => [...(r.data.digest.assigned?.tickets || []), ...r.data.digest.updated.tickets];

  test.each(["what new", "what's new", "whats new", "anything new?", "what did I miss", "catch me up"])("'%s' gives a digest to every role", async (q) => {
    for (const [role, user] of Object.entries(ROLE_USERS())) {
      const r = await ask(user, q);
      expect({ role, intent: r.intent }).toEqual({ role, intent: "whats_new" });
      expect(r.message).toMatch(/^What's New — Last 7 days \(/);
      expect(r.data.digest.period.label).toBe("Last 7 days");
    }
  });

  test("an Employee sees their own notifications and tickets, nothing departmental", async () => {
    const r = await ask(users.empA, "what's new");
    const { digest } = r.data;
    expect(digest.notifications.unread).toBe(2);
    expect(r.message).toContain("• Unread (any date): 2");
    expect(digest.updated.label).toBe("Your tickets");
    expect(digest.created).toBeNull();
    expect(digest.unassigned).toBeNull();
    expect(r.message).not.toMatch(/Created|nobody assigned|Department tickets/);
    expect(JSON.stringify(r)).not.toContain("BOB-PRIVATE");
    for (const t of digestTickets(r)) expect([t.raisedBy, t.assignedTo]).toContain("Alice Employee");
  });

  test("staff also see new and unassigned tickets, only inside their departments", async () => {
    const tl = await ask(users.tlD1, "what's new");
    expect(tl.data.digest.updated.label).toBe("Department tickets");
    expect(tl.message).toMatch(/Created in the last 7 days: \d+/);
    expect(tl.message).toMatch(/Open with nobody assigned \(now\): \d+/);
    expect(tl.data.digest.assigned).toMatchObject({ count: expect.any(Number) });
    for (const t of digestTickets(tl)) expect(t.department).toBe("IT Support");
    const mgr = await ask(users.mgrD2, "what's new");
    expect(mgr.data.digest.assigned).toBeNull();
    expect(mgr.message).not.toMatch(/Assigned to you/);
    for (const t of digestTickets(mgr)) expect(t.department).toBe("Finance");
    expect((await ask(users.admin, "what's new")).data.digest.updated.label).toBe("All tickets");
  });

  test("'today' means since the user's own midnight, and the answer says so", async () => {
    const timeZone = "Asia/Kolkata";
    const p = partsIn(new Date(), timeZone);
    const midnight = startOfLocalDay(p.year, p.month, p.day, timeZone);
    for (const t of db.tickets) t.updatedAt = new Date(midnight.getTime() - 60000); // a minute before today
    db.tickets.find((t) => t.ticketNumber === "2627001").updatedAt = new Date(Date.now() - 1000); // just now
    const r = await service.sendMessage(users.empA, { message: "What's new today", timeZone });
    expect(r.data.digest.period).toMatchObject({ label: "Today", timeZone, from: midnight.toISOString() });
    expect(r.message).toMatch(/^What's New — Today \(/);
    expect(r.data.digest.updated.count + (r.data.digest.assigned?.count || 0)).toBe(1);
    expect(digestTickets(r).map((t) => t.ticketNumber)).toEqual(["2627001"]);
    expect(r.message).toContain("Updated today: 1");
    // Unread notifications are a running total, never presented as today's activity.
    expect(r.message).toContain("Unread (any date): 2");
  });

  test("an unknown time zone falls back to UTC instead of failing", async () => {
    const r = await service.sendMessage(users.empA, { message: "What's new today", timeZone: "Mars/Olympus" });
    expect(r.data.digest.period.timeZone).toBe("UTC");
    expect(r.data.digest.period.from).toBe(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  });

  test("a ticket shown under 'Assigned to you' is not shown again under 'Your tickets'", async () => {
    // Both of Carol's tickets are assigned to her and were updated yesterday.
    const r = await ask(users.empC, "what's new");
    const { assigned, updated } = r.data.digest;
    expect(assigned.tickets.map((t) => t.ticketNumber).sort()).toEqual(["2627001", "2627004"]);
    expect(updated.count).toBe(2);
    expect(updated.tickets).toEqual([]);
    expect(updated.skippedAssigned).toBe(true);
  });

  test("with nothing new the answer says 'all caught up' and fabricates nothing", async () => {
    db.notifications = db.notifications.filter((n) => n.userId !== users.empA.id);
    for (const t of db.tickets) t.updatedAt = daysAgo(30);
    const r = await ask(users.empA, "what's new today");
    expect(r.data.digest).toMatchObject({ caughtUp: true, notifications: { unread: 0, inPeriod: 0, latest: [] }, updated: { count: 0, tickets: [] } });
    expect(r.message).toContain("You're all caught up.");
    expect(r.data.headline).toBe("You're all caught up for today.");
    expect(r.message).not.toMatch(/undefined|NaN/);
  });
});
