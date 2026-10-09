jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// The ticket form's HTTP endpoints, through the real router, validators, multer and controller
// (only authentication is a stand-in: a header picks the fixture user, as the real middleware attaches req.user).
jest.mock("../../middleware/auth", () => {
  const ApiError = require("../../utils/ApiError");
  const { users } = require("../testkit/fixtures");
  return async (req, _res, next) => {
    const u = users[req.headers["x-test-user"]];
    if (!u) throw new ApiError(401, "Authentication required");
    req.user = u;
    next();
  };
});

process.env.CHATBOT_RATE_LIMIT_MAX = "1000"; // set before the router (and its limiter) is loaded
require("express-async-errors");
const express = require("express");
const request = require("supertest");
const { seedDefault } = require("../testkit/fixtures");
const prisma = require("../../config/prisma");
const ticketService = require("../../services/ticket.service");
const routes = require("../chatbot.routes");

const app = express();
app.use(express.json());
app.use("/api/v1/chatbot", routes);
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: "Internal server error" }));

const as = (who) => ({ "x-test-user": who });
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const body = (over = {}) => ({ title: "Printer broken", priority: "High", department: "Finance", problemSummary: "It jams.", ccUserIds: [], ...over });

beforeEach(() => {
  seedDefault();
  prisma.__db.priorities.push({ id: "p_med", name: "Medium", level: 2, color: "#aaa" });
  prisma.__db.users.forEach((u) => {
    u.departmentAccess = [];
  });
});

async function open(who = "empA") {
  const res = await request(app).post("/api/v1/chatbot/messages").set(as(who)).send({ message: "Raise a ticket" });
  return { cid: res.body.data.conversationId, draft: res.body.data.data.ticketDraft };
}

describe("authentication and validation", () => {
  test("the form endpoints require authentication", async () => {
    for (const c of [
      request(app).post("/api/v1/chatbot/drafts/review").send(body()),
      request(app).get("/api/v1/chatbot/drafts/cc-search?q=al"),
      request(app).get("/api/v1/chatbot/drafts/attachments/x"),
    ]) {
      const res = await c;
      expect(res.status).toBe(401);
    }
  });

  test("review: a malformed request is refused before anything runs", async () => {
    const { cid } = await open();
    const bad = await request(app).post("/api/v1/chatbot/drafts/review").set(as("empA")).send({ ...body(), conversationId: cid, ccUserIds: "u_empB" });
    expect(bad.status).toBe(400);
    const noConversation = await request(app).post("/api/v1/chatbot/drafts/review").set(as("empA")).send(body());
    expect(noConversation.status).toBe(400);
  });
});

describe("the whole session over HTTP", () => {
  test("form -> files in place -> CC search -> Review Ticket -> Raise Ticket creates one ticket", async () => {
    // The ticket service saves each file on the ticket it creates; this stand-in records that, so the answer can be checked.
    const create = jest.spyOn(ticketService, "createTicket").mockImplementation(async (_user, _payload, files) => {
      files.forEach((f) => prisma.__db.ticketAttachments.push({ ticketId: "id_2600099", fileName: f.originalname }));
      return { id: "id_2600099", ticketNumber: "2600099", status: "OPEN" };
    });
    const { cid, draft } = await open();
    expect(draft.options.departments).toContain("Finance");

    // A file added through the form: the answer is just the updated draft, not a chat message.
    const up = await request(app).post("/api/v1/chatbot/drafts/attachments").set(as("empA")).field("conversationId", cid).field("quiet", "1").attach("files", png, { filename: "shot.png", contentType: "image/png" });
    expect(up.status).toBe(200);
    expect(up.body.data.quiet).toBe(true);
    const att = up.body.data.data.ticketDraft.attachments[0];
    expect(att).toMatchObject({ name: "shot.png", mimeType: "image/png" });

    // Open it: only the owner, shown inline with safe headers.
    const open1 = await request(app).get(`/api/v1/chatbot/drafts/attachments/${att.id}`).query({ conversationId: cid }).set(as("empA"));
    expect(open1.status).toBe(200);
    expect(open1.headers["content-type"]).toMatch(/image\/png/);
    expect(open1.headers["content-disposition"]).toMatch(/^inline/);
    expect(open1.headers["x-content-type-options"]).toBe("nosniff");
    const stranger = await request(app).get(`/api/v1/chatbot/drafts/attachments/${att.id}`).query({ conversationId: cid }).set(as("empB"));
    expect(stranger.status).toBeGreaterThanOrEqual(400);

    // CC people.
    const found = await request(app).get("/api/v1/chatbot/drafts/cc-search").query({ conversationId: cid, q: "Bob" }).set(as("empA"));
    expect(found.status).toBe(200);
    expect(found.body.data.users.map((u) => u.id)).toEqual(["u_empB"]);

    // Review Ticket: nothing is created yet.
    const rev = await request(app).post("/api/v1/chatbot/drafts/review").set(as("empA")).send({ ...body({ ccUserIds: ["u_empB"] }), conversationId: cid });
    expect(rev.status).toBe(200);
    expect(rev.body.data.data.pendingAction.title).toBe("Raise ticket");
    expect(rev.body.data.message).toContain("shot.png");
    expect(create).not.toHaveBeenCalled();

    // The one final action.
    const { id, confirmationToken } = rev.body.data.data.pendingAction;
    const done = await request(app).post(`/api/v1/chatbot/actions/${id}/confirm`).set(as("empA")).send({ confirmationToken, conversationId: cid });
    expect(done.status).toBe(200);
    expect(done.body.data.message).toMatch(/Ticket number: 2600099/);
    expect(create).toHaveBeenCalledTimes(1);
    const [, payload, files] = create.mock.calls[0];
    expect(payload.ccUserIds).toEqual(["u_empB"]);
    expect(files.map((f) => f.originalname)).toEqual(["shot.png"]);
    expect(prisma.__db.ticketAttachments.map((x) => x.fileName)).toEqual(["shot.png"]); // associated with the created ticket
    expect(done.body.data.message).not.toMatch(/could be saved/);
  });

  test("a refused form answers 4xx with a clear message, and the form can be corrected and sent again", async () => {
    const { cid } = await open();
    const bad = await request(app).post("/api/v1/chatbot/drafts/review").set(as("empA")).send({ ...body({ title: "" }), conversationId: cid });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toBe("Please fill in: Title.");
    const ok = await request(app).post("/api/v1/chatbot/drafts/review").set(as("empA")).send({ ...body(), conversationId: cid });
    expect(ok.status).toBe(200);
  });

  test("an Admin cannot start a ticket, so there is no form to review", async () => {
    const res = await request(app).post("/api/v1/chatbot/messages").set(as("admin")).send({ message: "Raise a ticket" });
    expect(res.body.data.data.ticketDraft).toBeUndefined();
    const { cid } = { cid: res.body.data.conversationId };
    const bad = await request(app).post("/api/v1/chatbot/drafts/review").set(as("admin")).send({ ...body(), conversationId: cid });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});
