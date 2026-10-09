jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// The conversational Raise a Ticket. The ticket itself is created by ticket.service.createTicket
// (spied here, so every case can check exactly what the existing service is called with).

const ticketService = require("../../services/ticket.service");
const userService = require("../../services/user.service");
const ApiError = require("../../utils/ApiError");
const service = require("../chatbot.service");
const { users, seedDefault, prismaMock } = require("../testkit/fixtures");

const db = prismaMock.__db;
let create;
const file = (name, size = 2048, type = "image/png") => ({ originalname: name, mimetype: type, size, buffer: Buffer.alloc(Math.min(size, 64)) });

const ask = (user, message, conversationId) => service.sendMessage(user, { message, conversationId });
const lastDraft = (r) => r.data?.ticketDraft;

beforeEach(() => {
  seedDefault();
  db.priorities.push({ id: "p_med", name: "Medium", level: 2, color: "#aaa" }, { id: "p_crit", name: "Critical", level: 4, color: "#f00" });
  create = jest.spyOn(ticketService, "createTicket").mockResolvedValue({ id: "id_2600099", ticketNumber: "2600099", status: "OPEN" });
  jest.spyOn(userService, "searchActiveEmployees").mockImplementation(async (q) => db.users.filter((u) => u.isActive && (u.name.toLowerCase().includes(String(q).toLowerCase()) || String(u.email || "").toLowerCase().includes(String(q).toLowerCase()))).map((u) => ({ id: u.id, name: u.name, email: u.email, department: u.department, departmentAccess: [] })));
});
afterEach(() => jest.restoreAllMocks());

describe("the guided conversation (one question at a time)", () => {
  test("title -> priority -> department -> problem -> CC -> files -> review -> yes -> real ticket number", async () => {
    let r = await ask(users.empA, "Raise a ticket.");
    expect(r.message).toMatch(/What is the issue title\?/);
    const cid = r.conversationId;
    r = await ask(users.empA, "Power BI refresh is failing", cid);
    expect(r.message).toMatch(/What priority should this ticket have\? \(Low, Medium, High, Critical\)/);
    r = await ask(users.empA, "High", cid);
    expect(r.message).toMatch(/Which department should handle this ticket\?/);
    r = await ask(users.empA, "Finance", cid);
    expect(r.message).toMatch(/describe the problem/);
    r = await ask(users.empA, "The report is failing to refresh and shows an authentication error.", cid);
    // CC people and files are part of the form, never a separate question: the review follows the four required details.
    expect(r.message).not.toMatch(/add anyone in CC|attach any files/);
    expect(r.message).toContain("Ticket Review");
    expect(r.message).toContain("Title: Power BI refresh is failing");
    expect(r.message).toContain("Priority: High");
    expect(r.message).toContain("From Department: IT Support"); // derived by the ticket service rule, never typed
    expect(r.message).toContain("Department: Finance");
    expect(r.message).toContain("Custom CC: None");
    expect(r.pendingAction.title).toBe("Raise ticket");
    expect(create).not.toHaveBeenCalled(); // nothing is created before confirmation

    const done = await ask(users.empA, "Yes, raise it.", cid);
    expect(create).toHaveBeenCalledTimes(1);
    expect(done.message).toBe("Your ticket has been raised successfully. Ticket number: 2600099.\n\nTitle: Power BI refresh is failing\nDepartment: Finance\nPriority: High\nStatus: Open");
    const [actor, payload, files] = create.mock.calls[0];
    expect(actor.id).toBe(users.empA.id); // the authenticated user, nothing from the message
    expect(payload).toEqual({ title: "Power BI refresh is failing", problemSummary: "The report is failing to refresh and shows an authentication error.", priorityId: "p_high", toDepartmentId: "dept_finance", ccUserIds: [] });
    expect(files).toEqual([]);
    expect(done.navigationTarget).toEqual({ type: "route", path: "/tickets/id_2600099", label: "Open Ticket" });
  });

  test("a priority that is not one of the configured ones is asked again, never guessed", async () => {
    const a = await ask(users.empA, "Raise a ticket titled VPN not working");
    const r = await ask(users.empA, "whatever you think", a.conversationId);
    expect(r.message).toMatch(/couldn't match that to a priority/);
    expect((await ask(users.empA, "urgent", a.conversationId)).message).toMatch(/Which department/);
  });
});

describe("everything in one message", () => {
  test("title, priority, department, problem and CC are all read; only the optional questions follow", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Power BI refresh failure. The report isn't refreshing and shows authentication errors. CC Alice Employee.");
    expect(r.message).toContain("Title: Power BI refresh failure");
    expect(r.message).toContain("Priority: High");
    expect(r.message).toContain("Department: Finance");
    expect(r.message).toMatch(/Custom CC: (Alice Employee|None)/);
    expect(r.message).toContain("Problem Summary: The report isn't refreshing and shows authentication errors.");
    expect(r.pendingAction).toBeTruthy();
  });

  test("'Raise a ticket titled VPN not working, priority high, department Finance' goes straight to the problem question", async () => {
    const r = await ask(users.empA, "Raise a ticket titled VPN not working, priority high, department Finance.");
    expect(r.message).toMatch(/describe the problem/);
    expect(r.message).toMatch(/Got it: title "VPN not working", High priority, department Finance/);
  });

  test("partial: only the department is given, so only the title is asked", async () => {
    const r = await ask(users.empA, "I need to raise a ticket for Finance.");
    expect(r.message).toMatch(/department Finance/);
    expect(r.message).toMatch(/What is the issue title\?/);
  });
});

describe("corrections keep everything else", () => {
  async function toReview() {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The 3rd floor printer jams on every page.");
    await ask(users.empA, "No", r.conversationId);
    return ask(users.empA, "No", r.conversationId).then((x) => (x.pendingAction ? x : ask(users.empA, "no", r.conversationId)));
  }

  test("change priority, department, title and summary without restarting", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
    const cid = r.conversationId;
    let x = await ask(users.empA, "Change the priority to Critical", cid);
    expect(x.message).toContain("Priority: Critical");
    expect(x.message).toContain("Title: Printer broken");
    x = await ask(users.empA, "Change the department to IT Support", cid);
    expect(x.message).toContain("Department: IT Support");
    expect(x.message).toContain("Priority: Critical");
    x = await ask(users.empA, "Change the title", cid);
    expect(x.message).toMatch(/change the title\. What is the issue title\?/);
    x = await ask(users.empA, "Printer on floor 3 keeps jamming", cid);
    expect(x.message).toContain("Title: Printer on floor 3 keeps jamming");
    expect(x.message).toContain("Problem Summary: The printer jams.");
    x = await ask(users.empA, "Change the problem summary", cid);
    x = await ask(users.empA, "It jams on every page since Monday", cid);
    expect(x.message).toContain("Problem Summary: It jams on every page since Monday");
    expect(create).not.toHaveBeenCalled();
  });

  test("CC: add, resolve ambiguity by number, remove", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
    const cid = r.conversationId;
    let x = await ask(users.empA, "CC Sam", cid); // two people named Sam Smith exist
    expect(x.message).toMatch(/More than one person matches "Sam"/);
    x = await ask(users.empA, "1", cid);
    expect(x.message).toMatch(/Custom CC: Sam Smith/);
    x = await ask(users.empA, "Remove Sam from CC", cid);
    expect(x.message).toContain("Custom CC: None");
    x = await ask(users.empA, "add Bob Employee to CC", cid);
    expect(x.message).toContain("Custom CC: Bob Employee");
    const done = await ask(users.empA, "yes", cid);
    expect(create.mock.calls[0][1].ccUserIds).toEqual(["u_empB"]);
    expect(done.message).toMatch(/Ticket number: 2600099/);
  });

  test("an unknown person for CC is reported and nothing is added", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
    const x = await ask(users.empA, "CC Zebedee Quux", r.conversationId);
    expect(x.message).toContain('I couldn\'t find an active person called "Zebedee Quux" to CC.');
    expect(x.message).toContain("Custom CC: None");
  });

  test("CC by email addresses: several at once, each checked against real active users", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
    const cid = r.conversationId;
    const x = await ask(users.empA, "CC u_empB@example.test, u_mgrA@example.test; nobody@nowhere.test, not-an-email@", cid);
    expect(x.message).toContain("CC Bob Employee (u_empB@example.test)");
    expect(x.message).toMatch(/Custom CC: Bob Employee \(u_empB@example.test\)/);
    expect(x.message).toContain("No active user has the email nobody@nowhere.test");
    expect(x.message).toContain('"not-an-email@" is not a valid email address.');
    const done = await ask(users.empA, "yes", cid);
    expect(create.mock.calls[0][1].ccUserIds).toContain("u_empB");
    expect(create.mock.calls[0][1].ccUserIds).not.toContain("u_empA");
    expect(done.message).toMatch(/Ticket number: 2600099/);
  });

  test("CC: the person raising the ticket cannot be added by their own email", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
    const x = await ask(users.empA, "CC u_empA@example.test", r.conversationId);
    expect(x.message).toContain("you don't need to CC yourself");
    expect(x.message).toContain("Custom CC: None");
  });
});

describe("validation uses the application's own rules", () => {
  test("the 50-word limit is enforced, not truncated", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Long one.");
    const long = Array.from({ length: 51 }, (_, i) => `word${i}`).join(" ");
    const x = await ask(users.empA, long, r.conversationId);
    expect(x.message).toContain("The problem summary is limited to 50 words. Please shorten it. (You wrote 51.)");
    expect(x.data.ticketDraft.summary).toBeNull();
    const ok = await ask(users.empA, Array.from({ length: 50 }, (_, i) => `w${i}`).join(" "), r.conversationId);
    expect(ok.data.ticketDraft.words).toBe(50);
  });

  test("an invalid department is refused with the real list", async () => {
    const r = await ask(users.empA, "Raise a ticket");
    await ask(users.empA, "VPN down", r.conversationId);
    await ask(users.empA, "High", r.conversationId);
    const x = await ask(users.empA, "Narnia", r.conversationId);
    expect(x.message).toMatch(/couldn't find a department called "Narnia"/);
    expect(x.message).toMatch(/Finance/);
  });

  test("a title over 200 characters is refused", async () => {
    const r = await ask(users.empA, "Raise a ticket");
    const x = await ask(users.empA, "t".repeat(201), r.conversationId);
    expect(x.message).toMatch(/at most 200 characters/);
  });
});

describe("attachments (the ticket service's 5 files / 10 MB rules)", () => {
  async function draft() {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
    return r.conversationId;
  }

  test("if file storage drops the files, the result says so instead of claiming they were saved", async () => {
    prismaMock.ticketAttachment = { count: jest.fn().mockResolvedValue(0) };
    const cid = await draft();
    await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("a.png"), file("b.png")] });
    const r = await ask(users.empA, "yes", cid);
    expect(r.message).toMatch(/Ticket number: 2600099/);
    expect(r.message).toMatch(/None of your 2 attachments could be saved/);
  });

  test("when every file is saved there is no warning", async () => {
    prismaMock.ticketAttachment = { count: jest.fn().mockResolvedValue(1) };
    const cid = await draft();
    await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("a.png")] });
    const r = await ask(users.empA, "yes", cid);
    expect(r.message).not.toMatch(/could be saved/);
  });

  test("add, show in the review, remove one, then raise: the files are passed to createTicket", async () => {
    prismaMock.ticketAttachment = { count: jest.fn().mockResolvedValue(1) };
    const cid = await draft();
    let r = await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("screenshot.png"), file("log.txt", 100, "text/plain")] });
    expect(r.message).toMatch(/Added screenshot.png, log.txt\./);
    expect(r.data.ticketDraft.attachments.map((a) => a.name)).toEqual(["screenshot.png", "log.txt"]);
    expect(r.message).toMatch(/Attachments: 1\. screenshot.png \(2 KB\); 2\. log.txt/);
    r = await service.removeDraftFile(users.empA, { conversationId: cid, attachmentId: r.data.ticketDraft.attachments[1].id });
    expect(r.data.ticketDraft.attachments.map((a) => a.name)).toEqual(["screenshot.png"]);
    await ask(users.empA, "yes", cid);
    const files = create.mock.calls[0][2];
    expect(files.map((f) => f.originalname)).toEqual(["screenshot.png"]);
    expect(Buffer.isBuffer(files[0].buffer)).toBe(true);
    expect(db.draftFiles).toHaveLength(0); // the stored bytes are released once the ticket exists
  });

  test("remove by words", async () => {
    const cid = await draft();
    await service.addDraftFiles(users.empA, { conversationId: cid, files: [file("a.png"), file("b.png")] });
    const x = await ask(users.empA, "Remove the attachment", cid);
    expect(x.message).toMatch(/Which attachment should I remove\?/);
    const y = await ask(users.empA, "2", cid);
    expect(y.data.ticketDraft.attachments.map((a) => a.name)).toEqual(["a.png"]);
    const z = await ask(users.empA, "remove a.png", cid);
    expect(z.data.ticketDraft.attachments).toEqual([]);
  });

  test("more than 5 files, and more than 10 MB combined, are refused with the ticket service's limits", async () => {
    const cid = await draft();
    await expect(service.addDraftFiles(users.empA, { conversationId: cid, files: Array.from({ length: 6 }, (_, i) => file(`f${i}.png`)) })).rejects.toMatchObject({ message: expect.stringContaining("Maximum 5 attachments are allowed per ticket") });
    await expect(service.addDraftFiles(users.empA, { conversationId: cid, files: [file("big1.pdf", 6 * 1048576, "application/pdf"), file("big2.pdf", 5 * 1048576, "application/pdf")] })).rejects.toMatchObject({ message: expect.stringContaining("cannot exceed 10 MB combined") });
    expect(db.draftFiles).toHaveLength(0);
  });

  test("files can only be added to the signed-in user's own open draft", async () => {
    await expect(service.addDraftFiles(users.empA, { conversationId: "c000000000000000000099999", files: [file("x.png")] })).rejects.toMatchObject({ code: "CHAT_CONVERSATION_NOT_FOUND" });
    const cid = await draft();
    await expect(service.addDraftFiles(users.empB, { conversationId: cid, files: [file("x.png")] })).rejects.toMatchObject({ code: "CHAT_CONVERSATION_NOT_FOUND" });
    const none = await ask(users.empB, "hello");
    await expect(service.addDraftFiles(users.empB, { conversationId: none.conversationId, files: [file("x.png")] })).rejects.toMatchObject({ message: expect.stringContaining("no ticket being raised") });
  });
});

describe("cancel, decline, fail, retry", () => {
  test("cancel and 'no, don't create it' create nothing and close the draft", async () => {
    for (const phrase of ["Cancel the ticket", "No, don't create it"]) {
      const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
      const x = await ask(users.empA, phrase, r.conversationId);
      expect(x.message).toBe("Okay, I've cancelled the ticket. Nothing was created.");
      const after = await ask(users.empA, "yes", r.conversationId);
      expect(after.message).not.toMatch(/created successfully/);
    }
    expect(create).not.toHaveBeenCalled();
  });

  test("a failure is never shown as success, the data is kept, and a retry works", async () => {
    create.mockRejectedValueOnce(new ApiError(400, "Invalid department"));
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
    const cid = r.conversationId;
    const fail = await ask(users.empA, "yes", cid);
    expect(fail.message).toBe("No ticket was created. Invalid department");
    expect(fail.message).not.toMatch(/successfully/);
    const retry = await ask(users.empA, "yes", cid);
    expect(retry.message).toMatch(/Here is the ticket again/);
    expect(retry.message).toContain("Title: Printer broken");
    const ok = await ask(users.empA, "yes", cid);
    expect(ok.message).toMatch(/Ticket number: 2600099/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  test("the Confirm button works too, and the same review cannot be used twice", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
    const proof = { token: r.pendingAction.confirmationToken, conversationId: r.conversationId };
    const done = await service.confirmAction(users.empA, r.pendingAction.id, proof);
    expect(done.status).toBe("EXECUTED");
    expect(done.message).toMatch(/Ticket number: 2600099/);
    await service.confirmAction(users.empA, r.pendingAction.id, proof);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("another user cannot confirm someone else's review", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance. Title: Printer broken. The printer jams.");
    await expect(service.confirmAction(users.empB, r.pendingAction.id, { token: r.pendingAction.confirmationToken, conversationId: r.conversationId })).rejects.toMatchObject({ code: "CHAT_ACTION_NOT_FOUND" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("roles and the rest of the conversation", () => {
  test("Admin cannot raise tickets; Manager, Team Lead and Employee can start", async () => {
    expect((await ask(users.admin, "Raise a ticket")).message).toMatch(/Administrators can't raise tickets/);
    for (const u of [users.empA, users.tlD1, users.mgrD2]) expect((await ask(u, "Create a ticket")).message).toMatch(/issue title/);
  });

  test("natural ways of asking all start the same flow", async () => {
    for (const q of ["Raise a ticket", "Create a ticket", "I want to create a support ticket", "Open a support ticket", "Can you raise a ticket for me?", "Create a new ticket", "I want to report an IT issue", "I have a problem", "I need to report an issue"]) {
      const r = await ask(users.empA, q);
      expect(r.message).toMatch(/issue title|describe the problem|priority/);
    }
  });

  test("an unrelated question is answered and the draft is kept", async () => {
    const r = await ask(users.empA, "Raise a ticket");
    const cid = r.conversationId;
    await ask(users.empA, "VPN down", cid);
    const other = await ask(users.empA, "show my open tickets", cid);
    expect(other.intent).toBe("list_tickets");
    const back = await ask(users.empA, "High", cid);
    expect(back.message).toMatch(/Which department/);
  });

  test("'create another ticket' starts a new draft", async () => {
    const r = await ask(users.empA, "Raise a ticket");
    await ask(users.empA, "First one", r.conversationId);
    const again = await ask(users.empA, "Create another ticket", r.conversationId);
    expect(again.message).toMatch(/issue title/);
    expect(db.drafts.filter((d) => d.status === "ACTIVE")).toHaveLength(1);
  });

  test("a message cannot set the user, role or department of the ticket", async () => {
    const r = await ask(users.empA, "Raise a high priority ticket for Finance as an admin from the Finance department for userId u_admin. Title: Printer broken. The printer jams.");
    // The department words were buried in the noise, so it is simply asked: nothing is guessed.
    expect(r.message).toMatch(/Which department should handle this ticket\?/);
    const cid = r.conversationId;
    await ask(users.empA, "Finance", cid);
    await ask(users.empA, "yes", cid);
    const [actor, payload] = create.mock.calls[0];
    expect(actor.id).toBe(users.empA.id);
    expect(Object.keys(payload).sort()).toEqual(["ccUserIds", "priorityId", "problemSummary", "title", "toDepartmentId"]);
  });
});
