jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// Test-only stand-in for middleware/auth.js: it maps a header to a fixture
// user, exactly like the real middleware attaches req.user. Everything else
// (rate limiter, validators, controller, error handler) is the real code.
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
const { seedDefault } = require("../testkit/fixtures");

// Each app gets a fresh module graph so its rate limiter has its own counters.
function buildApp(limit) {
  process.env.CHATBOT_RATE_LIMIT_MAX = String(limit);
  let a;
  jest.isolateModules(() => {
    // Same order as app.js: express-async-errors must patch the SAME express
    // instance the routes are built with.
    require("express-async-errors");
    const express = require("express");
    const routes = require("../chatbot.routes");
    a = express();
    a.use(express.json());
    a.use("/api/v1/chatbot", routes);
    a.prisma = require("../../config/prisma"); // this app's own (isolated) data double
  });
  // Mirrors middleware/errorHandler.js's shape for anything not handled by the chatbot router.
  // eslint-disable-next-line no-unused-vars
  a.use((err, _req, res, _next) => res.status(500).json({ success: false, message: "Internal server error" }));
  return a;
}

const app = buildApp(1000);

const as = (who) => ({ "x-test-user": who });
const post = (who, body) => request(app).post("/api/v1/chatbot/messages").set(as(who)).send(body);

beforeEach(seedDefault);

describe("authentication", () => {
  test("every endpoint requires authentication and answers CHAT_AUTH_REQUIRED", async () => {
    const calls = [
      request(app).get("/api/v1/chatbot/suggestions"),
      request(app).post("/api/v1/chatbot/messages").send({ message: "hi" }),
      request(app).get("/api/v1/chatbot/conversations/c000000000000000000000001"),
      request(app).post("/api/v1/chatbot/messages/c000000000000000000000001/feedback").send({ rating: "helpful" }),
    ];
    for (const c of calls) {
      const res = await c;
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("CHAT_AUTH_REQUIRED");
    }
  });
});

describe("POST /messages", () => {
  test("returns the documented response shape", async () => {
    const res = await post("empA", { message: "How do I change my password?" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.data).sort()).toEqual(["conversationId", "data", "error", "intent", "interpretation", "message", "messageId", "navigationTarget", "pendingAction", "responseType", "suggestedActions"]);
    expect(res.body.data.interpretation).toEqual({ method: "rule", confidence: 1 });
    expect(res.body.data.responseType).toBe("guidance");
  });

  test("a role/userId in the body is ignored — the authenticated user decides", async () => {
    const res = await post("empA", { message: "Show team tickets", role: "ADMIN", userId: "u_admin", portalRole: "ADMIN" });
    expect(res.status).toBe(200);
    expect(res.body.data.error.code).toBe("CHAT_ACCESS_DENIED");
  });

  test.each([
    [{}],
    [{ message: "" }],
    [{ message: 42 }],
    [{ message: "x".repeat(1001) }],
    [{ message: "hi", conversationId: "../etc/passwd" }],
  ])("invalid input %j -> 400 CHAT_INVALID_INPUT", async (body) => {
    const res = await post("empA", body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CHAT_INVALID_INPUT");
  });

  test("unknown conversation -> 404 CHAT_CONVERSATION_NOT_FOUND", async () => {
    const res = await post("empA", { message: "hi", conversationId: "c000000000000000000009999" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CHAT_CONVERSATION_NOT_FOUND");
  });

  test("responses never contain stack traces", async () => {
    const res = await post("empA", { message: "x".repeat(2000) });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|node_modules|stack/i);
  });
});

describe("conversation endpoints", () => {
  test("owner can read; another user (even an admin) gets 404; reset works", async () => {
    const sent = await post("empA", { message: "Show my open tickets" });
    const id = sent.body.data.conversationId;

    expect((await request(app).get(`/api/v1/chatbot/conversations/${id}`).set(as("empA"))).body.data.messages).toHaveLength(2);
    for (const who of ["empB", "admin"]) {
      const res = await request(app).get(`/api/v1/chatbot/conversations/${id}`).set(as(who));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CHAT_CONVERSATION_NOT_FOUND");
    }
    const reset = await request(app).post(`/api/v1/chatbot/conversations/${id}/reset`).set(as("empA"));
    expect(reset.body.data.status).toBe("ARCHIVED");
  });

  test("history lists only my own conversations, titled by the first message", async () => {
    const mine = await post("empA", { message: "Show my open tickets" });
    await post("empB", { message: "someone else's chat" });
    const res = await request(app).get("/api/v1/chatbot/conversations").set(as("empA"));
    expect(res.status).toBe(200);
    const ids = res.body.data.conversations.map((c) => c.conversationId);
    expect(ids).toContain(mine.body.data.conversationId);
    expect(res.body.data.conversations.find((c) => c.conversationId === mine.body.data.conversationId)).toMatchObject({ title: "Show my open tickets", status: "ACTIVE" });
    const others = (await request(app).get("/api/v1/chatbot/conversations").set(as("empB"))).body.data.conversations.map((c) => c.conversationId);
    expect(others).not.toContain(mine.body.data.conversationId);
    expect(JSON.stringify(res.body)).not.toContain("someone else");
  });

  test("an archived conversation can be resumed by its owner only and then continued", async () => {
    const sent = await post("empA", { message: "hello" });
    const id = sent.body.data.conversationId;
    await request(app).post(`/api/v1/chatbot/conversations/${id}/reset`).set(as("empA"));
    expect((await post("empA", { message: "again", conversationId: id })).status).toBe(404);
    expect((await request(app).post(`/api/v1/chatbot/conversations/${id}/resume`).set(as("empB"))).status).toBe(404);
    const resumed = await request(app).post(`/api/v1/chatbot/conversations/${id}/resume`).set(as("empA"));
    expect(resumed.body.data.status).toBe("ACTIVE");
    expect((await post("empA", { message: "again", conversationId: id })).status).toBe(200);
  });

  test("deleting removes my conversation; others cannot delete it", async () => {
    const id = (await post("empA", { message: "hello" })).body.data.conversationId;
    expect((await request(app).delete(`/api/v1/chatbot/conversations/${id}`).set(as("empB"))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/chatbot/conversations/${id}`).set(as("empA"))).status).toBe(200);
    expect((await request(app).get(`/api/v1/chatbot/conversations/${id}`).set(as("empA"))).status).toBe(404);
    const left = (await request(app).get("/api/v1/chatbot/conversations").set(as("empA"))).body.data.conversations.map((c) => c.conversationId);
    expect(left).not.toContain(id);
  });

  test("a conversation opened under another role is not shown after a role change", async () => {
    const id = (await post("empA", { message: "hello" })).body.data.conversationId;
    app.prisma.__db.conversations.find((c) => c.id === id).portalRole = "ADMIN";
    expect((await request(app).get(`/api/v1/chatbot/conversations/${id}`).set(as("empA"))).status).toBe(404);
    const listed = (await request(app).get("/api/v1/chatbot/conversations").set(as("empA"))).body.data.conversations.map((c) => c.conversationId);
    expect(listed).not.toContain(id);
  });

  test("feedback validation and ownership", async () => {
    const sent = await post("empA", { message: "hello" });
    const url = `/api/v1/chatbot/messages/${sent.body.data.messageId}/feedback`;
    expect((await request(app).post(url).set(as("empA")).send({ rating: "bogus" })).status).toBe(400);
    expect((await request(app).post(url).set(as("empB")).send({ rating: "helpful" })).status).toBe(404);
    expect((await request(app).post(url).set(as("empA")).send({ rating: "unauthorized_information", reason: "saw something" })).status).toBe(200);
  });
});

describe("GET /suggestions", () => {
  test("is derived from the authenticated role", async () => {
    const emp = (await request(app).get("/api/v1/chatbot/suggestions").set(as("empA"))).body.data;
    const adm = (await request(app).get("/api/v1/chatbot/suggestions").set(as("admin"))).body.data;
    expect(emp.portal).toBe("Employee Portal");
    expect(emp.suggestions).toContain("Show my open tickets");
    expect(adm.portal).toBe("Admin Portal");
    expect(adm.suggestions).toContain("How do I manage users?");
    expect(emp.suggestions).not.toContain("How do I manage users?");
  });
});

describe("rate limiting", () => {
  test("is per user, returns CHAT_RATE_LIMITED, and does not throttle other users", async () => {
    const limitedApp = buildApp(5);
    const send = (who) => request(limitedApp).post("/api/v1/chatbot/messages").set(as(who)).send({ message: "hello" });
    const statuses = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await send("tlD1")).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    const limited = await send("tlD1");
    expect(limited.body.error.code).toBe("CHAT_RATE_LIMITED");
    expect((await send("mgrD2")).status).toBe(200);
  });
});

describe("admin action endpoints", () => {
  const departmentService = require("../../services/department.service");
  const fakeId = "c000000000000000000009999";
  const proof = { confirmationToken: "a".repeat(48), conversationId: fakeId };

  test("require authentication and a well-formed id, token and conversation", async () => {
    for (const verb of ["confirm", "cancel"]) {
      const noAuth = await request(app).post(`/api/v1/chatbot/actions/${fakeId}/${verb}`).send(proof);
      expect(noAuth.status).toBe(401);
      expect(noAuth.body.error.code).toBe("CHAT_AUTH_REQUIRED");
      const bad = await request(app).post(`/api/v1/chatbot/actions/not-an-id/${verb}`).set(as("admin")).send(proof);
      expect(bad.status).toBe(400);
      // The action id alone is not enough: the token and conversation are required.
      const noProof = await request(app).post(`/api/v1/chatbot/actions/${fakeId}/${verb}`).set(as("admin")).send({});
      expect(noProof.status).toBe(400);
      expect(noProof.body.error.code).toBe("CHAT_INVALID_INPUT");
    }
  });

  test("an unknown id is 404 for everyone (no oracle for who may act)", async () => {
    for (const who of ["admin", "empA", "tlD1"]) {
      const res = await request(app).post(`/api/v1/chatbot/actions/${fakeId}/confirm`).set(as(who)).send(proof);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CHAT_ACTION_NOT_FOUND");
    }
  });

  test("end to end over HTTP: propose, wrong proof is refused, right proof executes once", async () => {
    const spy = jest.spyOn(departmentService, "createDepartment").mockResolvedValue({});
    const proposed = await post("admin", { message: "Create new department Legal" });
    const d = proposed.body.data;
    expect(d.responseType).toBe("preview");
    expect(d.pendingAction.title).toBe("Create department");
    expect(d.pendingAction.confirmationToken).toMatch(/^[a-f0-9]{48}$/);
    expect(spy).not.toHaveBeenCalled();
    const url = `/api/v1/chatbot/actions/${d.pendingAction.id}/confirm`;

    const wrongToken = await request(app).post(url).set(as("admin")).send({ confirmationToken: "b".repeat(48), conversationId: d.conversationId });
    expect(wrongToken.status).toBe(404);
    const wrongConvo = await request(app).post(url).set(as("admin")).send({ confirmationToken: d.pendingAction.confirmationToken, conversationId: fakeId });
    expect(wrongConvo.status).toBe(404);
    const otherAdmin = await request(app).post(url).set(as("admin2")).send({ confirmationToken: d.pendingAction.confirmationToken, conversationId: d.conversationId });
    expect(otherAdmin.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();

    const ok = { confirmationToken: d.pendingAction.confirmationToken, conversationId: d.conversationId };
    const done = await request(app).post(url).set(as("admin")).send(ok);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: "EXECUTED", message: 'Department "Legal" was created.' });
    await request(app).post(url).set(as("admin")).send(ok);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
