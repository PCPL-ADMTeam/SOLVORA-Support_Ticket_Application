jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

const service = require("../chatbot.service");
const { users, INTERNAL_NOTE, seedDefault, prismaMock } = require("../testkit/fixtures");

const ask = (user, message, conversationId) => service.sendMessage(user, { message, conversationId });
const everything = (r) => JSON.stringify(r);

beforeEach(seedDefault);

describe("ticket authorization matrix", () => {
  test("Employee A can summarize their own ticket", async () => {
    const r = await ask(users.empA, "Summarize ticket 2627001");
    expect(r.error).toBeNull();
    expect(r.data.summary.ticketId).toBe("2627001");
  });

  test("Employee A cannot access a ticket of another department (neutral not-found, no details)", async () => {
    const r = await ask(users.empA, "Summarize ticket 2627003");
    expect(r.error.code).toBe("CHAT_TICKET_NOT_FOUND");
    expect(r.data.summary).toBeUndefined();
    expect(everything(r)).not.toMatch(/Dan Finance|Finance report/);
  });

  // Department Tickets (utils/ticketAccess.js): an Employee may VIEW a colleague's ticket in their own department and
  // add public comments, nothing else, and never sees its internal notes.
  test("Employee A can view a colleague's ticket in their own department, view-only, without internal notes", async () => {
    const r = await ask(users.empA, "Show ticket 2627002");
    expect(r.error).toBeNull();
    expect(r.data.summary.ticketId).toBe("2627002");
    expect(r.data.access.level).toBe("participant");
    expect(r.message).toMatch(/belongs to your department \(IT Support\), so you can view it and add public comments/);
    expect(everything(await ask(users.empB, "Summarize ticket 2627001"))).not.toContain(INTERNAL_NOTE);
  });

  test("not-found and exists-but-forbidden are indistinguishable to the user, but audited differently", async () => {
    const forbidden = await ask(users.empA, "Find ticket 2627003");
    const missing = await ask(users.empA, "Find ticket 9999999");
    expect(forbidden.message).toBe(missing.message);
    expect(forbidden.error.code).toBe(missing.error.code);
    const actions = prismaMock.__db.audit.map((a) => `${a.action}:${a.result}`);
    expect(actions).toContain("TICKET_ACCESS_DENIED:DENIED");
    expect(actions).toContain("TICKET_NOT_FOUND:ERROR");
  });

  test("a manipulated ticket id (prefix, padding, injection characters) cannot bypass authorization", async () => {
    for (const msg of ["Find ticket TKT-2627003", "Find ticket 2627003 OR 1=1", "Find ticket #2627003; DROP TABLE tickets"]) {
      const r = await ask(users.empA, msg);
      expect(everything(r)).not.toMatch(/Dan Finance|Finance report/);
    }
    const r = await ask(users.empA, "Find ticket 2627003' OR '1'='1");
    expect(r.error).toBeTruthy();
  });

  test("Employee never receives internal notes", async () => {
    for (const msg of ["Summarize ticket 2627001", "Show history of ticket 2627001", "What is the latest update on ticket 2627001?", "Show my open tickets"]) {
      const r = await ask(users.empA, msg);
      expect(everything(r)).not.toContain(INTERNAL_NOTE);
    }
  });

  test("Staff also never receive internal notes through the chatbot (v1 decision)", async () => {
    const r = await ask(users.tlD1, "Summarize ticket 2627001");
    expect(r.data.summary.ticketId).toBe("2627001");
    expect(everything(r)).not.toContain(INTERNAL_NOTE);
  });

  test("Employee 'my tickets' list contains only their own tickets", async () => {
    const r = await ask(users.empA, "Show my tickets");
    const numbers = r.data.tickets.map((t) => t.ticketNumber).sort();
    expect(numbers).toEqual(["2627001", "2627004"]);
  });

  test("Employee team/department views are their OWN department only; system views are refused", async () => {
    for (const msg of ["Show team tickets", "Show department tickets", "Show department ticket summary", "Show overall ticket summary", "Show unassigned tickets in my department"]) {
      const r = await ask(users.empA, msg);
      if (r.error) expect(["CHAT_ACCESS_DENIED", "CHAT_NO_RESULTS"]).toContain(r.error.code);
      // Another department's ticket never appears, whatever the wording.
      expect(everything(r)).not.toMatch(/2627003|Finance report/);
    }
    const team = await ask(users.empA, "Show team tickets");
    expect(team.data.tickets.map((t) => t.ticketNumber).sort()).toEqual(["2627001", "2627002", "2627004"]);
    expect((await ask(users.empA, "Show overall ticket summary")).error.code).toBe("CHAT_ACCESS_DENIED");
  });

  test("the ticket tool itself still refuses the staff scope to an Employee (server-side, audited)", async () => {
    const { runTool } = require("../tools");
    const { resolveRoleScope } = require("../roleScope");
    const scope = await resolveRoleScope(users.empA);
    await expect(runTool("search_authorized_tickets", { scope }, { scope: "staff" })).rejects.toMatchObject({ code: "CHAT_ACCESS_DENIED" });
    expect(prismaMock.__db.audit.some((a) => a.action === "TICKETS_SCOPE_DENIED" && a.result === "DENIED")).toBe(true);
    // Department Tickets: the Employee's own department from the server-side user record, never a department named by them.
    const dept = await runTool("search_authorized_tickets", { scope }, { scope: "department", department: "Finance", pageSize: 50 });
    expect(dept.total).toBe(0);
  });

  test("Team lead sees only their department's tickets", async () => {
    const r = await ask(users.tlD1, "Show team tickets");
    const numbers = r.data.tickets.map((t) => t.ticketNumber).sort();
    expect(numbers).toEqual(["2627001", "2627002", "2627004"]);
    expect(numbers).not.toContain("2627003");
  });

  test("Team lead cannot open a ticket from an unrelated department", async () => {
    const r = await ask(users.tlD1, "Summarize ticket 2627003");
    expect(r.error.code).toBe("CHAT_TICKET_NOT_FOUND");
    expect(everything(r)).not.toMatch(/Finance report/);
  });

  test("Manager cannot access an unrelated department", async () => {
    const own = await ask(users.mgrD2, "Summarize ticket 2627003");
    expect(own.error).toBeNull();
    const other = await ask(users.mgrD2, "Summarize ticket 2627001");
    expect(other.error.code).toBe("CHAT_TICKET_NOT_FOUND");
    const list = await ask(users.mgrD2, "Show department tickets");
    expect(list.data.tickets.map((t) => t.ticketNumber)).toEqual(["2627003"]);
  });

  test("Manager/team lead cannot get system-wide statistics; non-admin cannot see admin-only guidance", async () => {
    expect((await ask(users.mgrD2, "Show overall ticket summary")).error.code).toBe("CHAT_ACCESS_DENIED");
    expect((await ask(users.tlD1, "Show overall ticket summary")).error.code).toBe("CHAT_ACCESS_DENIED");
    for (const user of [users.empA, users.tlD1, users.mgrD2]) {
      const r = await ask(user, "How do I manage users?");
      expect(r.error.code).toBe("CHAT_ACCESS_DENIED");
      expect(r.navigationTarget).toBeNull();
      expect(everything(r)).not.toMatch(/\/admin/);
    }
  });

  test("Admin sees the whole system but still not internal notes", async () => {
    const r = await ask(users.admin, "Show overall ticket summary");
    expect(r.data.statistics.total).toBe(4);
    const t = await ask(users.admin, "Summarize ticket 2627003");
    expect(t.error).toBeNull();
    expect(everything(await ask(users.admin, "Summarize ticket 2627001"))).not.toContain(INTERNAL_NOTE);
  });

  test("a role supplied by the caller never changes the effective role", async () => {
    // The service has no role input at all; extra properties are ignored.
    const r = await service.sendMessage(users.empA, { message: "Show overall ticket summary", role: "ADMIN", portalRole: "ADMIN", user: users.admin });
    expect(r.error.code).toBe("CHAT_ACCESS_DENIED");
    expect(everything(r)).not.toMatch(/2627003|Finance report/);
    const convo = prismaMock.__db.conversations[0];
    expect(convo.portalRole).toBe("EMPLOYEE");
  });
});

describe("conversation ownership", () => {
  test("another user cannot read, continue, reset or give feedback on a conversation/message", async () => {
    const r = await ask(users.empA, "Show my open tickets");
    const id = r.conversationId;

    await expect(service.getConversation(users.empB, id)).rejects.toMatchObject({ code: "CHAT_CONVERSATION_NOT_FOUND" });
    await expect(service.getConversation(users.admin, id)).rejects.toMatchObject({ code: "CHAT_CONVERSATION_NOT_FOUND" });
    await expect(ask(users.empB, "hello", id)).rejects.toMatchObject({ code: "CHAT_CONVERSATION_NOT_FOUND" });
    await expect(service.resetConversation(users.empB, id)).rejects.toMatchObject({ code: "CHAT_CONVERSATION_NOT_FOUND" });
    await expect(service.submitFeedback(users.empB, r.messageId, { rating: "helpful" })).rejects.toMatchObject({ code: "CHAT_MESSAGE_NOT_FOUND" });

    const own = await service.getConversation(users.empA, id);
    expect(own.messages.length).toBe(2);
    expect(prismaMock.__db.audit.some((a) => a.action === "CONVERSATION_ACCESS_DENIED")).toBe(true);
  });
});
