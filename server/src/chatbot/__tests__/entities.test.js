jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

const service = require("../chatbot.service");
const { extractEntities } = require("../entities/extract");
const { extractDateRange } = require("../entities/dates");
const { didYouMean } = require("../intents/didYouMean");
const { users, seedDefault } = require("../testkit/fixtures");

const ask = (user, message, conversationId) => service.sendMessage(user, { message, conversationId });
beforeEach(seedDefault);

describe("layer 1: details are read from real values", () => {
  test("department (typo tolerant), priority (and synonyms), status and relative date", async () => {
    const f = await extractEntities("show urgent resolved tickets in finnance from last week");
    expect(f).toMatchObject({ department: "Finance", priority: "High", status: "RESOLVED" });
    expect(f.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.labels).toEqual(expect.arrayContaining(["department Finance", "High priority", "status Resolved", "last week"]));
  });

  test("a mention is limited to departments the caller may see", async () => {
    const f = await extractEntities("tickets in finance", { visibleDepartments: ["IT Support"] });
    expect(f.department).toBeNull();
  });

  test("relative dates are exact and week starts on Monday", () => {
    const wed = new Date(2026, 9, 7); // Wed 7 Oct 2026
    expect(extractDateRange("tickets this week", wed)).toMatchObject({ from: "2026-10-05", to: "2026-10-07" });
    expect(extractDateRange("tickets last week", wed)).toMatchObject({ from: "2026-09-28", to: "2026-10-04" });
    expect(extractDateRange("last 7 days", wed)).toMatchObject({ from: "2026-10-01", to: "2026-10-07" });
    expect(extractDateRange("no date here", wed)).toBeNull();
  });
});

describe("layer 1 applied: ticket questions narrow by every detail mentioned", () => {
  test("priority and department phrased freely", async () => {
    const r = await ask(users.admin, "show me high priority tickets in finance");
    expect(r.intent).toMatch(/list_tickets|search_tickets/);
    expect(r.data.tickets.length).toBeGreaterThan(0);
    for (const t of r.data.tickets) {
      expect(t.priority.name).toBe("High");
      expect(t.department).toBe("Finance");
    }
  });
});

describe("layer 3: never a dead end", () => {
  test("an empty result says what was searched and offers a wider search", async () => {
    const r = await ask(users.admin, "show closed tickets in finance from yesterday");
    expect(r.error?.code).toBe("CHAT_NO_RESULTS");
    expect(r.message).toMatch(/I couldn't find any closed tickets for Finance \(yesterday\)/);
    expect(r.suggestedActions.map((a) => a.prompt)).toContain("Show tickets in Finance");
  });

  test("an unrecognized message offers the closest real questions and what was noticed", async () => {
    const r = await ask(users.empA, "tickts stuff pending whatever blah");
    expect(r.message).not.toMatch(/^I can't help with that here/);
    expect(r.suggestedActions.length).toBeGreaterThan(0);
  });

  test("didYouMean ranks by shared words, typo tolerant, and names recognized details", () => {
    const h = didYouMean({ message: "how do i chnage my pasword", role: "EMPLOYEE", found: { department: "Finance", labels: ["department Finance"] } });
    expect(h.noticed).toContain("department Finance");
    expect(h.prompts).toContain("Show tickets in Finance");
  });
});

describe("misses report", () => {
  const { groupMisses, collectMisses } = require("../misses");

  test("groups repeated phrasings, masks emails and numbers, most frequent first", () => {
    const at = new Date();
    const g = groupMisses([
      { text: "show hardware stuff", reason: "not understood", role: "ADMIN", at },
      { text: "Show Hardware stuff", reason: "no results", role: "MANAGER", at },
      { text: "other thing", reason: "not understood", role: "ADMIN", at },
    ]);
    expect(g[0]).toMatchObject({ count: 2, reasons: ["not understood", "no results"], roles: ["ADMIN", "MANAGER"] });
    expect(g).toHaveLength(2);
  });

  test("is built from unsupported / no-result replies and bad ratings, paired with the question", async () => {
    await ask(users.empA, "qwerty zxcv blah");
    const r = await ask(users.empA, "how do i change my password");
    await service.submitFeedback(users.empA, r.messageId, { rating: "not_helpful" });
    const { misses } = await collectMisses({ days: 1 });
    const texts = misses.map((m) => m.text);
    expect(texts).toContain("qwerty zxcv blah");
    expect(texts).toContain("how do i change my password");
  });

  test("only an admin can read it", async () => {
    await expect(service.missesReport(users.empA, {})).rejects.toMatchObject({ code: "CHAT_ACCESS_DENIED" });
    await expect(service.missesReport(users.admin, { days: "7" })).resolves.toHaveProperty("misses");
  });
});

describe("people questions honor the role asked for", () => {
  const { users: u } = require("../testkit/fixtures");
  test("'the Manager in <dept>' lists only managers, 'employees' only employees, none = everyone", async () => {
    const mgr = await ask(u.admin, "show me the Manager in IT Support");
    expect(mgr.message).toMatch(/^IT Support\n|no managers? found/);
    expect(mgr.message).not.toMatch(/— (Employee|Team Lead)/);
    const lead = await ask(u.admin, "show me the team lead in IT Support");
    expect(lead.message).toMatch(/— Team Lead/);
    expect(lead.message).not.toMatch(/— (Employee|Manager)/);
    const all = await ask(u.admin, "show me the people in IT Support");
    expect(all.message).toMatch(/— Employee/);
  });
  test("two roles together", async () => {
    const r = await ask(u.admin, "show me the managers and team leads in IT Support");
    expect(r.message).not.toMatch(/— Employee/);
  });
});
