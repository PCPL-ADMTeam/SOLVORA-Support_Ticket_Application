jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// The single ticket session: ONE form (title, priority, department, problem summary, CC people, files),
// ONE review, ONE final "Raise Ticket". The ticket itself is created by ticket.service.createTicket
// (spied here, so each case can check exactly what the existing service receives).

const ticketService = require("../../services/ticket.service");
const userService = require("../../services/user.service");
const service = require("../chatbot.service");
const { users, seedDefault, prismaMock } = require("../testkit/fixtures");

const db = prismaMock.__db;
let create;
const file = (name, size = 2048, type = "image/png") => ({ originalname: name, mimetype: type, size, buffer: Buffer.alloc(Math.min(size, 64), 7) });
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

describe("attachments inside the form", () => {
  test("adding and removing files updates the form in place, without chat messages", async () => {
    const { cid } = await start();
    const before = db.messages.length;
    const added = await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("a.png"), file("b.txt", 100, "text/plain")], quiet: true });
    expect(added.quiet).toBe(true);
    expect(added.data.ticketDraft.attachments.map((a) => a.name)).toEqual(["a.png", "b.txt"]);
    const removed = await service.removeDraftFile(users.empA, { conversationId: cid, attachmentId: added.data.ticketDraft.attachments[1].id, quiet: true });
    expect(removed.data.ticketDraft.attachments.map((a) => a.name)).toEqual(["a.png"]);
    expect(db.messages.length).toBe(before); // nothing was added to the conversation
  });

  test("a sixth file, or more than 10 MB in total, is refused and the others stay", async () => {
    const { cid } = await start();
    await service.addDraftFiles(users.empA, { conversationId: cid, files: [1, 2, 3, 4, 5].map((i) => file(`f${i}.png`)), quiet: true });
    await expect(service.addDraftFiles(users.empA, { conversationId: cid, files: [file("six.png")], quiet: true })).rejects.toMatchObject({ message: expect.stringMatching(/Maximum 5 attachments/) });
    expect(db.draftFiles).toHaveLength(5);
    // A new session for the size rule.
    const second = await start(users.empB);
    await expect(service.addDraftFiles(users.empB, { conversationId: second.cid, files: [file("big.png", 6 * 1048576), file("big2.png", 6 * 1048576)], quiet: true })).rejects.toMatchObject({ message: expect.stringMatching(/cannot exceed 10 MB/) });
  });

  test("the files go to the ticket service exactly as chosen, and the review lists them", async () => {
    const { cid } = await start();
    const added = await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("shot.png", 3000), file("log.txt", 100, "text/plain")], quiet: true });
    const rev = await review(users.empA, cid);
    expect(rev.message).toMatch(/Attachments: 1\. shot\.png \(3 KB\); 2\. log\.txt/);
    expect(rev.data.ticketDraft.attachments).toHaveLength(2);
    expect(added.data.ticketDraft.attachments).toHaveLength(2);
    await confirm(users.empA, rev);
    const files = create.mock.calls[0][2];
    expect(files.map((f) => f.originalname)).toEqual(["shot.png", "log.txt"]);
    expect(db.draftFiles).toHaveLength(0); // the stored bytes are released once the ticket exists
  });

  test("removing a file at the review gives a fresh review that matches", async () => {
    const { cid } = await start();
    const added = await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("a.png"), file("b.png")], quiet: true });
    const rev = await review(users.empA, cid);
    expect(rev.data.ticketDraft.attachments).toHaveLength(2);
    const after = await service.removeDraftFile(users.empA, { conversationId: cid, attachmentId: added.data.ticketDraft.attachments[0].id, quiet: true });
    expect(after.quiet).toBeUndefined(); // at the review it is a normal reply with a new review
    expect(after.pendingAction).toBeTruthy();
    expect(after.data.ticketDraft.attachments.map((a) => a.name)).toEqual(["b.png"]);
    expect(after.message).toMatch(/Attachments: 1\. b\.png/);
  });

  test("a file can be opened only by the owner of that open ticket", async () => {
    const { cid } = await start();
    const added = await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("shot.png")], quiet: true });
    const id = added.data.ticketDraft.attachments[0].id;
    const got = await service.getDraftFile(users.empA, { conversationId: cid, attachmentId: id });
    expect(got).toMatchObject({ fileName: "shot.png", mimeType: "image/png" });
    expect(Buffer.isBuffer(got.buffer)).toBe(true);
    await expect(service.getDraftFile(users.empB, { conversationId: cid, attachmentId: id })).rejects.toBeTruthy();
    await expect(service.getDraftFile(users.empA, { conversationId: cid, attachmentId: "nope" })).rejects.toBeTruthy();
  });
});

describe("Edit and Cancel", () => {
  test("Edit returns to the form with everything entered; the old review can no longer be used", async () => {
    const { cid } = await start();
    await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("a.png")], quiet: true });
    const rev = await review(users.empA, cid, { ccUserIds: ["u_empB"] });
    const edit = await ask(users.empA, "I want to edit the ticket", cid);
    expect(edit.data.ticketDraft).toMatchObject({ title: "Printer broken", priority: "High", department: "Finance", summary: "The printer jams on every page." });
    expect(edit.data.ticketDraft.options).toBeTruthy();
    expect(edit.data.ticketDraft.attachments).toHaveLength(1);
    expect(edit.data.ticketDraft.ccUsers).toHaveLength(1);
    expect(edit.data.pendingAction).toBeFalsy();
    await expect(confirm(users.empA, rev)).resolves.toMatchObject({ status: expect.not.stringMatching(/EXECUTED/) });
    expect(create).not.toHaveBeenCalled();
    // Changing one field keeps the rest.
    const again = await review(users.empA, cid, { priority: "Critical", ccUserIds: ["u_empB"] });
    expect(again.message).toContain("Priority: Critical");
    expect(again.message).toContain("Title: Printer broken");
  });

  test("Cancel creates nothing and releases the files", async () => {
    const { cid } = await start();
    await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("a.png")], quiet: true });
    await review(users.empA, cid);
    const r = await ask(users.empA, "cancel", cid);
    expect(r.message).toMatch(/cancelled the ticket/);
    expect(create).not.toHaveBeenCalled();
    expect(db.draftFiles).toHaveLength(0);
    // A new ticket starts clean, never from the old values.
    const next = await ask(users.empA, "Raise a ticket", cid);
    expect(next.data.ticketDraft).toMatchObject({ title: null, priority: null, department: null, summary: null, attachments: [] });
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
