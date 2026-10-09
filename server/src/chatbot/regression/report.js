// Accuracy numbers and the three reports (text, JSON, CSV) for the chatbot regression suite.
const fs = require("fs");
const path = require("path");

const REPORT_DIR = path.resolve(__dirname, "../../../reports");
const ROLES = ["EMPLOYEE", "TEAMLEAD", "MANAGER", "ADMIN"];
const ROLE_TITLE = { EMPLOYEE: "EMPLOYEE", TEAMLEAD: "TEAM LEAD", MANAGER: "MANAGER", ADMIN: "ADMIN" };
const CATEGORY_TITLE = {
  TICKET_FETCH: "Ticket Fetching", FILTERING: "Filtering", EMPLOYEE_DATA: "Employee Data", DASHBOARD: "Dashboard", NOTIFICATIONS: "Notifications",
  WORKFLOW: "Ticket Workflow", AUTHORIZATION: "Authorization", NEGATIVE: "Negative Scenarios", SECURITY: "Security / Prompt Bypass", SHORT_FORMS: "Short Forms", ROLE_HOME: "Role-based Home", FALLBACK_UX: "Fallback / Suggestions", UNKNOWN_QUERY: "Unknown Queries",
  CONVERSATION: "Conversation Context", NL_VARIATION: "Natural Language Variation", AMBIGUOUS: "Ambiguous Queries", INVALID_DATA: "Invalid Data", ROLE_SWITCH: "Role Switch",
};
const DIM_TITLE = { intent: "Intent Accuracy", entity: "Entity Accuracy", filter: "Filter Accuracy", data: "Data Accuracy", authorization: "Authorization Accuracy", action: "Action Accuracy", fallback: "Fallback/Suggestion Accuracy", conversation: "Conversation Accuracy" };

// accuracy = passed_tests / executed_tests * 100
function calculateAccuracy(rows) {
  const executed = rows.length;
  const passed = rows.filter((r) => r.status === "PASS").length;
  return { executed, passed, failed: executed - passed, accuracy: executed ? Math.round((passed / executed) * 10000) / 100 : null };
}
const fmt = (a) => (a.accuracy === null ? "n/a" : `${a.accuracy.toFixed(2)}%`);
const groupBy = (rows, fn) => rows.reduce((m, r) => ((m[fn(r)] = m[fn(r)] || []).push(r), m), {});
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

function summarize(results) {
  const roles = {};
  for (const role of ROLES) {
    const rows = results.filter((r) => r.role === role);
    if (!rows.length) continue;
    roles[role] = {
      ...calculateAccuracy(rows),
      dimensions: Object.fromEntries(Object.keys(DIM_TITLE).map((d) => [DIM_TITLE[d], calculateAccuracy(rows.filter((r) => r.dims.includes(d)))])),
      polarity: Object.fromEntries(["POSITIVE", "NEGATIVE"].map((p) => [p, calculateAccuracy(rows.filter((r) => r.polarity === p))])),
    };
  }
  const categories = Object.fromEntries(Object.entries(groupBy(results, (r) => r.category)).map(([c, rows]) => [CATEGORY_TITLE[c] || c, calculateAccuracy(rows)]));
  const times = results.map((r) => r.responseTime).filter((x) => Number.isFinite(x));
  const per = results.reduce((n, r) => n + r.steps.length, 0);
  return {
    overall: calculateAccuracy(results),
    roles,
    categories,
    byKind: {
      "Positive Scenario Accuracy": calculateAccuracy(results.filter((r) => r.polarity === "POSITIVE")),
      "Negative Scenario Accuracy": calculateAccuracy(results.filter((r) => r.polarity === "NEGATIVE")),
      "Security Accuracy": calculateAccuracy(results.filter((r) => ["SECURITY", "AUTHORIZATION"].includes(r.category))),
      "Filtering Accuracy": calculateAccuracy(results.filter((r) => r.category === "FILTERING")),
      "Workflow Accuracy": calculateAccuracy(results.filter((r) => r.category === "WORKFLOW")),
      "Unknown Query Handling Accuracy": calculateAccuracy(results.filter((r) => r.category === "UNKNOWN_QUERY")),
    },
    responseTime: times.length ? { messages: per, averageMs: round(avg(times)), minMs: round(Math.min(...times)), maxMs: round(Math.max(...times)) } : null,
  };
}
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const round = (n) => Math.round(n * 100) / 100;

function buildReport(results) {
  const summary = summarize(results);
  const failures = results.filter((r) => r.status === "FAIL");
  const unknownQueries = results.filter((r) => r.unknownQuery).map((r) => ({ role: r.role, query: r.query, detectedIntent: r.steps[r.steps.length - 1].intent, expected: r.expected, reason: "The assistant answered 'not supported' for a request it should understand", suggestedQuery: r.suggestedQuery }));
  const securityFailures = results.filter((r) => r.security);
  const authorizationFailures = failures.filter((r) => ["AUTHORIZATION", "SECURITY"].includes(r.failType));
  const slowest = [...results].sort((a, b) => b.responseTime - a.responseTime).slice(0, 5).map((r) => ({ role: r.role, query: r.query, ms: round(r.responseTime) }));
  return {
    summary: { ...summary, slowest, generatedAt: new Date().toISOString(), result: failures.length ? "FAIL" : "PASS" },
    roles: summary.roles,
    categories: summary.categories,
    tests: results.map(({ steps, ...rest }) => ({ ...rest, responseTime: round(rest.responseTime) })),
    failures: failures.map((f) => ({ id: f.id, role: f.role, category: f.category, query: f.query, expected: f.expected, actual: f.actual, expectedIntent: f.expectedIntent, actualIntent: f.actualIntent, expectedResponseType: f.expectedOutcome, actualResponseType: f.actualOutcome, reason: f.reason, failType: f.failType, suggestedQuery: f.suggestedQuery })),
    notUnderstood: results.filter((r) => ["UNSUPPORTED", "CLARIFY"].includes(r.actualOutcome) && r.steps[r.steps.length - 1].code === "CHAT_UNSUPPORTED_INTENT").map((r) => ({ role: r.role, query: r.steps[r.steps.length - 1].say, classification: r.actualOutcome === "CLARIFY" ? "AMBIGUOUS" : "UNKNOWN", suggestedQueries: r.steps[r.steps.length - 1].suggested })),
    unknownQueries,
    securityFailures: securityFailures.map((f) => ({ id: f.id, role: f.role, query: f.query, reason: f.reason })),
    authorizationFailures: authorizationFailures.map((f) => ({ id: f.id, role: f.role, query: f.query, expected: f.expected, actual: f.actual, reason: f.reason })),
    suggestions: failures.filter((f) => f.suggestedQuery).map((f) => ({ query: f.query, suggested: f.suggestedQuery })),
  };
}

const FAIL_TYPE = { INTENT: "chatbot intent problem", DATA: "backend data / answer problem", AUTHORIZATION: "authorization / response problem", SECURITY: "authorization problem (data leaked)", FILTERING: "filtering problem", FORMAT: "response formatting problem", WORKFLOW: "workflow problem", INFRA: "test infrastructure problem" };

function renderText(rep) {
  const L = [];
  const bar = "=".repeat(50);
  const s = rep.summary;
  L.push(bar, "SOLVORA CHATBOT REGRESSION REPORT", bar, "", `Total Tests: ${s.overall.executed}`, `Passed: ${s.overall.passed}`, `Failed: ${s.overall.failed}`, `Overall Accuracy: ${fmt(s.overall)}`, "");
  for (const [role, a] of Object.entries(rep.roles)) {
    L.push(ROLE_TITLE[role], "-".repeat(ROLE_TITLE[role].length), `Tests: ${a.executed}`, `Passed: ${a.passed}`, `Failed: ${a.failed}`, `Accuracy: ${fmt(a)}`);
    for (const [d, v] of Object.entries(a.dimensions)) if (v.executed) L.push(`  ${d}: ${fmt(v)} (${v.passed}/${v.executed})`);
    L.push("");
  }
  L.push(bar, "CATEGORY ACCURACY", "");
  for (const [c, v] of Object.entries(rep.categories)) L.push(`${(c + ":").padEnd(32)}${fmt(v)}  (${v.passed}/${v.executed})`);
  L.push("");
  for (const [c, v] of Object.entries(s.byKind)) if (v.executed) L.push(`${(c + ":").padEnd(36)}${fmt(v)}  (${v.passed}/${v.executed})`);
  L.push("", bar, "RESPONSE TIME", s.responseTime ? `Average ${s.responseTime.averageMs} ms, min ${s.responseTime.minMs} ms, max ${s.responseTime.maxMs} ms (per scenario)` : "n/a", "Slowest:", ...s.slowest.map((x) => `  ${x.ms} ms  ${x.role}  ${x.query}`), "", bar, "FAILED TESTS", "");
  rep.failures.forEach((f, i) => L.push(`${i + 1}. ${ROLE_TITLE[f.role]}  [${FAIL_TYPE[f.failType] || f.failType}]`, `   Query: "${f.query}"`, `   Expected intent: ${f.expectedIntent || "(any)"}   Actual intent: ${f.actualIntent}`, `   Expected response type: ${f.expectedResponseType || "(answer)"}   Actual: ${f.actualResponseType}`, `   Actual: ${f.actual}`, `   Reason: ${f.reason}`, `   Suggested query: ${f.suggestedQuery || "(none)"}`, ""));
  if (!rep.failures.length) L.push("None", "");
  L.push(bar, "NOT UNDERSTOOD QUERIES (expected to be understood)", "");
  rep.unknownQueries.forEach((u, i) => L.push(`${i + 1}. ${ROLE_TITLE[u.role]}: "${u.query}"`, `   Suggested: ${u.suggestedQuery ? `"${u.suggestedQuery}"` : "(none offered)"}`, ""));
  if (!rep.unknownQueries.length) L.push("None", "");
  L.push(bar, "SECURITY FAILURES", "", `Total: ${rep.securityFailures.length}`, ...rep.securityFailures.map((f) => `  ${ROLE_TITLE[f.role]}: "${f.query}" - ${f.reason}`), "", "AUTHORIZATION FAILURES (wrong or unclear denial)", "", `Total: ${rep.authorizationFailures.length}`, ...rep.authorizationFailures.map((f) => `  ${ROLE_TITLE[f.role]}: "${f.query}" - ${f.reason}`), "", bar, `OVERALL RESULT: ${s.result}`, bar);
  return `${L.join("\n")}\n`;
}

function renderCsv(rep) {
  const head = ["Role", "Category", "Query", "Expected", "Actual", "Status", "Reason", "SuggestedQuery", "ResponseTime", "TestName"];
  const rows = rep.tests.map((t) => [t.role, t.category, t.query, t.expected, t.actual, t.status, t.reason, t.suggestedQuery, t.responseTime, t.name]);
  return `${[head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

function writeReports(results) {
  const rep = buildReport(results);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "chatbot-regression-report.json"), `${JSON.stringify(rep, null, 2)}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, "chatbot-regression-report.txt"), renderText(rep));
  fs.writeFileSync(path.join(REPORT_DIR, "chatbot-regression-results.csv"), renderCsv(rep));
  // Every query the assistant answered with "not understood" or a clarification: the learning dataset to review (not to turn into keyword rules blindly).
  fs.writeFileSync(path.join(REPORT_DIR, "chatbot-not-understood.json"), `${JSON.stringify(rep.notUnderstood, null, 2)}
`);
  return rep;
}

module.exports = { calculateAccuracy, generateRegressionReport: writeReports, buildReport, renderText, REPORT_DIR };
