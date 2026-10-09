jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// Multi-turn conversations: the assistant keeps hold of the ticket being talked about.

const ticketService = require("../../services/ticket.service");
const service = require("../chatbot.service");
const { resolveLastTicket } = require("../intents/pronouns");
const { seed, P } = require("../testkit/orgData");

const proofs = new Map();
const ask = async (user, message, conversationId) => {
  const r = await service.sendMessage(user, { message, conversationId });
  if (r.pendingAction) proofs.set(r.pendingAction.id, { token: r.pendingAction.confirmationToken, conversationId: r.conversationId });
  return r;
};
const confirm = (user, id) => service.confirmAction(user, id, proofs.get(id));
let spies;
beforeEach(() => {
  seed();
  proofs.clear();
  spies = {
    addComment: jest.spyOn(ticketService, "addComment").mockResolvedValue({}),
    updateTicket: jest.spyOn(ticketService, "updateTicket").mockResolvedValue({}),
  };
});
afterEach(() => jest.restoreAllMocks());

describe("pronouns become the last ticket's number (and nothing else changes)", () => {
  test.each([
    ["Who is handling it?", "Who is handling ticket 2600269?"],
    ["What priority is it?", "What priority is ticket 2600269?"],
    ["who raised this ticket", "who raised ticket 2600269"],
    ["when was it created", "when was ticket 2600269 created"],
    ["show its comments", "show ticket 2600269's comments"],
    ['Add a comment saying "Please check this urgently."', "add a comment on ticket 2600269: Please check this urgently."],
    ["add comment: on it", "add a comment on ticket 2600269: on it"],
    ["Change it to high priority.", "change priority of ticket 2600269 to high"],
    ["make it critical", "change priority of ticket 2600269 to critical"],
    ["set the priority to low", "change priority of ticket 2600269 to low"],
    ["resolve it", "resolve ticket 2600269"],
    ["assign it to Manoj", "assign ticket 2600269 to Manoj"],
  ])("%s", (said, becomes) => expect(resolveLastTicket(said, "2600269")).toBe(becomes));

  test("a message that names a ticket, or has nothing to do with one, is left alone", () => {
    expect(resolveLastTicket("who is handling ticket 2600270", "2600269")).toBe("who is handling ticket 2600270");
    expect(resolveLastTicket("how do I raise it with the vendor", "2600269")).toBe("how do I raise it with the vendor");
    expect(resolveLastTicket("show open tickets", "2600269")).toBe("show open tickets");
    expect(resolveLastTicket("who is handling it", null)).toBe("who is handling it");
  });
});

describe("the conversation from the request", () => {
  test("MANAGER: list, the first one, who, priority, comment (preview then confirm), change priority", async () => {
    let r = await ask(P.mgrBI, "Show open tickets in BI/Copilot.");
    const cid = r.conversationId;
    expect(r.data.tickets.map((t) => t.ticketNumber)).toEqual(["2600269", "2600270"]);

    r = await ask(P.mgrBI, "Show me the first one.", cid);
    expect(r.message).toMatch(/^Ticket 2600269 details:/);

    r = await ask(P.mgrBI, "Who is handling it?", cid);
    expect(r.message).toBe("Ticket 2600269 is assigned to Manoj Kumar R.");

    r = await ask(P.mgrBI, "What priority is it?", cid);
    expect(r.message).toBe("Ticket 2600269 has High priority.");

    r = await ask(P.mgrBI, 'Add a comment saying "Please check this urgently."', cid);
    expect(r.pendingAction.summary).toMatch(/2600269/);
    expect(r.pendingAction.summary).toContain("Please check this urgently.");
    expect(spies.addComment).not.toHaveBeenCalled();
    await confirm(P.mgrBI, r.pendingAction.id);
    expect(spies.addComment).toHaveBeenCalledWith(P.mgrBI, "id_2600269", { body: "Please check this urgently.", isInternal: false });

    r = await ask(P.mgrBI, "Change it to low priority.", cid);
    expect(r.pendingAction.summary).toBe("Change the priority of ticket 2600269 from High to Low.");
    await confirm(P.mgrBI, r.pendingAction.id);
    expect(spies.updateTicket).toHaveBeenCalledWith(P.mgrBI, "id_2600269", { priorityId: "p_low" });
  });

  test("EMPLOYEE: the same questions work, and changing priority is refused (not allowed for them)", async () => {
    let r = await ask(P.empBI, "Show my open tickets.");
    const cid = r.conversationId;
    r = await ask(P.empBI, "Show me the first one.", cid);
    expect(r.message).toMatch(/^Ticket 2600269 details:/);
    expect((await ask(P.empBI, "Who is handling it?", cid)).message).toBe("Ticket 2600269 is assigned to Manoj Kumar R.");
    expect((await ask(P.empBI, "What priority is it?", cid)).message).toBe("Ticket 2600269 has High priority.");
    r = await ask(P.empBI, 'Add a comment saying "Please check this urgently."', cid);
    expect(r.pendingAction.summary).toMatch(/2600269/); // an Employee may comment on their own ticket
    r = await ask(P.empBI, "Change it to low priority.", cid);
    expect(r.pendingAction).toBeFalsy();
    expect(r.message).toMatch(/permission|doesn't have access|don't have access|can't/i);
    expect(spies.updateTicket).not.toHaveBeenCalled();
  });

  test("the remembered ticket is only ever one the user was shown: another user's conversation has none", async () => {
    const a = await ask(P.mgrBI, "show ticket 2600269");
    expect(a.message).toMatch(/details/);
    const b = await ask(P.empBI, "Who is handling it?"); // a brand new conversation: nothing to refer to
    expect(b.message).not.toMatch(/2600269/);
  });
});

describe("'this ticket' with no ticket mentioned", () => {
  test("asks which ticket instead of refusing", async () => {
    const r = await ask(P.mgrBI, "who raised this ticket?");
    expect(r.message).toMatch(/Which ticket do you mean\?/);
    expect(r.message).not.toMatch(/can't help/);
  });

  test("uses the ticket page the user has open, but only if they may view it", async () => {
    const send = (user, message, pageTicketId) => service.sendMessage(user, { message, pageTicketId });
    const open = await send(P.mgrBI, "who raised this ticket?", "id_2600269");
    expect(open.message).toBe("Ticket 2600269 was raised by Srihari.");
    expect((await send(P.mgrBI, "what is the status of this ticket", "id_2600269")).message).toBe("Ticket 2600269 is In Progress.");
    // A page the user cannot view is no context at all: nothing about that ticket is revealed.
    const hidden = await send(P.mgrBI, "who raised this ticket?", "id_2600280");
    expect(hidden.message).toMatch(/Which ticket do you mean\?/);
    expect(JSON.stringify(hidden)).not.toMatch(/2600280|Manoj Kumar S/);
    // "it" refers to what the assistant last showed, the page only fills the gap.
    const first = await send(P.mgrBI, "show ticket 2600270", "id_2600269");
    const it = await service.sendMessage(P.mgrBI, { message: "who raised it?", conversationId: first.conversationId, pageTicketId: "id_2600269" });
    expect(it.message).toBe("Ticket 2600270 was raised by Srihari.");
  });
});

describe("closing or changing the status from the ticket page", () => {
  const { users } = require("../testkit/fixtures");
  const onPage = (user, message, conversationId) => service.sendMessage(user, { message, conversationId, pageTicketId: "id_2600270" });
  const send = async (user, message, conversationId) => {
    const r = await onPage(user, message, conversationId);
    if (r.pendingAction) proofs.set(r.pendingAction.id, { token: r.pendingAction.confirmationToken, conversationId: r.conversationId });
    return r;
  };

  test.each([
    ["ADMIN", users.admin],
    ["MANAGER", P.mgrBI],
    ["TEAMLEAD", P.tlBI],
    ["EMPLOYEE (assigned)", P.manojR],
  ])("%s: 'close the status of the ticket' asks why, then previews, then closes through the ticket service", async (_role, user) => {
    const ask1 = await send(user, "close the status of the ticket");
    expect(ask1.message).toBe("Why are you closing this ticket? The reason is saved with the ticket.");
    const prev = await send(user, "Duplicate of an earlier request", ask1.conversationId);
    expect(prev.pendingAction.summary).toBe('Close ticket 2600270 (currently Open) with the reason: "Duplicate of an earlier request".');
    expect(spies.updateTicket).not.toHaveBeenCalled();
    const done = await confirm(user, prev.pendingAction.id);
    expect(done.status).toBe("EXECUTED");
    expect(done.message).toBe("Ticket 2600270 was closed.");
    expect(spies.updateTicket).toHaveBeenCalledWith(user, "id_2600270", { status: "CLOSED", closedReason: "Duplicate of an earlier request" });
  });

  test("EMPLOYEE who is only the requester cannot close it: told plainly, nothing previewed", async () => {
    const r = await send(P.empBI, "close this ticket because it is fixed");
    expect(r.pendingAction).toBeFalsy();
    expect(r.message).toBe("Only the person a ticket is assigned to can close it.");
  });

  test("the other status changes work the same way", async () => {
    const hold = await send(P.tlBI, "put it on hold because waiting for the vendor");
    expect(hold.pendingAction.summary).toBe('Change ticket 2600270 from Open to On Hold ("waiting for the vendor").');
    const progress = await send(P.tlBI, "set the status to in progress");
    expect(progress.pendingAction.summary).toBe("Change ticket 2600270 from Open to In Progress.");
    const resolved = await send(P.tlBI, "resolve this ticket");
    expect(resolved.message).toMatch(/What were the resolution notes/);
    const closed = await send(P.tlBI, "set the status to closed because not needed");
    expect(closed.pendingAction.summary).toMatch(/^Close ticket 2600270/);
  });

  test("reopen a closed ticket asks for the reason", async () => {
    const r = await send(P.mgrBI, "reopen this ticket", undefined);
    expect(r.message).toMatch(/Why are you reopening this ticket\?|can't be reopened|cannot go to/i);
  });
});

describe("an answer to 'why?' is an answer, even when it names another ticket", () => {
  test("close reason that mentions a ticket number", async () => {
    const a = await service.sendMessage(P.mgrBI, { message: "close the status of the ticket", pageTicketId: "id_2600270" });
    const b = await service.sendMessage(P.mgrBI, { message: "Fixed, duplicate of 2600269", conversationId: a.conversationId, pageTicketId: "id_2600270" });
    expect(b.pendingAction.summary).toBe('Close ticket 2600270 (currently Open) with the reason: "Fixed, duplicate of 2600269".');
  });
  test("a clear new question still moves on", async () => {
    const a = await service.sendMessage(P.mgrBI, { message: "close the status of the ticket", pageTicketId: "id_2600270" });
    const b = await service.sendMessage(P.mgrBI, { message: "show ticket 2600269", conversationId: a.conversationId });
    expect(b.message).toMatch(/^Ticket 2600269 details:/);
  });
});

describe("adding a comment from chat, in the phrasings people type", () => {
  test("the exact phrasings: a ticket in view + quoted text, an explicit number + quoted text", async () => {
    let r = await ask(P.mgrBI, "show ticket 2600269");
    const cid = r.conversationId;
    r = await ask(P.mgrBI, 'add a comment in the ticket "copilot is working now"', cid);
    expect(r.responseType).toBe("preview");
    expect(spies.addComment).not.toHaveBeenCalled();
    await confirm(P.mgrBI, r.pendingAction.id);
    expect(spies.addComment).toHaveBeenLastCalledWith(P.mgrBI, "id_2600269", { body: "copilot is working now", isInternal: false });

    r = await ask(P.mgrBI, 'add a comment in the ticket 2600270 "copilot is working now"');
    expect(r.responseType).toBe("preview");
    await confirm(P.mgrBI, r.pendingAction.id);
    expect(spies.addComment).toHaveBeenLastCalledWith(P.mgrBI, "id_2600270", { body: "copilot is working now", isInternal: false });
  });

  test("'add a comment' alone asks which ticket, then what to say; with a ticket in view it asks only what to say", async () => {
    let r = await ask(P.mgrBI, "add a comment");
    expect(r.message).toMatch(/Which ticket number\?/);
    r = await ask(P.mgrBI, "2600269", r.conversationId);
    expect(r.message).toMatch(/What should the comment say\?/);
    r = await ask(P.mgrBI, "checking now", r.conversationId);
    expect(r.responseType).toBe("preview");

    const first = await ask(P.mgrBI, "show ticket 2600270");
    const again = await ask(P.mgrBI, "add a comment in ticket", first.conversationId);
    expect(again.message).toMatch(/What should the comment say\?/);
    const done = await ask(P.mgrBI, "all good now", again.conversationId);
    expect(done.responseType).toBe("preview");
    await confirm(P.mgrBI, done.pendingAction.id);
    expect(spies.addComment).toHaveBeenLastCalledWith(P.mgrBI, "id_2600270", { body: "all good now", isInternal: false });
  });
});
