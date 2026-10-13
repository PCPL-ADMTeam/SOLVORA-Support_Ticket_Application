jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// The single ticket session: ONE form (title, priority, department, problem summary, CC people),
// ONE review, ONE final "Raise Ticket". Files are not taken in the chat (the form links to the
// Create Ticket page for those). The ticket itself is created by ticket.service.createTicket
// (spied here, so each case can check exactly what the existing service receives).

const ticketService = require("../../services/ticket.service");
const userService = require("../../services/user.service");
const service = require("../chatbot.service");
const { users, seedDefault, prismaMock } = require("../testkit/fixtures");

const db = prismaMock.__db;
let create;
const ask = (user, message, conversationId) => service.sendMessage(user, { message, conversationId });
const form = (over = {}) => ({ title: "Printer broken", priority: "High", department: "Finance", problemSummary: "The printer jams on every page.", ccUserIds: [], ...over });

async function start(user = users.empA) {
  const r = await ask(user, "Raise a ticket");
  return { r, cid: r.conversationId, draft: r.data.ticketDraft };
}
const review = (user, cid, over) => service.submitDraftForm(user, { conversationId: cid, ...form(over) });
const confirm = (user, r) => service.confirmAction(user, r.pendingAction.id, { token: r.pendingAction.confirmationToken, conversationId: r.conversationId });

beforeEach(() => {
  seedDefault();
  db.priorities.push({ id: "p_med", name: "Medium", level: 2, color: "#aaa" }, { id: "p_crit", name: "Critical", level: 4, color: "#f00" });
  create = jest.spyOn(ticketService, "createTicket").mockResolvedValue({ id: "id_2600099", ticketNumber: "2600099", status: "OPEN" });
  jest.spyOn(userService, "searchActiveEmployees").mockImplementation(async (q) =>
    db.users.filter((u) => u.isActive && (u.name.toLowerCase().includes(String(q).toLowerCase()) || String(u.email || "").toLowerCase().includes(String(q).toLowerCase()))).map((u) => ({ id: u.id, name: u.name, email: u.email, department: u.department, departmentAccess: [] }))
  );
});
afterEach(() => jest.restoreAllMocks());

describe("start: one form, no separate CC or file questions", () => {
  test("'Raise a ticket' opens the form with the real priorities and departments", async () => {
    const { r, draft } = await start();
    expect(r.intent).toBe("ticket_draft");
    expect(draft.options.priorities).toEqual(expect.arrayContaining(["Low", "High", "Medium", "Critical"]));
    expect(draft.options.departments).toEqual(expect.arrayContaining(["IT Support", "Finance"]));
    expect(r.message).not.toMatch(/add anyone in CC|attach any files/);
    expect(create).not.toHaveBeenCalled();
  });

  test("an opening message with details pre-fills them; only what is missing is asked", async () => {
    const r = await ask(users.empA, "Raise a ticket titled VPN down, high priority, to Finance department.");
    expect(r.data.ticketDraft).toMatchObject({ title: "VPN down", priority: "High", department: "Finance", summary: null });
    expect(r.message).toMatch(/describe the problem/);
  });
});

describe("Review Ticket: all fields at once, nothing is created", () => {
  test("a complete form becomes the review; only the final Raise Ticket creates the ticket, once", async () => {
    const { cid } = await start();
    const rev = await review(users.empA, cid, { ccUserIds: ["u_empB", "u_empC"] });
    expect(rev.pendingAction.title).toBe("Raise ticket");
    expect(rev.message).toContain("Title: Printer broken");
    expect(rev.message).toContain("Priority: High");
    expect(rev.message).toContain("Department: Finance");
    expect(rev.message).toContain("Problem Summary: The printer jams on every page.");
    expect(rev.message).toMatch(/Custom CC: Bob Employee \(u_empB@example.test\), Carol Worker/);
    expect(rev.data.ticketDraft.step).toBe("REVIEW");
    expect(create).not.toHaveBeenCalled();

    const done = await confirm(users.empA, rev);
    expect(done.status).toBe("EXECUTED");
    expect(done.message).toMatch(/raised successfully\. Ticket number: 2600099\./);
    expect(done.navigationTarget).toMatchObject({ label: "Open Ticket", path: "/tickets/id_2600099" });
    expect(create).toHaveBeenCalledTimes(1);
    const [actor, payload] = create.mock.calls[0];
    expect(actor.id).toBe(users.empA.id);
    expect(payload).toEqual({ title: "Printer broken", problemSummary: "The printer jams on every page.", priorityId: "p_high", toDepartmentId: "dept_finance", ccUserIds: ["u_empB", "u_empC"] });
  });

  test("two clicks on Raise Ticket at the same moment create exactly one ticket", async () => {
    const { cid } = await start();
    const rev = await review(users.empA, cid);
    const [a, b] = await Promise.allSettled([confirm(users.empA, rev), confirm(users.empA, rev)]);
    expect([a, b].filter((x) => x.status === "fulfilled" && x.value.status === "EXECUTED")).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("a form that is missing required fields is refused, and nothing is created", async () => {
    const { cid } = await start();
    await expect(review(users.empA, cid, { title: "  " })).rejects.toMatchObject({ code: "CHAT_ACTION_INVALID", message: "Please fill in: Title." });
    await expect(review(users.empA, cid, { title: "", priority: "", department: "", problemSummary: "" })).rejects.toMatchObject({ message: "Please fill in: Title, Priority, Department, Problem Summary." });
    expect(create).not.toHaveBeenCalled();
  });

  test("a problem summary over 50 words is refused, not truncated; the other fields are kept", async () => {
    const { cid } = await start();
    const long = Array.from({ length: 51 }, (_, i) => `w${i}`).join(" ");
    await expect(review(users.empA, cid, { problemSummary: long })).rejects.toMatchObject({ message: expect.stringMatching(/limited to 50 words/) });
    // The same session works once it is fixed, and the earlier valid values were saved.
    const rev = await review(users.empA, cid);
    expect(rev.pendingAction).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  test("a priority or department that does not exist is refused with the real list", async () => {
    const { cid } = await start();
    await expect(review(users.empA, cid, { priority: "Whenever" })).rejects.toMatchObject({ code: "CHAT_ACTION_INVALID" });
    await expect(review(users.empA, cid, { department: "Narnia" })).rejects.toMatchObject({ code: "CHAT_ACTION_INVALID" });
    expect(create).not.toHaveBeenCalled();
  });

  test("the form cannot set who raises the ticket, their role or the source department", async () => {
    const { cid } = await start();
    const rev = await service.submitDraftForm(users.empA, { conversationId: cid, ...form(), userId: "u_admin", role: "ADMIN", fromDepartmentId: "dept_finance", requesterId: "u_admin" });
    await confirm(users.empA, rev);
    const [actor, payload] = create.mock.calls[0];
    expect(actor.id).toBe(users.empA.id);
    expect(Object.keys(payload).sort()).toEqual(["ccUserIds", "priorityId", "problemSummary", "title", "toDepartmentId"]);
  });

  test("only the owner's open draft can be reviewed", async () => {
    const { cid } = await start();
    await expect(service.submitDraftForm(users.empB, { conversationId: cid, ...form() })).rejects.toBeTruthy();
    await expect(service.submitDraftForm(users.empA, { conversationId: "cnotadraftconversation00000", ...form() })).rejects.toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("Custom CC is part of the same session", () => {
  test("search finds valid people, never the requester, and needs an open ticket", async () => {
    const { cid } = await start();
    const r = await service.searchDraftCc(users.empA, { conversationId: cid, q: "employee" });
    expect(r.users.length).toBeGreaterThan(0);
    expect(r.users.map((u) => u.id)).not.toContain(users.empA.id);
    expect(r.users[0]).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String), email: expect.any(String) }));
    expect((await service.searchDraftCc(users.empA, { conversationId: cid, q: "x" })).users).toEqual([]); // too short
    await expect(service.searchDraftCc(users.empB, { conversationId: cid, q: "ali" })).rejects.toBeTruthy(); // another user's session
  });

  test("none, one or several people; the list is kept when the ticket is edited", async () => {
    const { cid } = await start();
    let rev = await review(users.empA, cid, { ccUserIds: [] });
    expect(rev.message).toContain("Custom CC: None");
    rev = await review(users.empA, cid, { ccUserIds: ["u_empB"] });
    expect(rev.data.ticketDraft.ccUsers.map((u) => u.id)).toEqual(["u_empB"]);
    rev = await review(users.empA, cid, { ccUserIds: ["u_empB", "u_empC", "u_empB"] }); // duplicates collapse
    expect(rev.data.ticketDraft.ccUsers.map((u) => u.id)).toEqual(["u_empB", "u_empC"]);
    const edit = await ask(users.empA, "I want to edit the ticket", cid);
    expect(edit.data.ticketDraft.ccUsers.map((u) => u.id)).toEqual(["u_empB", "u_empC"]);
  });

  test("an unknown, inactive or self-chosen person, or too many, is refused", async () => {
    const { cid } = await start();
    await expect(review(users.empA, cid, { ccUserIds: ["u_nobody"] })).rejects.toMatchObject({ message: expect.stringMatching(/not valid active users/) });
    await expect(review(users.empA, cid, { ccUserIds: ["u_dormant"] })).rejects.toMatchObject({ message: expect.stringMatching(/not valid active users/) });
    await expect(review(users.empA, cid, { ccUserIds: [users.empA.id] })).rejects.toMatchObject({ message: expect.stringMatching(/don't need to CC yourself/) });
    await expect(review(users.empA, cid, { ccUserIds: Array.from({ length: 21 }, (_, i) => `u${i}`) })).rejects.toMatchObject({ message: expect.stringMatching(/at most 20/) });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("no attachments in the chat: the Create Ticket page is the place for files", () => {
  test.each([
    ["EMPLOYEE", "empA", "/portal/new-ticket"],
    ["TEAMLEAD", "tlD1", "/agent/new-ticket"],
    ["MANAGER", "mgrD2", "/agent/new-ticket"],
  ])("%s: the first message and the form say so and link to their own Create Ticket page", async (_role, who, path) => {
    const { r, draft } = await start(users[who]);
    expect(r.message).toContain("You can raise a ticket here without attachments. To attach files, use the Create Ticket page instead.");
    expect(r.navigationTarget).toEqual({ type: "route", path, label: "Open Create Ticket page" });
    expect(draft.filesNote).toMatch(/without attachments/);
    expect(draft.createPage).toEqual({ type: "route", path, label: "Open Create Ticket page" });
    expect(draft.attachments).toBeUndefined();
    expect(draft.limits).toBeUndefined();
  });

  test.each(["Can I attach a screenshot?", "attach a file", "upload an image", "add attachments"])("'%s' while the form is open points to the Create Ticket page and keeps the ticket", async (q) => {
    const { cid } = await start();
    const r = await ask(users.empA, q, cid);
    expect(r.message).toMatch(/^Files can't be attached in the chat\./);
    expect(r.navigationTarget).toMatchObject({ path: "/portal/new-ticket" });
    // Not taken as the title, and nothing else changed.
    expect(r.data.ticketDraft).toMatchObject({ title: null, priority: null, department: null, summary: null });
  });

  test("asking about files at the review keeps the review usable", async () => {
    const { cid } = await start();
    const rev = await review(users.empA, cid);
    const r = await ask(users.empA, "I need to add a screenshot", cid);
    expect(r.message).toMatch(/Files can't be attached in the chat/);
    const done = await confirm(users.empA, rev);
    expect(done.status).toBe("EXECUTED");
  });

  test("a title that mentions files is still a title", async () => {
    const { cid } = await start();
    const r = await ask(users.empA, "Unable to upload documents", cid);
    expect(r.data.ticketDraft.title).toBe("Unable to upload documents");
  });

  test("the ticket is created with no files, and the review has no attachments line", async () => {
    const { cid } = await start();
    const rev = await review(users.empA, cid);
    expect(rev.message).not.toMatch(/Attachments/);
    expect(rev.pendingAction.summary).not.toMatch(/attachment/);
    await confirm(users.empA, rev);
    expect(create.mock.calls[0][2]).toEqual([]);
  });

  test("the chat has no way to store files any more", () => {
    expect(service.addDraftFiles).toBeUndefined();
    expect(service.removeDraftFile).toBeUndefined();
    expect(service.getDraftFile).toBeUndefined();
  });
});

describe("Edit and Cancel", () => {
  test("Edit returns to the form with everything entered; the old review can no longer be used", async () => {
    const { cid } = await start();
    const rev = await review(users.empA, cid, { ccUserIds: ["u_empB"] });
    const edit = await ask(users.empA, "I want to edit the ticket", cid);
    expect(edit.data.ticketDraft).toMatchObject({ title: "Printer broken", priority: "High", department: "Finance", summary: "The printer jams on every page." });
    expect(edit.data.ticketDraft.options).toBeTruthy();
    expect(edit.data.ticketDraft.ccUsers).toHaveLength(1);
    expect(edit.data.pendingAction).toBeFalsy();
    await expect(confirm(users.empA, rev)).resolves.toMatchObject({ status: expect.not.stringMatching(/EXECUTED/) });
    expect(create).not.toHaveBeenCalled();
    // Changing one field keeps the rest.
    const again = await review(users.empA, cid, { priority: "Critical", ccUserIds: ["u_empB"] });
    expect(again.message).toContain("Priority: Critical");
    expect(again.message).toContain("Title: Printer broken");
  });

  test("Cancel creates nothing", async () => {
    const { cid } = await start();
    await review(users.empA, cid);
    const r = await ask(users.empA, "cancel", cid);
    expect(r.message).toMatch(/cancelled the ticket/);
    expect(create).not.toHaveBeenCalled();
    // A new ticket starts clean, never from the old values.
    const next = await ask(users.empA, "Raise a ticket", cid);
    expect(next.data.ticketDraft).toMatchObject({ title: null, priority: null, department: null, summary: null, ccUsers: [] });
  });
});

describe("failures are never shown as success", () => {
  test("a refused creation keeps the review, shows the real error, and a retry creates one ticket", async () => {
    const ApiError = require("../../utils/ApiError");
    create.mockRejectedValueOnce(new ApiError(400, "Invalid department"));
    const { cid } = await start();
    const rev = await review(users.empA, cid);
    const fail = await confirm(users.empA, rev);
    expect(fail.message).toBe("No ticket was created. Invalid department");
    expect(fail.message).not.toMatch(/successfully/);
    const rev2 = await review(users.empA, cid);
    const ok = await confirm(users.empA, rev2);
    expect(ok.message).toMatch(/Ticket number: 2600099/);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
