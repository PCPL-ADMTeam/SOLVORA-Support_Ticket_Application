jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

const fs = require("fs");
const path = require("path");
const service = require("../chatbot.service");
const { getSuggestions, SUGGESTIONS } = require("../suggestions");
const knowledge = require("../knowledge");
const { users, seedDefault, prismaMock } = require("../testkit/fixtures");

const ask = (user, message, conversationId) => service.sendMessage(user, { message, conversationId });

beforeEach(seedDefault);

describe("guidance", () => {
  test("profile guidance returns the caller's own profile and a profile dialog target", async () => {
    const r = await ask(users.empA, "Where can I view my profile?");
    expect(r.intent).toBe("view_profile");
    expect(r.message).toContain("Alice Employee");
    expect(r.message).toContain("IT Support");
    expect(r.navigationTarget).toEqual({ type: "dialog", dialog: "profile", label: "Open profile" });
    expect(r.message).not.toContain("Bob");
  });

  test("password guidance uses the real labels from the Edit Profile dialog", async () => {
    const r = await ask(users.empA, "How do I change my password?");
    expect(r.intent).toBe("change_password");
    for (const label of ["Edit Profile", "Change Password", "Current Password", "Update Password"]) expect(r.message).toContain(label);
    expect(r.navigationTarget.label).toBe("Open password settings");
  });

  test("update-profile guidance is honest that only the name is editable", async () => {
    const r = await ask(users.empA, "How do I update my profile?");
    expect(r.intent).toBe("update_profile");
    expect(r.message).toMatch(/only lets you change your name/);
  });

  test("create-ticket navigation target depends on the role's portal", async () => {
    expect((await ask(users.empA, "How do I create a ticket?")).navigationTarget.path).toBe("/portal/new-ticket");
    expect((await ask(users.tlD1, "How do I create a ticket?")).navigationTarget.path).toBe("/agent/new-ticket");
    expect((await ask(users.mgrD2, "How do I create a ticket?")).navigationTarget.path).toBe("/agent/new-ticket");
    const admin = await ask(users.admin, "How do I create a ticket?");
    expect(admin.navigationTarget?.path || "").not.toMatch(/new-ticket/);
  });

  test("admin guidance targets real admin routes", async () => {
    expect((await ask(users.admin, "How do I manage users?")).navigationTarget.path).toBe("/admin/users");
    expect((await ask(users.admin, "How do I configure an SLA?")).navigationTarget.path).toBe("/admin/priorities");
    expect((await ask(users.admin, "Explain notification settings")).navigationTarget.path).toBe("/admin/email-templates");
  });

  test("category guidance says the screen does not exist instead of inventing steps", async () => {
    const r = await ask(users.admin, "How do I create a category?");
    expect(r.message).toMatch(/no Categories page/);
    expect(r.navigationTarget).toBeNull();
  });

  test("status explanation lists every status", async () => {
    const r = await ask(users.empA, "Understand ticket status");
    expect(r.intent).toBe("status_definition");
    expect(r.data.statuses.map((s) => s.label)).toEqual(["Open", "In Progress", "On Hold", "Resolved", "Closed", "Reopened"]);
  });

  test("priority explanation lists configured priorities", async () => {
    const r = await ask(users.empA, "Explain ticket priority");
    expect(r.intent).toBe("priority_definition");
    expect(r.message).toContain("Low, High");
  });

  test("SLA/escalation questions state that the application does not track them", async () => {
    expect((await ask(users.empA, "How does SLA work?")).message).toMatch(/does not currently track SLA/);
    expect((await ask(users.empA, "How does escalation work?")).message).toMatch(/no separate escalation feature/);
    for (const msg of ["Show overdue tickets", "Show tickets approaching SLA limits", "Show escalated tickets"]) {
      const r = await ask(users.tlD1, msg);
      expect(r.message).toMatch(/doesn't track/);
      expect(r.data.tickets).toBeUndefined();
      expect(r.suggestedActions.length).toBeGreaterThan(0);
    }
  });

  test("greeting returns role capabilities; unsupported requests get a generic refusal", async () => {
    expect((await ask(users.empA, "hello")).message).toMatch(/Employee Portal/);
    const r = await ask(users.empA, "What's the weather like?");
    expect(r.error.code).toBe("CHAT_UNSUPPORTED_INTENT");
  });
});

describe("ticket information", () => {
  test("search finds authorized tickets by text", async () => {
    const r = await ask(users.empA, "Find tickets about printer");
    expect(r.data.tickets.map((t) => t.ticketNumber)).toEqual(["2627001"]);
  });

  test("ticket list cards expose only allow-listed fields", async () => {
    const r = await ask(users.tlD1, "Show team tickets");
    const card = r.data.tickets[0];
    expect(Object.keys(card).sort()).toEqual(
      ["assignedTo", "category", "createdAt", "department", "lastUpdatedAt", "priority", "raisedBy", "status", "statusLabel", "ticketNumber", "ticketRouteId", "title"].sort()
    );
    expect(JSON.stringify(r)).not.toMatch(/@example\.test/);
  });

  test("summary follows the contract and marks missing data as unavailable", async () => {
    const r = await ask(users.empA, "Summarize ticket 2627001");
    const s = r.data.summary;
    for (const key of ["ticketId", "subject", "summary", "category", "priority", "status", "createdAt", "lastUpdatedAt", "assignedTo", "slaStatus", "latestUpdate", "pendingActions", "resolutionSummary"]) {
      expect(s).toHaveProperty(key);
    }
    expect(s.subject).toBe("Printer on floor 2 is broken");
    expect(s.summary).toBe("Something is wrong");
    expect(s.assignedTo).toBe("Carol Worker");
    expect(s.slaStatus).toBe("Not tracked");
    expect(s.category).toBeNull();
    expect(s.unavailableFields).toEqual(expect.arrayContaining(["category", "resolutionSummary"]));
    expect(s.latestUpdate).toContain("We ordered a new toner");
    expect(r.navigationTarget).toEqual({ type: "route", path: "/tickets/id_2627001", label: "Open ticket" });
  });

  test("resolved ticket summary includes recorded resolution notes only", async () => {
    const s = (await ask(users.empA, "Summarize ticket 2627004")).data.summary;
    expect(s.resolutionSummary).toBe("Replacement laptop issued");
    expect(s.pendingActions).toEqual(["The ticket is resolved but not yet closed."]);
  });

  test("pending actions are recorded facts; suggestions are separate and staff-only", async () => {
    const staff = (await ask(users.tlD1, "Summarize ticket 2627002")).data.summary;
    expect(staff.pendingActions.join(" ")).toMatch(/on hold.*Waiting for vendor/);
    expect(staff.pendingActions.join(" ")).toMatch(/No assignee/);
    expect(staff.suggestions.length).toBe(1);
    const own = (await ask(users.empB, "Summarize ticket 2627002")).data.summary;
    expect(own.suggestions).toEqual([]);
  });

  test("latest update and history intents", async () => {
    const latest = await ask(users.empA, "What is the latest update on ticket 2627001?");
    expect(latest.intent).toBe("latest_update");
    expect(latest.data.summary.latestUpdate).toContain("toner");
    const hist = await ask(users.empA, "Show history of ticket 2627001");
    expect(hist.data.history.entries[0].description).toBe("Status changed from Open to In Progress by Tina Lead");
  });

  test("open / pending / unassigned / stale listings", async () => {
    expect((await ask(users.empA, "Show my open tickets")).data.tickets.map((t) => t.ticketNumber)).toEqual(["2627001"]);
    expect((await ask(users.empB, "Show my pending tickets")).data.tickets.map((t) => t.ticketNumber)).toEqual(["2627002"]);
    expect((await ask(users.tlD1, "Show unassigned tickets")).data.tickets.map((t) => t.ticketNumber)).toEqual(["2627002"]);
    const stale = await ask(users.tlD1, "Show tickets with no recent activity");
    expect(stale.data.tickets.map((t) => t.ticketNumber)).toEqual(["2627002"]);
    expect(stale.message).toMatch(/does not track SLAs/);
  });

  test("statistics for a department", async () => {
    const r = await ask(users.tlD1, "Show department ticket summary");
    expect(r.data.statistics.total).toBe(3);
    expect(r.data.statistics.byStatus).toEqual({ IN_PROGRESS: 1, ON_HOLD: 1, RESOLVED: 1 });
    expect(r.data.statistics.openUnassigned).toBe(1);
    const trends = await ask(users.mgrD2, "Show ticket trends");
    expect(trends.data.statistics.createdLast30Days).toBe(1);
  });

  test("summarizing several tickets re-authorizes each one", async () => {
    const r = await ask(users.tlD1, "Summarize my department tickets");
    expect(r.intent).toBe("summarize_tickets");
    expect(r.data.summaries.map((s) => s.ticketId).sort()).toEqual(["2627001", "2627002"]);
  });

  test("no-result response", async () => {
    const r = await ask(users.empA, "Show my pending tickets");
    expect(r.error.code).toBe("CHAT_NO_RESULTS");
    expect(r.message).toBe("I didn't find any matching tickets.");
  });

  test("invalid ticket ids", async () => {
    for (const msg of ["Summarize ticket 12ab", "Find ticket 99", "Summarize ticket ABC-1"]) {
      expect((await ask(users.empA, msg)).error.code).toBe("CHAT_INVALID_TICKET_ID");
    }
  });

  test("asks for a ticket number when none is given", async () => {
    const r = await ask(users.empA, "Summarize a ticket");
    expect(r.message).toMatch(/Which ticket/);
    expect(r.error).toBeNull();
  });
});

describe("conversations", () => {
  test("multi-turn: follow-ups reuse the previous ticket and are re-authorized", async () => {
    const first = await ask(users.empA, "Summarize ticket 2627001");
    const second = await ask(users.empA, "Show the history of it", first.conversationId);
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.data.history.ticketNumber).toBe("2627001");
    const convo = await service.getConversation(users.empA, first.conversationId);
    expect(convo.messages.map((m) => m.sender)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  test("a follow-up with no prior ticket asks which ticket", async () => {
    const r = await ask(users.empA, "Summarize it");
    expect(r.message).toMatch(/Which ticket/);
  });

  test("reset archives the conversation; the old id can no longer be used", async () => {
    const r = await ask(users.empA, "Show my open tickets");
    await service.resetConversation(users.empA, r.conversationId);
    expect((await service.getConversation(users.empA, r.conversationId)).status).toBe("ARCHIVED");
    await expect(ask(users.empA, "hello", r.conversationId)).rejects.toMatchObject({ code: "CHAT_CONVERSATION_NOT_FOUND" });
    const fresh = await ask(users.empA, "hello");
    expect(fresh.conversationId).not.toBe(r.conversationId);
  });

  test("feedback is stored once per user/message and can be updated", async () => {
    const r = await ask(users.empA, "Show my open tickets");
    await service.submitFeedback(users.empA, r.messageId, { rating: "helpful" });
    await service.submitFeedback(users.empA, r.messageId, { rating: "incorrect", reason: "wrong" });
    expect(prismaMock.__db.feedback).toHaveLength(1);
    expect(prismaMock.__db.feedback[0]).toMatchObject({ rating: "incorrect", reason: "wrong" });
  });

  test("input validation", async () => {
    await expect(ask(users.empA, "   ")).rejects.toMatchObject({ code: "CHAT_INVALID_INPUT" });
    await expect(ask(users.empA, "x".repeat(1001))).rejects.toMatchObject({ code: "CHAT_INVALID_INPUT" });
    await expect(ask(users.empA, undefined)).rejects.toMatchObject({ code: "CHAT_INVALID_INPUT" });
  });

  test("database failures surface as a generic error, never internals", async () => {
    const spy = jest.spyOn(prismaMock.chatConversation, "create").mockRejectedValue(new Error("connection refused at 10.0.0.5:5432"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(ask(users.empA, "hello")).rejects.toMatchObject({ code: "CHAT_DATABASE_ERROR", message: expect.not.stringContaining("10.0.0.5") });
    spy.mockRestore();
    console.error.mockRestore();
  });
});

describe("suggested prompts", () => {
  test("each role gets its own server-defined list, derived from the authenticated user", () => {
    expect(getSuggestions(users.empA).suggestions).toEqual(SUGGESTIONS.EMPLOYEE);
    expect(getSuggestions(users.tlD1).suggestions).toEqual(SUGGESTIONS.TEAMLEAD);
    expect(getSuggestions(users.mgrD2).suggestions).toEqual(SUGGESTIONS.MANAGER);
    expect(getSuggestions(users.admin).suggestions).toEqual(SUGGESTIONS.ADMIN);
    expect(getSuggestions(users.empA).portal).toBe("Employee Portal");
    expect(getSuggestions({ ...users.empA, role: { name: "NOBODY" } })).toBeNull();
  });

  test("every suggested prompt is understood by the chatbot for that role (no dead prompts)", async () => {
    const byRole = { EMPLOYEE: users.empA, TEAMLEAD: users.tlD1, MANAGER: users.mgrD2, ADMIN: users.admin };
    for (const [role, user] of Object.entries(byRole)) {
      for (const prompt of SUGGESTIONS[role]) {
        const r = await ask(user, prompt);
        expect(r.error?.code).not.toBe("CHAT_UNSUPPORTED_INTENT");
        expect(r.error?.code).not.toBe("CHAT_ACCESS_DENIED");
      }
    }
  });
});

describe("knowledge base", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../../../../client/src/App.jsx"), "utf8");
  const KNOWN_ROUTE_PREFIXES = ["/portal", "/agent", "/admin"];

  test("every route target maps to a route that exists in the frontend router", () => {
    const routes = knowledge.ARTICLES.filter((a) => a.route?.type === "route").map((a) => a.route.path);
    expect(routes.length).toBeGreaterThan(10);
    for (const p of routes) {
      expect(KNOWN_ROUTE_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))).toBe(true);
      const segments = p.split("/").filter(Boolean);
      if (segments.length === 1) expect(appSource).toContain(`path="/${segments[0]}"`);
      else expect(appSource).toMatch(new RegExp(`path="${segments[1]}"`));
    }
  });

  test("every article has the required metadata", () => {
    for (const a of knowledge.ARTICLES) {
      expect(a.id).toBeTruthy();
      expect(a.title).toBeTruthy();
      expect(a.roles.length).toBeGreaterThan(0);
      expect(a.steps.length).toBeGreaterThan(0);
      expect(a.keywords.length).toBeGreaterThan(0);
      expect(a.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof a.active).toBe("boolean");
    }
  });

  test("role filtering: an employee can never retrieve an admin article", () => {
    expect(knowledge.getArticle("admin.users", "EMPLOYEE")).toBeNull();
    expect(knowledge.searchArticles("manage users add user", "EMPLOYEE").map((a) => a.id)).not.toContain("admin.users");
    expect(knowledge.getArticle("admin.users", "ADMIN")).toBeTruthy();
  });
});

describe("departments (scoped by role)", () => {
  test("each role sees only the departments it may see", async () => {
    const admin = await ask(users.admin, "what are all the departments available?");
    expect(admin.intent).toBe("list_departments");
    expect(admin.data.departments).toEqual(["Finance", "IT Support"]);
    const tl = await ask(users.tlD1, "what are all the departments available?");
    expect(tl.data.departments).toEqual(["IT Support"]);
    expect(tl.message).toMatch(/^You have access to 1 department: IT Support\./);
    expect((await ask(users.mgrD2, "tell me the department names")).data.departments).toEqual(["Finance"]);
    const emp = await ask(users.empA, "tell me the department names");
    expect(emp.data.departments).toEqual(["IT Support"]);
    expect(emp.message).toBe("Your department: IT Support.");
    for (const r of [tl, emp]) expect(JSON.stringify(r)).not.toMatch(/Finance|@example\.test|Tina|Mark/);
  });

  test("'manage departments' stays guidance, and 'department tickets' stays a ticket query", async () => {
    expect((await ask(users.admin, "How do I manage departments?")).navigationTarget.path).toBe("/admin/departments");
    expect((await ask(users.tlD1, "Show department tickets")).intent).toBe("list_tickets");
  });
});

describe("department members (scoped)", () => {
  test("admin gets names and roles for a named department, tolerating typos and no 'department' word", async () => {
    for (const msg of ["show me the employee names in IT Support", "show me the employee name in it suport", "who are the people in Finance department"]) {
      const r = await ask(users.admin, msg);
      expect(r.intent).toBe("people_directory");
    }
    const r = await ask(users.admin, "show me the employee name in IT Support");
    const dept = r.data.departmentMembers[0];
    expect(dept.name).toBe("IT Support");
    // "employee names" asks for the Employee role only.
    expect(dept.members.map((m) => `${m.name}:${m.role}`)).toEqual(["Alice Employee:Employee", "Bob Employee:Employee"]);
    expect(r.message).toContain("Alice Employee — Employee");
    expect(r.message).not.toContain("Tina Lead");
  });

  test("inactive people and emails are never included", async () => {
    const out = JSON.stringify(await ask(users.admin, "list the people in IT Support"));
    expect(out).not.toMatch(/Gone|@example\.test|email/i);
  });

  test("'each department' lists every department; no department named asks which one", async () => {
    const all = await ask(users.admin, "show me the employee names in each department?");
    expect(all.data.departmentMembers.map((d) => d.name)).toEqual(["Finance", "IT Support"]);
    const none = await ask(users.admin, "show me the employee names");
    expect(none.message).toMatch(/Which department/);
    expect(none.message).toContain("Finance");
  });

  test("short names need an exact match ('it' must not match 'Finance')", async () => {
    const r = await ask(users.admin, "show people in hr");
    expect(r.message).toMatch(/Which department/);
  });

  test("an employee is refused: no names, no navigation, denial audited", async () => {
    for (const msg of ["show me the employee names in each department?", "list the people in IT Support"]) {
      const r = await ask(users.empA, msg);
      expect(r.error.code).toBe("CHAT_ACCESS_DENIED");
      expect(r.navigationTarget).toBeNull();
      expect(JSON.stringify(r)).not.toMatch(/Alice|Bob|Tina|Mark|Dan Finance/);
    }
    expect(prismaMock.__db.audit.some((a) => a.action === "TOOL_PERMISSION_DENIED" && a.result === "DENIED")).toBe(true);
  });

  test("a Team Lead / Manager sees people ONLY in their own departments", async () => {
    const tl = await ask(users.tlD1, "list the people in IT Support");
    expect(tl.data.departmentMembers.map((d) => d.name)).toEqual(["IT Support"]);
    expect(tl.message).toContain("Alice Employee — Employee");
    expect(tl.navigationTarget).toBeNull();
    // Asking for "each department" never widens the scope.
    const all = await ask(users.tlD1, "show me the employee names in each department?");
    expect(all.data.departmentMembers.map((d) => d.name)).toEqual(["IT Support"]);
    expect(JSON.stringify(all)).not.toMatch(/Dan Finance|Mark Manager/);
    // Naming another department gets the neutral "which department" answer, listing only their own.
    const other = await ask(users.tlD1, "who works in Finance");
    expect(other.message).toMatch(/Which department/);
    expect(other.message).toContain("IT Support");
    expect(other.message).not.toMatch(/Finance|Dan/);
    const mgr = await ask(users.mgrD2, "list the people in Finance");
    expect(mgr.message).toContain("Dan Finance — Employee");
    expect(JSON.stringify(await ask(users.mgrD2, "list the people in IT Support"))).not.toMatch(/Alice|Bob|Tina/);
  });

  test("plain department-name questions and tool-less questions still behave", async () => {
    expect((await ask(users.admin, "tell me the department names?")).intent).toBe("list_departments");
    expect((await ask(users.admin, "Explain the manager dashboard")).intent).not.toBe("people_directory");
    expect((await ask(users.empA, "How do I view my profile?")).intent).toBe("view_profile");
  });
});
