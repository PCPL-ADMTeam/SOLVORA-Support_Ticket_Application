jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// Feature synchronization with the application's current access model (utils/ticketAccess.js) and portal tabs:
// Department Tickets, Custom CC, view-only (participant) access, "my tickets" ambiguity, equivalent wording,
// and attachment visibility. Every expectation is the application's rule, checked through the chatbot service
// on the in-memory database (no real database, no AI provider).

const ticketService = require("../../services/ticket.service");
const service = require("../chatbot.service");
const { users, D1, ticket, seedDefault, prismaMock, daysAgo, INTERNAL_NOTE } = require("../testkit/fixtures");

const db = prismaMock.__db;
const NEUTRAL = "You do not have permission to access this ticket, or the ticket could not be found.";
const ask = (user, message, conversationId) => service.sendMessage(user, { message, conversationId });
const nums = (r) => (r.data?.tickets || []).map((t) => t.ticketNumber).sort();
const T = (n) => db.tickets.find((t) => t.ticketNumber === n);
let spies;

beforeEach(() => {
  seedDefault();
  spies = {
    updateTicket: jest.spyOn(ticketService, "updateTicket").mockResolvedValue({}),
    addComment: jest.spyOn(ticketService, "addComment").mockResolvedValue({}),
    transferDepartment: jest.spyOn(ticketService, "transferDepartment").mockResolvedValue({}),
  };
});
afterEach(() => jest.restoreAllMocks());
const noWrites = () => Object.values(spies).forEach((s) => expect(s).not.toHaveBeenCalled());

describe("Department Tickets (the portal tab), per role", () => {
  test("SYNC-01 Employee: their own department only, from the server-side department (never a named one)", async () => {
    const r = await ask(users.empA, "Show my department's tickets");
    expect(r.data.listing.title).toBe("My Department's Tickets");
    expect(nums(r)).toEqual(["2627001", "2627002", "2627004"]);
    expect(r.data.listing.notes.join(" ")).toMatch(/your department \(IT Support\)\. You can view them and add public comments/);
    const finance = await ask(users.empA, "Show tickets in Finance");
    expect(finance.error.code).toBe("CHAT_ACCESS_DENIED");
    expect(finance.message).toMatch(/Department Tickets for your own department \(IT Support\) only/);
    expect(JSON.stringify(finance)).not.toMatch(/2627003|Finance report/);
  });

  test("SYNC-02 Employee: department filters (status, assignment state, assignee, count) match the backend tab", async () => {
    const tab = async (query) => (await ticketService.listTickets(users.empA, { limit: 100, scope: "department", ...query })).data.map((t) => t.ticketNumber).sort();
    expect(nums(await ask(users.empA, "Show open tickets in my department"))).toEqual((await tab({})).filter((n) => T(n).status !== "RESOLVED" && T(n).status !== "CLOSED"));
    expect(nums(await ask(users.empA, "Show unassigned tickets in my department"))).toEqual(await tab({ assigned: "false" }));
    expect(nums(await ask(users.empA, "Show my department's tickets assigned to Carol Worker"))).toEqual(await tab({ assigneeId: users.empC.id }));
    expect((await ask(users.empA, "How many tickets are in my department?")).message).toBe(`There are ${(await tab({})).length} tickets in your department (IT Support).`);
  });

  test("SYNC-03 Employee with no department: the portal's notice, nothing listed", async () => {
    const lone = { ...users.empA, id: "u_lone", name: "Lone Employee", departmentId: null, department: null };
    db.users.push(lone);
    const r = await ask(lone, "Show my department's tickets");
    expect(r.error.code).toBe("CHAT_NO_RESULTS");
    expect(r.message).toBe("Your account has no department assigned, so there are no department tickets to show. Contact an administrator.");
  });

  test("SYNC-04 Team Lead / Manager: their accessible departments; Admin: every department", async () => {
    expect(nums(await ask(users.tlD1, "Show my department's tickets"))).toEqual(["2627001", "2627002", "2627004"]);
    expect(nums(await ask(users.mgrD2, "Show my department's tickets"))).toEqual(["2627003"]);
    const all = await ask(users.admin, "Show my department's tickets");
    expect(all.data.listing.title).toBe("All Tickets");
    expect(all.data.total).toBe(4);
  });

  test("SYNC-05 department statistics: an Employee's are their Department Tickets", async () => {
    const r = await ask(users.empA, "Show my department ticket statistics");
    expect(r.data.statistics.label).toBe("Your department (IT Support)");
    expect(r.data.statistics.total).toBe(3);
  });
});

describe("view-only (participant) access: Department Tickets and Custom CC", () => {
  test("SYNC-06 a colleague's department ticket: view + public comment; every change is refused before any preview", async () => {
    const shown = await ask(users.empB, "Show ticket 2627001");
    expect(shown.data.access.level).toBe("participant");
    expect(shown.suggestedActions.map((a) => a.label)).toContain("Add a comment");
    expect(JSON.stringify(shown)).not.toContain(INTERNAL_NOTE);
    for (const msg of ["Close ticket 2627001 reason: duplicate", "Resolve ticket 2627001 because it works", "Transfer ticket 2627001 to Finance because billing", "Reopen ticket 2627004 because it broke again"]) {
      const r = await ask(users.empB, msg);
      expect({ msg, code: r.error?.code, preview: Boolean(r.pendingAction) }).toEqual({ msg, code: "CHAT_ACCESS_DENIED", preview: false });
      expect(r.message).toMatch(/belongs to your department \(IT Support\), so you can view it and add public comments\. You can't/);
    }
    expect((await ask(users.empB, "Add a comment on ticket 2627001: same problem here")).pendingAction).toBeTruthy();
    noWrites();
    expect(db.audit.some((a) => a.action === "ACTION_TICKET_ACCESS_DENIED" && a.result === "DENIED")).toBe(true);
  });

  test("SYNC-07 Custom CC (another department's Manager): view + comment only; removing the CC removes the access", async () => {
    T("2627001").ccUsers = [{ userId: users.mgrD2.id }];
    const shown = await ask(users.mgrD2, "Show ticket 2627001");
    expect(shown.message).toMatch(/Your access: you're on this ticket's Custom CC list/);
    expect(JSON.stringify(shown)).not.toContain(INTERNAL_NOTE);
    for (const msg of ["Change priority of ticket 2627001 to Low", "Assign ticket 2627001 to Bob Employee", "Set ticket 2627001 to on hold because waiting"]) {
      const r = await ask(users.mgrD2, msg);
      expect({ msg, code: r.error?.code }).toEqual({ msg, code: "CHAT_ACCESS_DENIED" });
      expect(r.message).toMatch(/Custom CC list of ticket 2627001/);
    }
    expect((await ask(users.mgrD2, "Add a comment on ticket 2627001: looping in finance")).pendingAction).toBeTruthy();
    expect(nums(await ask(users.mgrD2, "Show tickets I'm CC'd on"))).toEqual(["2627001"]);
    // The CC opens that ticket only: the Manager's department view is unchanged.
    expect(nums(await ask(users.mgrD2, "Show my department's tickets"))).toEqual(["2627003"]);
    T("2627001").ccUsers = [];
    expect((await ask(users.mgrD2, "Show ticket 2627001")).message).toBe(NEUTRAL);
    noWrites();
  });

  test("SYNC-08 a Manager who raised a ticket now in another department: view only, not even comments", async () => {
    db.tickets.push(ticket({ ticketNumber: "2627020", title: "Raised by Mark", requester: users.mgrD2, dept: D1, status: "OPEN" }));
    const shown = await ask(users.mgrD2, "Show ticket 2627020");
    expect(shown.message).toMatch(/you raised this ticket, but it is now handled by IT Support, so you can only view it/);
    const r = await ask(users.mgrD2, "Add a comment on ticket 2627020: any news?");
    expect(r.error.code).toBe("CHAT_ACCESS_DENIED");
    expect(r.pendingAction).toBeNull();
  });

  test("SYNC-09 attachments on internal notes are never listed (as on the ticket page), for any role", async () => {
    T("2627001").attachments = [
      { fileName: "screenshot.png", fileSize: 2048, createdAt: daysAgo(3), commentId: null, uploadedBy: { name: "Alice Employee" } },
      { fileName: "public-reply.pdf", fileSize: 4096, createdAt: daysAgo(2), commentId: "c_pub", comment: { isInternal: false }, uploadedBy: { name: "Carol Worker" } },
      { fileName: "internal-root-cause.txt", fileSize: 1024, createdAt: daysAgo(1), commentId: "c_int", comment: { isInternal: true }, uploadedBy: { name: "Tina Lead" } },
    ];
    for (const user of [users.empA, users.empB, users.tlD1, users.admin]) {
      const r = await ask(user, "Show attachments for ticket 2627001");
      const names = JSON.stringify(r);
      expect(names).toContain("screenshot.png");
      expect(names).toContain("public-reply.pdf");
      expect(names).not.toContain("internal-root-cause.txt");
    }
  });
});

describe("'my tickets' is never one blended answer", () => {
  test("SYNC-10 only one of my tabs has tickets: shown directly, saying why", async () => {
    const r = await ask(users.empA, "Show my tickets");
    expect(r.data.listing.title).toBe("Tickets Raised by Me");
    expect(nums(r)).toEqual(["2627001", "2627004"]);
    expect(r.data.listing.notes).toContain("You have no tickets assigned to you, so these are the ones raised by you.");
  });

  test("SYNC-11 both tabs have tickets: asked, with each tab's count; a typed or clicked answer resumes the same filters", async () => {
    db.tickets.push(ticket({ ticketNumber: "2627030", title: "Tina's own request", requester: users.tlD1, dept: D1, status: "OPEN" }));
    T("2627002").assigneeId = users.tlD1.id;
    T("2627002").assignee = { name: users.tlD1.name };
    const q = await ask(users.tlD1, "Show my open tickets");
    expect(q.responseType).toBe("clarification");
    expect(q.message).toBe("Would you like the open tickets raised by you or assigned to you? You have 1 raised by you and 1 assigned to you.");
    expect(q.data.counts).toEqual({ raised: 1, assigned: 1 });
    expect(q.suggestedActions).toEqual([
      { label: "Raised by Me (1)", prompt: "Show open tickets raised by me" },
      { label: "Assigned to Me (1)", prompt: "Show open tickets assigned to me" },
    ]);
    const typed = await ask(users.tlD1, "assigned", q.conversationId);
    expect(typed.data.listing.title).toBe("Open Tickets Assigned to Me");
    expect(nums(typed)).toEqual(["2627002"]);
    const again = await ask(users.tlD1, "Show my open tickets");
    const clicked = await ask(users.tlD1, again.suggestedActions[0].prompt, again.conversationId);
    expect(clicked.data.listing.title).toBe("Open Tickets Raised by Me");
    expect(nums(clicked)).toEqual(["2627030"]);
    const byNumber = await ask(users.tlD1, "Show my open tickets");
    expect(nums(await ask(users.tlD1, "2", byNumber.conversationId))).toEqual(["2627002"]);
  });

  test("SYNC-12 a count is answered per tab, side by side", async () => {
    const r = await ask(users.empA, "How many tickets am I CC'd on?");
    expect(r.message).toBe("You have no tickets that you're CC'd on.");
    const d = await ask(users.empA, "How many open tickets do I have?");
    expect(d.message).toMatch(/Raised by you: 1/);
    expect(d.message).toMatch(/Assigned to you: 0/);
  });

  test("SYNC-13 an Employee's question with no 'my' offers their Department Tickets too", async () => {
    const q = await ask(users.empA, "Show open tickets");
    expect(q.responseType).toBe("clarification");
    expect(q.data.counts).toEqual({ raised: 1, assigned: 0, dept: 2 });
    expect(q.message).toBe("Would you like the open tickets raised by you or in your department (IT Support)? You have 1 raised by you and 2 in your department (IT Support); none are assigned to you.");
    expect(nums(await ask(users.empA, "department", q.conversationId))).toEqual(["2627001", "2627002"]);
  });

  test("SYNC-14 a Manager's 'my tickets' are the ones they raised; an Admin is told they have none", async () => {
    db.tickets.push(ticket({ ticketNumber: "2627040", title: "Mark's request", requester: users.mgrD2, dept: D1, status: "OPEN" }));
    const m = await ask(users.mgrD2, "Show my tickets");
    expect(m.data.listing.title).toBe("Tickets Raised by Me");
    expect(nums(m)).toEqual(["2627040"]);
    const a = await ask(users.admin, "Show my tickets");
    expect(a.message).toMatch(/^Admins don't raise tickets and are never assigned tickets/);
  });

  test("SYNC-15 asking for both explicitly lists both together, once each", async () => {
    T("2627002").assigneeId = users.empA.id;
    T("2627002").assignee = { name: users.empA.name };
    const r = await ask(users.empA, "Show tickets raised by me or assigned to me");
    expect(r.data.listing.title).toBe("Tickets Raised by or Assigned to Me");
    expect(nums(r)).toEqual(["2627001", "2627002", "2627004"]);
  });
});

describe("equivalent wording gives the same answer and the same scope", () => {
  const PHRASES = ["Show my resolved tickets", "Which tickets have I resolved?", "List the tickets that are resolved and belong to me", "Can I see my completed tickets?"];
  test.each([
    ["EMPLOYEE (raised only)", "empA", ["2627004"], "Resolved Tickets Raised by Me"],
    ["EMPLOYEE (assigned only)", "empC", ["2627004"], "Resolved Tickets Assigned to Me"],
    ["TEAMLEAD (none of their own)", "tlD1", [], null],
  ])("SYNC-16 %s", async (_label, who, tickets, title) => {
    const answers = [];
    for (const p of PHRASES) {
      const r = await ask(users[who], p);
      answers.push({ intent: r.intent, code: r.error?.code || null, title: r.data?.listing?.title || null, tickets: nums(r), message: title ? null : r.message });
    }
    for (const a of answers) expect(a).toEqual(answers[0]);
    expect(answers[0].tickets).toEqual(tickets);
    expect(answers[0].title).toBe(title);
  });
});

describe("search, follow-ups and parsing", () => {
  test("SYNC-17 a text search covers everything the user may view (the portal's global search), nothing more", async () => {
    const r = await ask(users.empA, "Show tickets about VPN");
    expect(nums(r)).toEqual(["2627002"]);
    expect(r.data.listing.notes.join(" ")).toMatch(/Searched every ticket you can view/);
    expect(nums(await ask(users.empD, "Show tickets about VPN"))).toEqual([]);
  });

  test("SYNC-18 'resolve ticket N because ...' carries the resolution notes into the preview", async () => {
    const r = await ask(users.empC, "Resolve ticket 2627001 because the toner was replaced");
    expect(r.pendingAction).toBeTruthy();
    expect(r.pendingAction.summary).toMatch(/from In Progress to Resolved \("the toner was replaced"\)/);
  });

  test("SYNC-19 a follow-up keeps the department view ('only open ones')", async () => {
    const first = await ask(users.empA, "Show my department's tickets");
    const next = await ask(users.empA, "Only open ones", first.conversationId);
    expect(next.data.listing.title).toBe("My Department's Open Tickets");
    expect(nums(next)).toEqual(["2627001", "2627002"]);
  });
});
