jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// Accuracy suite: natural-language questions run END TO END (rules -> entity resolution against
// the data -> role scope -> tools -> answer) for every role, with follow-ups and ambiguity.
// Every case is checked and counted; the run writes docs/chatbot-accuracy-report.md with the
// totals and, for every failure, what was expected and what happened.

const fs = require("fs");
const path = require("path");
const service = require("../chatbot.service");
const { classify } = require("../intents/router");
const { users } = require("../testkit/fixtures");

const { seed, P, BI, HW, CLOUD, db } = require("../testkit/orgData");

const WHO = { ADMIN: users.admin, MANAGER: P.mgrBI, TEAMLEAD: P.tlBI, EMPLOYEE: P.empBI };
const nums = (r) => (r.data?.tickets || r.data?.summaries || []).map((t) => t.ticketNumber).sort();
const ALL_BI = ["2600269", "2600270", "2600271", "2600272"];

// A case is one conversation: steps run in order and share a conversation id.
// Step expectations: intent, has[], not[], tickets[] (exact set), total, code.
const CASES = [
  // ---- tickets: the logged-in user ("my", "me", "I") ----
  ...["show my tickets", "give me my tickets", "list my tickets", "what tickets have I raised", "show tickets raised by me", "what support requests did I create"].map((text) => ({
    name: `Employee: ${text}`, role: "EMPLOYEE", steps: [{ say: text, intent: "list_tickets", tickets: ["2600269", "2600270", "2600272"] }],
  })),
  { name: "Employee: show my open tickets", role: "EMPLOYEE", steps: [{ say: "show my open tickets", tickets: ["2600269", "2600270"] }] },
  { name: "Employee: tickets assigned to me (none)", role: "EMPLOYEE", steps: [{ say: "tickets assigned to me", code: "CHAT_NO_RESULTS", has: ["assigned to you"] }] },
  { name: "Team Lead: tickets assigned to me", role: "TEAMLEAD", steps: [{ say: "show tickets assigned to me", tickets: ["2600271"] }] },
  { name: "Team Lead: tickets raised by me (none)", role: "TEAMLEAD", steps: [{ say: "what tickets have I raised", code: "CHAT_NO_RESULTS" }] },

  // ---- tickets: status ----
  { name: "Admin: show resolved tickets in BI/Copilot", role: "ADMIN", steps: [{ say: "show resolved tickets in BI/Copilot", tickets: ["2600271"] }] },
  { name: "Admin: show closed tickets in BI/Copilot", role: "ADMIN", steps: [{ say: "show closed tickets in BI/Copilot", tickets: ["2600272"] }] },
  { name: "Admin: show open tickets (several phrasings)", role: "ADMIN", steps: ["show open tickets in BI/Copilot", "what tickets are open in BI/Copilot", "list open support tickets in BI/Copilot", "give me currently open tickets in BI/Copilot"].map((say) => ({ say, tickets: ["2600269", "2600270"] })) },
  { name: "Admin: in progress", role: "ADMIN", steps: [{ say: "show in progress tickets in BI/Copilot", tickets: ["2600269"] }] },

  // ---- tickets: ticket number ----
  { name: "Admin: show ticket 2600269", role: "ADMIN", steps: [{ say: "show ticket 2600269", intent: "find_ticket", has: ["2600269", "In Progress"] }] },
  { name: "Employee: another department's ticket number is neutral", role: "EMPLOYEE", steps: [{ say: "show ticket 2600280", code: "CHAT_TICKET_NOT_FOUND", has: ["You do not have permission to access this ticket, or the ticket could not be found."] }] },

  // ---- tickets: department ----
  { name: "Admin: show tickets in Hardware", role: "ADMIN", steps: [{ say: "show tickets in Hardware", tickets: ["2600280", "2600281"] }] },
  { name: "Admin: show Hardware department tickets", role: "ADMIN", steps: [{ say: "show me the hardware department ticket", tickets: ["2600280", "2600281"] }] },
  { name: "Admin: how many open tickets are in Hardware (count only)", role: "ADMIN", steps: [{ say: "how many open tickets are in Hardware", has: ["Hardware has 1 open ticket."], total: 1, notCards: true }] },
  { name: "Admin: how many tickets in BI/Copilot", role: "ADMIN", steps: [{ say: "how many tickets in BI/Copilot", has: ["BI/Copilot has 4 tickets."], notCards: true }] },
  { name: "Admin: empty result says what was searched", role: "ADMIN", steps: [{ say: "show closed tickets in Hardware", code: "CHAT_NO_RESULTS", has: ["I couldn't find any closed tickets for Hardware"] }] },

  // ---- tickets: a named person ----
  { name: "Admin: Manoj is ambiguous, never guessed", role: "ADMIN", steps: [{ say: "show Manoj's tickets", has: ["Manoj Kumar R", "Manoj Kumar S"], noTickets: true }] },
  { name: "Admin: assigned to Manoj Kumar R", role: "ADMIN", steps: [{ say: "tickets assigned to Manoj Kumar R", tickets: ["2600269", "2600270"] }] },
  { name: "Admin: raised by Manoj Kumar R", role: "ADMIN", steps: [{ say: "tickets raised by Manoj Kumar R", tickets: ["2600271"] }] },
  { name: "Admin: Manoj Kumar R's tickets (raised or assigned)", role: "ADMIN", steps: [{ say: "show Manoj Kumar R's tickets", tickets: ["2600269", "2600270", "2600271"] }] },
  { name: "Admin: Manoj Kumar R's open tickets", role: "ADMIN", steps: [{ say: "show Manoj Kumar R's open tickets", tickets: ["2600269", "2600270"] }] },
  { name: "Admin: unknown person", role: "ADMIN", steps: [{ say: "tickets assigned to Zebedee Quux", has: ["Zebedee"], noTickets: true }] },
  { name: "Employee: cannot look up another person's tickets", role: "EMPLOYEE", steps: [{ say: "show Manoj Kumar R's tickets", code: "CHAT_ACCESS_DENIED", noTickets: true }] },

  // ---- departments and roles ----
  { name: "Admin: who is the manager in BI/Copilot", role: "ADMIN", steps: [{ say: "who is the manager in BI/Copilot", has: ["BI/Copilot", "Jayakumar J — Manager"], not: ["Pavithran", "Srihari", "Manoj"] }] },
  { name: "Admin: show me the Manager in BI/Copilot", role: "ADMIN", steps: [{ say: "show me the Manager in BI/Copilot", has: ["Jayakumar J — Manager"], not: ["Pavithran", "Srihari", "people"] }] },
  { name: "Admin: who are the managers in BI/Copilot", role: "ADMIN", steps: [{ say: "who are the managers in BI/Copilot", has: ["Jayakumar J"], not: ["Pavithran", "Srihari"] }] },
  { name: "Admin: who are the team leads in BI/Copilot", role: "ADMIN", steps: [{ say: "who are the team leads in BI/Copilot", has: ["Pavithran M — Team Lead"], not: ["Jayakumar", "Srihari"] }] },
  { name: "Admin: who are the employees in BI/Copilot", role: "ADMIN", steps: [{ say: "who are the employees in BI/Copilot", has: ["Srihari", "Manoj Kumar R"], not: ["Jayakumar", "Pavithran"] }] },
  { name: "Admin: who manages Hardware", role: "ADMIN", steps: [{ say: "who manages Hardware", has: ["Hari Manager — Manager"], not: ["Hema", "Manoj"] }] },
  { name: "Admin: show people in Cloud", role: "ADMIN", steps: [{ say: "show people in Cloud", has: ["Cora Cloud"], not: ["Srihari", "Hari Manager"] }] },
  { name: "Admin: how many people are in Hardware", role: "ADMIN", steps: [{ say: "how many people are in Hardware", has: ["Hardware has 3 people."], not: ["Hari Manager"] }] },
  { name: "Admin: how many managers in Hardware", role: "ADMIN", steps: [{ say: "how many managers are in Hardware", has: ["Hardware has 1 manager."] }] },
  { name: "Manager: sees only own department", role: "MANAGER", steps: [{ say: "who are the team leads in BI/Copilot", has: ["Pavithran M"] }, { say: "who are the team leads in Hardware", not: ["Hema", "Hari"] }] },
  { name: "Employee: people lookups are denied", role: "EMPLOYEE", steps: [{ say: "who are the managers in BI/Copilot", code: "CHAT_ACCESS_DENIED", not: ["Jayakumar"] }] },

  // ---- ambiguity: never guess ----
  { name: "Admin: show Manoj asks which one", role: "ADMIN", steps: [{ say: "show Manoj", has: ["Manoj Kumar R", "Manoj Kumar S"], noTickets: true }] },
  { name: "Admin: show manager asks which department", role: "ADMIN", steps: [{ say: "show manager", has: ["Which department"] }] },
  { name: "Admin: show people asks which department", role: "ADMIN", steps: [{ say: "show people", has: ["Which department"] }] },
  { name: "Admin: show tickets still answers (all tickets in scope)", role: "ADMIN", steps: [{ say: "show tickets", intent: "list_tickets" }] },

  // ---- follow-ups keep the previous filters ----
  { name: "Follow-up: BI/Copilot tickets -> only resolved", role: "ADMIN", steps: [{ say: "show BI/Copilot tickets", tickets: ALL_BI }, { say: "only resolved", tickets: ["2600271"] }] },
  { name: "Follow-up: BI/Copilot tickets -> only open ones", role: "ADMIN", steps: [{ say: "show BI/Copilot tickets", tickets: ALL_BI }, { say: "only open ones", tickets: ["2600269", "2600270"] }] },
  { name: "Follow-up: pick one Manoj, then only open", role: "ADMIN", steps: [{ say: "show Manoj's tickets", has: ["Manoj Kumar R"] }, { say: "1", tickets: ["2600269", "2600270", "2600271"] }, { say: "only open ones", tickets: ["2600269", "2600270"] }] },
  { name: "Follow-up: count then show them", role: "ADMIN", steps: [{ say: "how many open tickets in BI/Copilot", has: ["BI/Copilot has 2 open tickets."] }, { say: "show them", tickets: ["2600269", "2600270"] }] },
  { name: "Follow-up: people in dept -> only managers", role: "ADMIN", steps: [{ say: "who are the people in BI/Copilot", has: ["Srihari", "Jayakumar J"] }, { say: "only managers", has: ["Jayakumar J"], not: ["Srihari", "Pavithran"] }] },
  { name: "Follow-up: change the department", role: "ADMIN", steps: [{ say: "show open tickets in BI/Copilot", tickets: ["2600269", "2600270"] }, { say: "what about Hardware", tickets: ["2600280"] }] },
  { name: "Follow-up does not leak scope: Employee asks for another department", role: "EMPLOYEE", steps: [{ say: "show my tickets", tickets: ["2600269", "2600270", "2600272"] }, { say: "what about Hardware", noTickets: true }] },

  // ---- role scope for the same question ----
  { name: "Scope: Admin 'show tickets in Hardware'", role: "ADMIN", steps: [{ say: "show tickets in Hardware", tickets: ["2600280", "2600281"] }] },
  { name: "Scope: Manager (BI) 'show tickets in Hardware'", role: "MANAGER", steps: [{ say: "show tickets in Hardware", noTickets: true, not: ["Laptop order"] }] },
  { name: "Scope: Team Lead (BI) 'show tickets in Hardware'", role: "TEAMLEAD", steps: [{ say: "show tickets in Hardware", noTickets: true, not: ["Laptop order"] }] },
  { name: "Scope: Employee 'show tickets in Hardware'", role: "EMPLOYEE", steps: [{ say: "show tickets in Hardware", noTickets: true, not: ["Laptop order"] }] },
  { name: "Scope: Manager sees all BI/Copilot tickets", role: "MANAGER", steps: [{ say: "show tickets in BI/Copilot", tickets: ALL_BI }] },
  { name: "Scope: Team Lead sees all BI/Copilot tickets", role: "TEAMLEAD", steps: [{ say: "show tickets in BI/Copilot", tickets: ALL_BI }] },
  { name: "Scope: Manager count only own department", role: "MANAGER", steps: [{ say: "how many open tickets in BI/Copilot", has: ["BI/Copilot has 2 open tickets."] }] },
];

function check(step, r) {
  const problems = [];
  const text = `${r.message}`;
  if (step.intent && r.intent !== step.intent) problems.push(`intent: expected ${step.intent}, got ${r.intent}`);
  if (step.code && r.error?.code !== step.code) problems.push(`error code: expected ${step.code}, got ${r.error?.code || "none"}`);
  for (const s of step.has || []) if (!text.includes(s)) problems.push(`message should contain "${s}"`);
  for (const s of step.not || []) if (text.includes(s)) problems.push(`message must not contain "${s}"`);
  if (step.tickets) {
    const got = nums(r);
    const want = [...step.tickets].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`tickets: expected ${want.join(",")}, got ${got.join(",") || "none"}`);
  }
  if (step.noTickets && nums(r).length) problems.push(`no tickets expected, got ${nums(r).join(",")}`);
  if (step.notCards && (r.data?.tickets || []).length) problems.push("a count answer must not list tickets");
  return problems;
}

const results = [];
beforeEach(seed);

afterAll(() => {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  const lines = [
    "# Chatbot accuracy report",
    "",
    "Generated by `server/src/chatbot/__tests__/accuracy.test.js` (end-to-end: rules, entity resolution, role scope, tools). Do not edit by hand.",
    "",
    `| Total | Passed | Failed | Accuracy |`,
    `|---|---|---|---|`,
    `| ${total} | ${passed} | ${failed.length} | ${total ? ((passed / total) * 100).toFixed(1) : "0"}% |`,
    "",
    "## Cases",
    "",
    "| Result | Role | Case |",
    "|---|---|---|",
    ...results.map((r) => `| ${r.pass ? "PASS" : "FAIL"} | ${r.role} | ${r.name} |`),
  ];
  lines.push("", "## What the assistant actually answered", "");
  for (const r of results) {
    lines.push(`**${r.role}: ${r.name}**`);
    for (const d of r.transcript) lines.push(`- \`${d.say}\` -> ${d.actual}`);
    lines.push("");
  }
  if (failed.length) {
    lines.push("", "## Failures", "");
    for (const f of failed) {
      lines.push(`### ${f.name}`, `- Role: ${f.role}`, ...f.details.map((d) => `- Input: \`${d.say}\`\n  - Expected: ${d.expected}\n  - Actual intent: \`${d.intent}\` params: \`${d.params}\`\n  - Actual result: ${d.actual}\n  - Problems: ${d.problems.join("; ")}`), "");
    }
  }
  try {
    fs.writeFileSync(path.resolve(__dirname, "../../../../docs/chatbot-accuracy-report.md"), `${lines.join("\n")}\n`);
  } catch {
    // The report is a convenience; never fail a test run because it could not be written.
  }
});

describe("accuracy: natural-language questions answer exactly what was asked", () => {
  test.each(CASES.map((c) => [c.name, c]))("%s", async (_name, c) => {
    const user = WHO[c.role];
    let conversationId;
    const details = [];
    for (const step of c.steps) {
      const r = await service.sendMessage(user, { message: step.say, conversationId });
      conversationId = r.conversationId;
      const det = classify(step.say, c.role);
      const problems = check(step, r);
      details.push({
        say: step.say,
        expected: JSON.stringify({ intent: step.intent, tickets: step.tickets, has: step.has, not: step.not, code: step.code }),
        intent: r.intent,
        params: JSON.stringify(det.params).slice(0, 160),
        actual: `${String(r.message).slice(0, 160).replace(/\n/g, " / ")}${nums(r).length ? ` [tickets ${nums(r).join(",")}]` : ""}`,
        problems,
      });
      if (problems.length) break;
    }
    const pass = details.every((d) => !d.problems.length);
    results.push({ name: c.name, role: c.role, pass, details: pass ? [] : details.filter((d) => d.problems.length), transcript: details });
    expect(details.flatMap((d) => d.problems.map((p) => `${d.say}: ${p}`))).toEqual([]);
  });
});
