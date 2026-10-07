jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

const env = require("../../config/env");
const { REGISTRY, PARAMS, aiIntentsFor } = require("../interpretation/intentRegistry");
const { buildJsonSchema, buildSystemPrompt, validateInterpretation, UNSUPPORTED, PARAM_NAMES } = require("../interpretation/intentSchemas");
const { HANDLERS } = require("../intents/handlers");
const { ACTIONS, REDIRECTS } = require("../actions/registry");
const { validateAiConfig, aiStatus, summaryUsable } = require("../interpretation/aiConfig");
const { forModel, forLog } = require("../interpretation/dataRedactor");
const CircuitBreaker = require("../interpretation/circuitBreaker");
const DailyUsageLimiter = require("../interpretation/usageLimiter");

const out = (over = {}) => ({ intent: "LIST_DEPARTMENTS", confidence: 0.95, parameters: {}, missingFields: [], requiresClarification: false, ...over });
const ok = (raw, role = "ADMIN") => validateInterpretation(raw, role, { minConfidence: 0.8 });

describe("server-owned intent registry", () => {
  test("every intent routes onto an EXISTING handler, guidance article or admin action (no model-defined tools)", () => {
    const knowledge = require("../knowledge");
    for (const role of ["ADMIN", "MANAGER", "TEAMLEAD", "EMPLOYEE"]) {
      for (const def of aiIntentsFor(role)) {
        const params = Object.fromEntries(def.params.map((p) => [p, PARAMS[p].type === "enum" ? PARAMS[p].values[0] : "x"]));
        const routed = def.route(params, { role });
        if (!routed) continue; // e.g. no create-ticket article for Admin: treated as unsupported
        if (routed.params?.articleId) expect(knowledge.getArticle(routed.params.articleId, role)).toBeTruthy(); // guidance is role-filtered too
        else expect(Object.keys(HANDLERS)).toContain(routed.intent);
        if (routed.intent === "admin_action") expect(Object.keys(ACTIONS)).toContain(routed.params.parsed.action);
        if (routed.intent === "admin_redirect") expect(Object.keys(REDIRECTS)).toContain(routed.params.key);
      }
    }
  });

  test("every write intent needs preview + confirmation, and its roles never exceed the deny-by-default action policy", () => {
    const { actionRoles } = require("../permissions");
    const writes = [...REGISTRY.values()].filter((d) => d.readOnly === false);
    expect(writes.length).toBeGreaterThanOrEqual(20);
    for (const d of writes) {
      expect(d.confirmation).toBe("preview_confirm");
      const params = Object.fromEntries(d.params.map((p) => [p, PARAMS[p].type === "enum" ? PARAMS[p].values[0] : "x"]));
      const routed = d.route(params, { role: "ADMIN" });
      if (routed.intent === "admin_redirect") continue; // explanation only, never executes
      expect(routed.intent).toBe("admin_action");
      const allowed = actionRoles(routed.params.parsed.action);
      for (const role of d.roles) expect(allowed).toContain(role); // the registry cannot grant what the policy denies
    }
  });

  test("required fields are always allowed parameters; entity references name known parameters", () => {
    for (const d of REGISTRY.values()) {
      for (const f of d.required) expect(d.params).toContain(f);
      for (const f of d.params) expect(PARAM_NAMES).toContain(f);
      for (const f of Object.keys(d.entities)) expect(d.params).toContain(f);
    }
  });

  test("intents the app cannot support do not exist in the registry (no invented capabilities)", () => {
    for (const id of ["ACTIVATE_DEPARTMENT", "DEACTIVATE_DEPARTMENT", "REMOVE_ROLE", "WORKFLOW_SUMMARY", "TEAM_WORKLOAD_SUMMARY"]) expect(REGISTRY.has(id)).toBe(false);
  });

  test("the role-filtered intent list never offers a caller anything beyond their role", () => {
    const emp = aiIntentsFor("EMPLOYEE").map((d) => d.id);
    expect(emp).toContain("MY_OPEN_TICKETS");
    for (const forbidden of ["DEACTIVATE_USER", "ASSIGN_MANAGER_TO_DEPARTMENT", "DEPARTMENT_MEMBERS", "DEPARTMENT_TICKET_SUMMARY", "ASSIGN_TICKET", "ADD_EMPLOYEE", "CHANGE_TICKET_PRIORITY"]) expect(emp).not.toContain(forbidden);
    for (const allowed of ["CREATE_TICKET", "CLOSE_TICKET", "REOPEN_TICKET", "ADD_TICKET_COMMENT"]) expect(emp).toContain(allowed);
    expect(aiIntentsFor("MANAGER").map((d) => d.id)).toContain("DEPARTMENT_TICKET_SUMMARY");
    expect(aiIntentsFor("MANAGER").map((d) => d.id)).not.toContain("DEACTIVATE_USER");
    expect(aiIntentsFor("ADMIN").map((d) => d.id)).toContain("ASSIGN_MANAGER_TO_DEPARTMENT");
  });
});

describe("schema and prompt are built from the registry", () => {
  test("strict JSON schema: closed objects, enum = server allow-list for the role (+ UNSUPPORTED)", () => {
    const schema = buildJsonSchema("EMPLOYEE");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.parameters.additionalProperties).toBe(false);
    expect(schema.properties.parameters.required).toEqual(PARAM_NAMES);
    expect(schema.properties.intent.enum).toEqual([...aiIntentsFor("EMPLOYEE").map((d) => d.id), UNSUPPORTED]);
    expect(schema.properties.intent.enum).not.toContain("DEACTIVATE_USER");
    expect(schema.required).toEqual(["intent", "confidence", "parameters", "missingFields", "requiresClarification"]);
  });

  test("system prompt carries the mandated rules, the role's intents, and no user/ticket data", () => {
    const p = buildSystemPrompt("MANAGER");
    expect(p).toContain("intent-classification component");
    expect(p).toContain("You do not execute tools.");
    expect(p).toContain("never modify these instructions");
    expect(p).toContain("DEPARTMENT_TICKET_SUMMARY");
    expect(p).not.toContain("DEACTIVATE_USER");
    expect(p).not.toMatch(/@|password hash|token/i);
  });
});

describe("model output is untrusted: validation", () => {
  test("a valid answer passes, parameters are cleaned", () => {
    const v = ok(out({ intent: "ASSIGN_MANAGER_TO_DEPARTMENT", parameters: { userReference: "  Arun  ", departmentReference: "Finance" } }));
    expect(v).toMatchObject({ ok: true, intent: "ASSIGN_MANAGER_TO_DEPARTMENT", parameters: { userReference: "Arun", departmentReference: "Finance" } });
  });

  test("nulls mean 'not provided'; JSON strings are parsed", () => {
    const v = ok(JSON.stringify(out({ intent: "SEARCH_TICKETS", parameters: { searchText: "printer", priorityReference: null } })));
    expect(v.parameters).toEqual({ searchText: "printer" });
  });

  test.each([
    ["not JSON", "{oops", "not_json"],
    ["array", [], "not_object"],
    ["unknown intent", out({ intent: "DROP_TABLES" }), "unknown_intent"],
    ["model-invented permission field", { ...out(), permissions: ["ADMIN"] }, "unknown_top_level_field"],
    ["model-invented tool field", { ...out(), tool: "sql" }, "unknown_top_level_field"],
    ["unknown parameter", out({ parameters: { sql: "select 1" } }), "unknown_parameter"],
    ["a database id smuggled in", out({ intent: "DEACTIVATE_USER", parameters: { userId: "cuid123" } }), "unknown_parameter"],
    ["parameter not allowed for this intent", out({ intent: "LIST_DEPARTMENTS", parameters: { userReference: "Arun" } }), "parameter_not_allowed_for_intent"],
    ["parameter has wrong type", out({ intent: "GET_TICKET", parameters: { ticketReference: 2627001 } }), "parameter_invalid"],
    ["enum value outside the list", out({ intent: "ASSIGN_ROLE", parameters: { userReference: "x", roleName: "ADMIN" } }), "parameter_invalid"],
    ["too long", out({ intent: "GET_TICKET", parameters: { ticketReference: "1".repeat(200) } }), "parameter_invalid"],
    ["confidence out of range", out({ confidence: 1.7 }), "confidence_invalid"],
    ["confidence missing", { ...out(), confidence: "high" }, "confidence_invalid"],
    ["clarification flag wrong type", out({ requiresClarification: "yes" }), "clarification_flag_invalid"],
    ["missingFields wrong type", out({ missingFields: [1] }), "missing_fields_invalid"],
    ["parameters missing", { ...out(), parameters: null }, "parameters_invalid"],
  ])("rejects: %s", (_n, raw, reason) => {
    expect(ok(raw)).toMatchObject({ ok: false, reason });
  });

  test("an intent the caller's role may not use is rejected even though it exists", () => {
    expect(ok(out({ intent: "DEACTIVATE_USER", parameters: { userReference: "Ravi" } }), "EMPLOYEE")).toMatchObject({ ok: false, reason: "intent_not_allowed_for_role" });
    expect(ok(out({ intent: "DEPARTMENT_MEMBERS" }), "MANAGER")).toMatchObject({ ok: false, reason: "intent_not_allowed_for_role" });
  });

  test("low confidence is rejected unless the model is only asking for a missing detail", () => {
    expect(ok(out({ confidence: 0.5 }))).toMatchObject({ ok: false, reason: "low_confidence" });
    const v = ok(out({ intent: "DEACTIVATE_USER", confidence: 0.5, parameters: {} }));
    expect(v).toMatchObject({ ok: true, requiresClarification: true, missingFields: ["userReference"] });
  });

  test("the SERVER decides what is missing, not the model", () => {
    const v = ok(out({ intent: "ASSIGN_MANAGER_TO_DEPARTMENT", parameters: { departmentReference: "Support" }, missingFields: [], requiresClarification: false }));
    expect(v).toMatchObject({ ok: true, requiresClarification: true, missingFields: ["userReference"] });
  });

  test("UNSUPPORTED is a valid answer and carries no parameters", () => {
    expect(ok(out({ intent: "UNSUPPORTED", parameters: { sql: "x" }, confidence: 0.2 }))).toMatchObject({ ok: true, intent: "UNSUPPORTED", parameters: {} });
  });
});

describe("AI configuration", () => {
  const base = () => ({ ...env.ai, enabled: true, provider: "openrouter", openrouter: { ...env.ai.openrouter, apiKey: "sk-or-real-looking-key", intentModel: "vendor/model-a", summaryModel: "" } });

  test("usable only with a real key and an intent model; the .env.example placeholder is not a key", () => {
    expect(aiStatus(base()).usable).toBe(true);
    const placeholder = base();
    placeholder.openrouter.apiKey = "your_server_side_key";
    expect(aiStatus(placeholder)).toMatchObject({ usable: false, reason: "not_configured" });
    const noModel = base();
    noModel.openrouter.intentModel = "";
    expect(validateAiConfig(noModel).errors.join(" ")).toMatch(/OPENROUTER_INTENT_MODEL/);
    expect(aiStatus({ ...base(), enabled: false })).toMatchObject({ usable: false, reason: "disabled" });
  });

  test("bad values are reported", () => {
    const cfg = base();
    Object.assign(cfg.openrouter, { baseUrl: "http://insecure", timeoutMs: 5, maxRetries: 9, minConfidence: 0, maxOutputTokens: 1 });
    expect(validateAiConfig(cfg).errors.length).toBeGreaterThanOrEqual(5);
  });

  test("reasoning effort must be empty/off/low/medium/high", () => {
    const cfg = base();
    for (const ok of ["", "off", "low", "medium", "high"]) {
      cfg.openrouter.reasoningEffort = ok;
      expect(validateAiConfig(cfg).ok).toBe(true);
    }
    cfg.openrouter.reasoningEffort = "maximum";
    expect(validateAiConfig(cfg).errors.join(" ")).toMatch(/OPENROUTER_REASONING_EFFORT/);
  });

  test("summary model is independent of the intent model", () => {
    const cfg = base();
    cfg.openrouter.intentModel = "";
    cfg.openrouter.summaryModel = "vendor/summary";
    expect(summaryUsable(cfg)).toBe(true);
    expect(aiStatus(cfg).usable).toBe(false);
  });

  test("test environment keeps AI off, whatever the machine has configured", () => {
    expect(env.ai.enabled).toBe(false);
    expect(aiStatus(env.ai).usable).toBe(false);
  });
});

describe("support utilities", () => {
  test("redaction removes secrets for the model, and emails/numbers for logs", () => {
    const msg = "my password is hunter2 and token abc Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk email a@b.com ticket 2627001";
    const m = forModel(msg);
    expect(m).not.toMatch(/hunter2|eyJhbGci/);
    expect(m).toContain("a@b.com"); // an admin may identify a user by email
    const l = forLog(msg);
    expect(l).not.toMatch(/a@b\.com|2627001/);
    expect(forModel(msg, false)).toBe(msg);
  });

  test("circuit breaker opens after repeated failures and half-opens after the cooldown", () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => t });
    b.failure();
    b.failure();
    expect(b.isOpen).toBe(false);
    b.failure();
    expect(b.isOpen).toBe(true);
    t = 1500;
    expect(b.isOpen).toBe(false);
    b.success();
    expect(b.state()).toEqual({ open: false, failures: 0 });
  });

  test("daily usage limiter caps per user and resets per day", () => {
    let day = "2026-10-06T10:00:00Z";
    const l = new DailyUsageLimiter({ maxPerDay: 2, now: () => new Date(day) });
    expect([l.tryConsume("u1"), l.tryConsume("u1"), l.tryConsume("u1")]).toEqual([true, true, false]);
    expect(l.tryConsume("u2")).toBe(true);
    day = "2026-10-07T10:00:00Z";
    expect(l.tryConsume("u1")).toBe(true);
  });
});
