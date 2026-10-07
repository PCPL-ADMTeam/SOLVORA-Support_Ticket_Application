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

  test("Employee A cannot access Employee B's ticket (neutral not-found, no details)", async () => {
    const r = await ask(users.empA, "Summarize ticket 2627002");
    expect(r.error.code).toBe("CHAT_TICKET_NOT_FOUND");
    expect(r.data.summary).toBeUndefined();
    expect(everything(r)).not.toMatch(/Bob|VPN|vendor/);
  });

  test("not-found and exists-but-forbidden are indistinguishable to the user, but audited differently", async () => {
    const forbidden = await ask(users.empA, "Find ticket 2627002");
    const missing = await ask(users.empA, "Find ticket 9999999");
    expect(forbidden.message).toBe(missing.message);
    expect(forbidden.error.code).toBe(missing.error.code);
    const actions = prismaMock.__db.audit.map((a) => `${a.action}:${a.result}`);
    expect(actions).toContain("TICKET_ACCESS_DENIED:DENIED");
    expect(actions).toContain("TICKET_NOT_FOUND:ERROR");
  });

  test("a manipulated ticket id (prefix, padding, injection characters) cannot bypass authorization", async () => {
    for (const msg of ["Find ticket TKT-2627002", "Find ticket 2627002 OR 1=1", "Find ticket #2627002; DROP TABLE tickets"]) {
      const r = await ask(users.empA, msg);
      expect(everything(r)).not.toMatch(/Bob|VPN/);
    }
    const r = await ask(users.empA, "Find ticket 2627002' OR '1'='1");
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

  test("Employee cannot use team/department/system views or statistics", async () => {
    for (const msg of ["Show team tickets", "Show department tickets", "Show department ticket summary", "Show overall ticket summary", "Show unassigned tickets in my department"]) {
      const r = await ask(users.empA, msg);
      // Either denied outright or (for "my"-scoped phrasing) limited to own tickets.
      if (r.error) expect(["CHAT_ACCESS_DENIED", "CHAT_NO_RESULTS"]).toContain(r.error.code);
      expect(everything(r)).not.toMatch(/2627002|2627003/);
    }
    const denied = await ask(users.empA, "Show team tickets");
    expect(denied.error.code).toBe("CHAT_ACCESS_DENIED");
    expect(prismaMock.__db.audit.some((a) => a.action === "TICKETS_SCOPE_DENIED" && a.result === "DENIED")).toBe(true);
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
    const r = await service.sendMessage(users.empA, { message: "Show team tickets", role: "ADMIN", portalRole: "ADMIN", user: users.admin });
    expect(r.error.code).toBe("CHAT_ACCESS_DENIED");
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
