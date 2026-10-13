jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// "How do I transfer a ticket" / "2600011 transfer to Hardware": Solvy explains how a ticket is moved
// to another department, for the user's role, using the ticket service's own transfer rule to say
// whether THIS user may do it. Nothing is ever transferred by the explanation itself.

const ticketService = require("../../services/ticket.service");
const service = require("../chatbot.service");
const { classify } = require("../intents/router");
const { users, seedDefault, prismaMock } = require("../testkit/fixtures");

const db = prismaMock.__db;
const proofs = new Map();
const ask = async (user, message, conversationId) => {
  const r = await service.sendMessage(user, { message, conversationId });
  if (r.pendingAction) proofs.set(r.pendingAction.id, { token: r.pendingAction.confirmationToken, conversationId: r.conversationId });
  return r;
};
const NEUTRAL = "You do not have permission to access this ticket, or the ticket could not be found.";

beforeEach(() => {
  seedDefault();
  proofs.clear();
  jest.spyOn(ticketService, "transferDepartment").mockResolvedValue({});
});
afterEach(() => jest.restoreAllMocks());

describe("what counts as a transfer question", () => {
  test.each(["ADMIN", "MANAGER", "TEAMLEAD", "EMPLOYEE"])("%s: loose or misspelt phrasings are a transfer question, not a ticket lookup or a list", (role) => {
    for (const q of ["2600011 tranfser to Hardware", "2600011 transfer to Hardware", "transfer department to Hardware", "how do I transfer a ticket", "how to transfer ticket to another department", "can you transfer 2600011 to Finance", "change department of ticket 2600011 to Hardware", "transfer it to Hardware", "trasnfer this ticket", "department transfer"]) {
      expect({ q, intent: classify(q, role).intent }).toEqual({ q, intent: "transfer_guidance" });
    }
  });

  test("the ticket number and the destination are read from the words", () => {
    expect(classify("2600011 tranfser to Hardware", "ADMIN").params).toEqual({ ticketNumber: "2600011", department: "Hardware" });
    expect(classify("transfer department to the Hardware team", "ADMIN").params).toEqual({ department: "Hardware" });
    expect(classify("how to transfer ticket to another department", "MANAGER").params).toEqual({});
    expect(classify("transfer it to Finance", "TEAMLEAD").params).toEqual({ department: "Finance", useLastTicket: true });
  });

  test("a complete 'transfer ticket N to X' from a role that may transfer is still the confirm-first action", () => {
    for (const role of ["MANAGER", "TEAMLEAD", "EMPLOYEE"]) {
      expect(classify("transfer ticket 2600011 to Hardware because it is a laptop issue", role)).toMatchObject({ intent: "admin_action", params: { parsed: { action: "transfer_ticket" } } });
      expect(classify("tranfser ticket 2600011 to Hardware because it is a laptop issue", role)).toMatchObject({ intent: "admin_action", params: { parsed: { action: "transfer_ticket" } } });
    }
    // Administrators cannot transfer, so they get the explanation instead of a generic refusal.
    expect(classify("transfer ticket 2600011 to Hardware because it is a laptop issue", "ADMIN").intent).toBe("transfer_guidance");
  });

  test("other meanings are left alone", () => {
    expect(classify("transfer Ravi to Finance", "ADMIN")).toMatchObject({ intent: "admin_action", params: { parsed: { action: "move_user_department" } } });
    // A reason that happens to contain "it" does not turn moving a person into a ticket transfer.
    expect(classify("transfer Ravi to Finance because it is needed", "ADMIN").intent).not.toBe("transfer_guidance");
    expect(classify("why was ticket 2600011 transferred", "MANAGER").intent).not.toBe("transfer_guidance");
    expect(classify("show tickets in Hardware", "ADMIN").intent).toBe("list_tickets");
  });
});

describe("the answer, per role", () => {
  test("Admin: told plainly that Administrators can't transfer, who can, and how it is done; no action offered", async () => {
    const r = await ask(users.admin, "2627001 tranfser to Finance");
    expect(r.intent).toBe("transfer_guidance");
    expect(r.error).toBeNull();
    const { guide } = r.data;
    expect(guide.ticket).toMatchObject({ ticketNumber: "2627001", department: "IT Support" });
    expect(guide.target).toBe("Finance");
    expect(guide.access).toEqual({ tone: "blocked", text: "Administrators can't transfer tickets. A Manager or Team Lead of IT Support, or the employee it is assigned to, can." });
    expect(guide.steps).toHaveLength(5);
    expect(guide.steps[2]).toBe("In Transfer To, choose Finance.");
    expect(guide.notes.join(" ")).toMatch(/active Manager or Team Lead/);
    expect(r.data.headline).toBe("Here's how to transfer ticket 2627001 to Finance.");
    expect(r.navigationTarget).toEqual({ type: "route", path: "/tickets/id_2627001", label: "Open Ticket 2627001" });
    expect(r.suggestedActions).toEqual([]);
  });

  test("Team Lead of the ticket's department: may transfer, and is offered the confirm-first transfer in chat", async () => {
    const r = await ask(users.tlD1, "2627001 transfer to Finance");
    expect(r.data.guide.access.tone).toBe("ok");
    expect(r.data.guide.access.text).toMatch(/^You can transfer ticket 2627001\./);
    expect(r.suggestedActions).toEqual([{ label: "Transfer 2627001 to Finance here", prompt: "Transfer ticket 2627001 to Finance" }]);

    // The chip leads to the existing flow: reason, preview, then a separate confirmation.
    const step = await ask(users.tlD1, r.suggestedActions[0].prompt, r.conversationId);
    expect(step.pendingAction).toBeFalsy();
    const preview = await ask(users.tlD1, "it belongs to their team", step.conversationId);
    expect(preview.pendingAction).toMatchObject({ title: "Transfer ticket" });
    expect(ticketService.transferDepartment).not.toHaveBeenCalled();
  });

  test("Manager of a department: a ticket in their department may be transferred", async () => {
    const r = await ask(users.mgrD2, "how do I transfer ticket 2627003 to IT Support");
    expect(r.data.guide.access.tone).toBe("ok");
    expect(r.suggestedActions[0]).toEqual({ label: "Transfer 2627003 to IT Support here", prompt: "Transfer ticket 2627003 to IT Support" });
  });

  test("Employee: only the assignee may transfer (the ticket service's own rule and wording)", async () => {
    const assignee = await ask(users.empC, "2627001 transfer to Finance");
    expect(assignee.data.guide.access.tone).toBe("ok");
    const requester = await ask(users.empA, "2627001 transfer to Finance");
    expect(requester.data.guide.access).toEqual({ tone: "blocked", text: "Only an authorized department Manager/Team Lead or the employee currently assigned to this ticket can transfer it." });
    expect(requester.suggestedActions).toEqual([]);
  });

  test("a ticket the user cannot see gets the usual neutral answer and nothing about it", async () => {
    // Dan (Finance) has no relation to this IT Support ticket: not his, not his department's, not CC'd.
    const r = await ask(users.empD, "2627001 transfer to Finance");
    expect(r.message).toBe(NEUTRAL);
    expect(r.data.guide).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/Printer on floor 2|IT Support/);
  });

  test("no ticket named: general steps, the role's own rule, and a link to their ticket list", async () => {
    const expected = { ADMIN: ["blocked", "/admin/tickets"], MANAGER: ["info", "/agent/queue"], TEAMLEAD: ["info", "/agent/queue"], EMPLOYEE: ["info", "/portal/my-tickets"] };
    const who = { ADMIN: users.admin, MANAGER: users.mgrD2, TEAMLEAD: users.tlD1, EMPLOYEE: users.empA };
    for (const [role, [tone, path]] of Object.entries(expected)) {
      const r = await ask(who[role], "transfer department to Finance");
      expect({ role, tone: r.data.guide.access.tone, path: r.navigationTarget.path }).toEqual({ role, tone, path });
      expect(r.data.guide.ticket).toBeNull();
      expect(r.data.headline).toBe("Here's how to transfer a ticket to another department.");
      expect(r.suggestedActions).toEqual([]);
    }
  });

  test("'transfer it' uses the ticket just discussed", async () => {
    const first = await ask(users.admin, "show ticket 2627001");
    const r = await ask(users.admin, "transfer it to Finance", first.conversationId);
    expect(r.data.guide.ticket.ticketNumber).toBe("2627001");
    // For a role that may transfer, the same words are a complete request: the confirm-first action asks for the reason.
    const tl = await ask(users.tlD1, "show ticket 2627001");
    const act = await ask(users.tlD1, "transfer it to Finance", tl.conversationId);
    expect(act.intent).toBe("admin_action");
    expect(act.message).toMatch(/reason/i);
    expect(ticketService.transferDepartment).not.toHaveBeenCalled();
  });
});

describe("the destination is checked, never guessed", () => {
  test("the department it is already in", async () => {
    const r = await ask(users.tlD1, "2627001 transfer to IT Support");
    expect(r.data.guide.targetNote).toBe("Ticket 2627001 is already in IT Support.");
    expect(r.suggestedActions).toEqual([]);
  });

  test("a department that does not exist", async () => {
    const r = await ask(users.tlD1, "2627001 transfer to Narnia");
    expect(r.data.guide.targetNote).toMatch(/couldn't find a department called "Narnia"/);
    expect(r.data.guide.steps[2]).toBe("In Transfer To, choose the department that should handle it.");
    expect(r.suggestedActions).toEqual([]);
  });
});

describe("nothing changes", () => {
  test("an explanation never transfers, never creates a pending change and never edits the ticket", async () => {
    const before = JSON.stringify(db.tickets);
    for (const [u, q] of [[users.tlD1, "2627001 transfer to Finance"], [users.admin, "transfer department to Finance"], [users.empC, "2627001 tranfser to Finance"]]) {
      const r = await ask(u, q);
      expect(r.pendingAction).toBeNull();
    }
    expect(ticketService.transferDepartment).not.toHaveBeenCalled();
    expect(db.pending).toHaveLength(0);
    expect(JSON.stringify(db.tickets)).toBe(before);
  });
});
