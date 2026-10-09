jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// Conversation history management over HTTP: one page at a time, delete one, delete several, delete
// all. Whose conversations are touched always comes from the authenticated user, never the request.
// The real routes, validators, controller and service run against the in-memory data double.
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

const request = require("supertest");
const { seedDefault, users, prismaMock } = require("../testkit/fixtures");

process.env.CHATBOT_RATE_LIMIT_MAX = "1000";
require("express-async-errors");
const express = require("express");
const routes = require("../chatbot.routes");

const app = express();
app.use(express.json());
app.use("/api/v1/chatbot", routes);
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: "Internal server error" }));

const db = prismaMock.__db;
const as = (who) => ({ "x-test-user": who });
const say = async (who, message) => (await request(app).post("/api/v1/chatbot/messages").set(as(who)).send({ message })).body.data.conversationId;
const list = (who, query = {}) => request(app).get("/api/v1/chatbot/conversations").query(query).set(as(who));
const bulk = (who, body) => request(app).post("/api/v1/chatbot/conversations/bulk-delete").set(as(who)).send(body);
const all = (who, body) => request(app).post("/api/v1/chatbot/conversations/delete-all").set(as(who)).send(body);

beforeEach(seedDefault);

describe("listing one page at a time", () => {
  test("pages, totals, and a page past the end lands on the last page", async () => {
    for (const q of ["one", "two", "three", "four", "five"]) await say("empA", `hello ${q}`);
    await say("empB", "bob's chat");

    const first = await list("empA", { page: 1, pageSize: 2 });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ total: 5, page: 1, pageSize: 2, totalPages: 3 });
    expect(first.body.data.conversations).toHaveLength(2);

    const last = await list("empA", { page: 3, pageSize: 2 });
    expect(last.body.data.conversations).toHaveLength(1);
    const beyond = await list("empA", { page: 99, pageSize: 2 });
    expect(beyond.body.data.page).toBe(3);
    expect(beyond.body.data.conversations.map((c) => c.conversationId)).toEqual(last.body.data.conversations.map((c) => c.conversationId));

    const seen = new Set();
    for (const page of [1, 2, 3]) for (const c of (await list("empA", { page, pageSize: 2 })).body.data.conversations) seen.add(c.title);
    expect([...seen].sort()).toEqual(["hello five", "hello four", "hello one", "hello three", "hello two"]);
  });

  test("without paging parameters the list keeps its earlier default size", async () => {
    await say("empA", "hello");
    expect((await list("empA")).body.data).toMatchObject({ total: 1, page: 1, pageSize: 30 });
  });

  test("a conversation with no message from the user is neither listed nor counted", async () => {
    await say("empA", "hello");
    db.conversations.push({ id: "c999999999999999999999999", userId: users.empA.id, portalRole: "EMPLOYEE", status: "ACTIVE", createdAt: new Date(), lastMessageAt: new Date() });
    const res = await list("empA");
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.conversations.map((c) => c.conversationId)).not.toContain("c999999999999999999999999");
  });

  test.each([[{ page: 0 }], [{ page: "x" }], [{ pageSize: 51 }], [{ pageSize: 0 }]])("invalid paging %j -> 400", async (q) => {
    const res = await list("empA", q);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CHAT_INVALID_INPUT");
  });
});

describe("deleting several conversations", () => {
  test("deletes only the caller's own; someone else's ids are skipped without saying so", async () => {
    const a1 = await say("empA", "first");
    const a2 = await say("empA", "second");
    const a3 = await say("empA", "third");
    const b1 = await say("empB", "bob's");

    const res = await bulk("empA", { conversationIds: [a1, a2, b1] });
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(2);
    expect(res.body.data.deletedIds.sort()).toEqual([a1, a2].sort());
    expect(JSON.stringify(res.body)).not.toContain(b1);

    expect((await request(app).get(`/api/v1/chatbot/conversations/${a1}`).set(as("empA"))).status).toBe(404);
    expect((await list("empA")).body.data.conversations.map((c) => c.conversationId)).toEqual([a3]);
    // Bob's conversation is untouched and still his.
    expect((await request(app).get(`/api/v1/chatbot/conversations/${b1}`).set(as("empB"))).status).toBe(200);
    expect(db.audit.some((e) => e.userId === users.empA.id && e.action === "CONVERSATION_ACCESS_DENIED")).toBe(true);
  });

  test("another user deleting my conversations deletes nothing", async () => {
    const a1 = await say("empA", "mine");
    for (const who of ["empB", "admin"]) {
      const res = await bulk(who, { conversationIds: [a1] });
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(0);
    }
    expect((await request(app).get(`/api/v1/chatbot/conversations/${a1}`).set(as("empA"))).status).toBe(200);
  });

  test("a user id in the body is ignored", async () => {
    const b1 = await say("empB", "bob's");
    const res = await bulk("empA", { conversationIds: [b1], userId: users.empB.id });
    expect(res.body.data.deleted).toBe(0);
    expect((await request(app).get(`/api/v1/chatbot/conversations/${b1}`).set(as("empB"))).status).toBe(200);
  });

  test.each([
    [{}],
    [{ conversationIds: [] }],
    [{ conversationIds: "c000000000000000000000001" }],
    [{ conversationIds: ["../etc/passwd"] }],
    [{ conversationIds: Array.from({ length: 51 }, (_, i) => `c${String(i).padStart(24, "0")}`) }],
  ])("invalid body %j -> 400 and nothing is deleted", async (body) => {
    const a1 = await say("empA", "keep me");
    const res = await bulk("empA", body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CHAT_INVALID_INPUT");
    expect(db.conversations.map((c) => c.id)).toContain(a1);
  });
});

describe("deleting all conversations", () => {
  test("needs an explicit confirm: true", async () => {
    await say("empA", "keep me");
    for (const body of [{}, { confirm: "true" }, { confirm: 1 }, { confirm: false }]) {
      const res = await all("empA", body);
      expect(res.status).toBe(400);
    }
    expect((await list("empA")).body.data.total).toBe(1);
  });

  test("removes every conversation of the caller (whatever role it was opened under) and nobody else's", async () => {
    await say("empA", "one");
    const old = await say("empA", "two");
    const b1 = await say("empB", "bob's");
    db.conversations.find((c) => c.id === old).portalRole = "ADMIN"; // opened before a role change

    const res = await all("empA", { confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(2);
    expect(db.conversations.filter((c) => c.userId === users.empA.id)).toHaveLength(0);
    expect(db.conversations.map((c) => c.id)).toContain(b1);
    expect(db.audit.some((e) => e.action === "CONVERSATIONS_DELETED_ALL" && e.userId === users.empA.id)).toBe(true);
  });

  test("with nothing to delete it simply reports zero", async () => {
    const res = await all("empA", { confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(0);
  });
});

describe("what deleting chat history does and does not touch", () => {
  test("messages, feedback, a waiting change and an unfinished ticket draft go; tickets, comments, notifications and done changes stay", async () => {
    const id = await say("empA", "Show my open tickets");
    const keep = await say("empA", "another chat");
    const reply = db.messages.find((m) => m.conversationId === id && m.senderType === "ASSISTANT");
    db.feedback.push({ id: "f1", messageId: reply.id, userId: users.empA.id, rating: "helpful", createdAt: new Date() });
    const future = new Date(Date.now() + 600000);
    db.pending.push(
      { id: "p_wait", userId: users.empA.id, conversationId: id, status: "PENDING", expiresAt: future, createdAt: new Date() },
      { id: "p_done", userId: users.empA.id, conversationId: id, status: "EXECUTED", expiresAt: future, createdAt: new Date() },
      { id: "p_other", userId: users.empA.id, conversationId: keep, status: "PENDING", expiresAt: future, createdAt: new Date() }
    );
    db.drafts.push(
      { id: "d_open", userId: users.empA.id, conversationId: id, status: "ACTIVE", fields: {}, step: "TITLE", expiresAt: future },
      { id: "d_made", userId: users.empA.id, conversationId: id, status: "CREATED", fields: {}, step: "REVIEW", expiresAt: future }
    );
    db.draftFiles.push({ id: "file1", draftId: "d_open", fileName: "a.png", size: 1, data: Buffer.from("x") });
    db.notifications.push({ id: "n1", userId: users.empA.id, ticketId: "id_2627001", type: "X", title: "t", message: "m", isRead: false, createdAt: new Date() });
    const tickets = JSON.stringify(db.tickets);

    const res = await bulk("empA", { conversationIds: [id] });
    expect(res.body.data.deleted).toBe(1);

    expect(db.messages.filter((m) => m.conversationId === id)).toHaveLength(0);
    expect(db.feedback.find((f) => f.id === "f1")).toBeUndefined();
    expect(db.pending.find((p) => p.id === "p_wait").status).toBe("CANCELLED");
    expect(db.pending.find((p) => p.id === "p_done").status).toBe("EXECUTED");
    expect(db.pending.find((p) => p.id === "p_other").status).toBe("PENDING");
    expect(db.drafts.map((d) => d.id)).toEqual(["d_made"]);
    expect(db.draftFiles).toHaveLength(0);
    // Business data is not chat history.
    expect(JSON.stringify(db.tickets)).toBe(tickets);
    expect(db.notifications.map((n) => n.id)).toEqual(["n1"]);
    expect(db.messages.some((m) => m.conversationId === keep)).toBe(true);
  });

  test("the single delete cleans up the same way", async () => {
    const id = await say("empA", "hello");
    db.drafts.push({ id: "d_open", userId: users.empA.id, conversationId: id, status: "ACTIVE", fields: {}, step: "TITLE", expiresAt: new Date(Date.now() + 600000) });
    expect((await request(app).delete(`/api/v1/chatbot/conversations/${id}`).set(as("empA"))).status).toBe(200);
    expect(db.drafts).toHaveLength(0);
  });
});

describe("authentication", () => {
  test("the new endpoints require a signed-in user", async () => {
    for (const res of [await request(app).post("/api/v1/chatbot/conversations/bulk-delete").send({ conversationIds: ["c000000000000000000000001"] }), await request(app).post("/api/v1/chatbot/conversations/delete-all").send({ confirm: true })]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("CHAT_AUTH_REQUIRED");
    }
  });
});
