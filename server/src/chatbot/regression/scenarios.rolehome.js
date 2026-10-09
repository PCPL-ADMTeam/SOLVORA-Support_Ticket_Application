// The role-based home: every quick action works for the role it is offered to, the "What I can do"
// list matches the role, role-specific access-denied answers, and the new dashboard-style answers.
const { add, each, web, status, prio, noWrite } = require("./scenarios");
const { WHO, OUTSIDE_BI } = require("./data");
const { getSuggestions } = require("../suggestions");
const { HOME } = require("../roleHome");
const dashboardService = require("../../services/dashboard.service");
const { getAccessibleTickets, numbers } = require("./harness");

const ROLES = ["EMPLOYEE", "TEAMLEAD", "MANAGER", "ADMIN"];
const ROLE_LABEL = { EMPLOYEE: "Employee", TEAMLEAD: "Team Lead", MANAGER: "Manager", ADMIN: "Admin" };

// ---- every quick action, as the role it is offered to -------------------------------------
each(ROLES, (role) => {
  for (const qa of HOME[role].quickActions) {
    add(role, "ROLE_HOME", `Quick action "${qa.label}" works for ${ROLE_LABEL[role]} ("${qa.prompt}")`, {
      say: qa.prompt,
      outcome: ["DATA", "NO_DATA", "CLARIFY"],
      check: (r) => (/permission|don't have access|can't help|not sure what you're looking for/i.test(r.message) ? "the quick action was refused or not understood" : null),
    });
  }
  add(role, "ROLE_HOME", "The home is built from the authenticated role: 4-6 quick actions, a role greeting, a role capability list", {
    say: "help",
    outcome: "DATA",
    check: () => {
      const intro = getSuggestions(WHO[role]);
      const n = intro.quickActions.length;
      if (n < 4 || n > 6) return `expected 4-6 quick actions, got ${n}`;
      if (intro.role !== role) return "the intro did not come from the authenticated role";
      if (!/How can I help you/.test(intro.welcomeSubtitle)) return "no role greeting";
      if (!intro.capabilities.length) return "no capabilities for the Info panel";
      return null;
    },
  });
});

// The Info panel and quick actions never claim what the role cannot do.
add("EMPLOYEE", "ROLE_HOME", "Employee home never offers department, assignment or user features", {
  say: "help", outcome: "DATA",
  check: () => {
    const text = JSON.stringify(getSuggestions(WHO.EMPLOYEE).capabilities) + JSON.stringify(getSuggestions(WHO.EMPLOYEE).quickActions);
    return /department tickets|assign,|reassign|transfer|workload|employees|users|managers/i.test(text) ? "the Employee home mentions something an Employee cannot use" : null;
  },
});
add("ADMIN", "ROLE_HOME", "Admin home never offers raising, assigning or transferring tickets (the application does not allow it)", {
  say: "help", outcome: "DATA",
  check: () => {
    const text = JSON.stringify(getSuggestions(WHO.ADMIN).capabilities) + JSON.stringify(getSuggestions(WHO.ADMIN).quickActions);
    return /raise|assign|reassign|transfer/i.test(text) ? "the Admin home mentions something an Admin cannot do" : null;
  },
});
each(["TEAMLEAD", "MANAGER"], (role) => {
  add(role, "ROLE_HOME", `${ROLE_LABEL[role]} home does not offer user or role administration`, {
    say: "help", outcome: "DATA",
    check: () => {
      const text = JSON.stringify(getSuggestions(WHO[role]).capabilities) + JSON.stringify(getSuggestions(WHO[role]).quickActions);
      return /create users|change roles|all users|system-wide/i.test(text) ? "the home mentions administration the role does not have" : null;
    },
  });
});

// ---- access denied: each role's own wording, with working suggestions -----------------------
const DENIED_TEXT = { EMPLOYEE: /Employee portal/, TEAMLEAD: /assigned department/, MANAGER: /authorized departments/ };
each(["EMPLOYEE", "TEAMLEAD", "MANAGER"], (role) => {
  add(role, "AUTHORIZATION", "Another department's tickets: this role's own refusal, with suggestions that work", {
    say: "Show Hardware tickets", outcome: "DENIED", suggestions: true, noLeak: [...OUTSIDE_BI.numbers, ...OUTSIDE_BI.titles, "403", "Forbidden"],
    check: (r) => (DENIED_TEXT[role].test(r.message) ? null : "the refusal does not use this role's wording"),
  });
});
add("MANAGER", "AUTHORIZATION", "Manager's suggestions offer only the departments they can reach", {
  say: "Show HR tickets", outcome: "DENIED",
  check: (r) => ((r.suggestedActions || []).some((a) => /Hardware|HR\b/.test(a.prompt)) ? "suggested a department the Manager cannot reach" : (r.suggestedActions || []).some((a) => /BI\/Copilot/.test(a.prompt)) ? null : "did not suggest the Manager's own department"),
});
add("EMPLOYEE", "AUTHORIZATION", "Employee asking for department-wide data is refused in the Employee portal's words", {
  say: "Show all department tickets", outcome: "DENIED", has: "Employee portal",
});

// ---- latest ticket, summaries, workload, "who" and workflow ---------------------------------------
add("EMPLOYEE", "TICKET_FETCH", "Show my latest ticket: exactly one, from my own tickets", {
  say: "Show my latest ticket", outcome: "DATA", intent: "list_tickets",
  check: async (r) => {
    const mine = numbers(await getAccessibleTickets("EMPLOYEE"));
    const got = (r.data?.tickets || []).map((t) => t.ticketNumber);
    return got.length === 1 && mine.includes(got[0]) ? null : `expected one of my tickets, got [${got.join(",")}]`;
  },
});
add("EMPLOYEE", "TICKET_FETCH", "What is the status of my latest ticket?", {
  say: "What is the status of my latest ticket?", outcome: "DATA", intent: "list_tickets",
  check: (r) => ((r.data?.tickets || []).length === 1 && !/Understanding ticket status/.test(r.message) ? null : "answered with the status definitions instead of the ticket"),
});
add("MANAGER", "TICKET_FETCH", "Show the latest ticket in my departments", { say: "Show the latest ticket", outcome: "DATA", check: (r) => ((r.data?.tickets || []).length === 1 ? null : "expected exactly one ticket") });
each(ROLES, (role) => {
  const group = (rows, pick) => rows.reduce((m, t) => ((m[pick(t)] = (m[pick(t)] || 0) + 1), m), {});
  add(role, "DASHBOARD", role === "EMPLOYEE" ? "Show tickets by priority matches the dashboard service" : "Show priority summary matches the dashboard service", {
    say: role === "EMPLOYEE" ? "Show tickets by priority" : "Show priority summary", outcome: "DATA", intent: "dashboard_overview",
    check: async (r) => {
      const rows = await getAccessibleTickets(role);
      const want = group(rows, (t) => t.priority.name);
      const bad = Object.entries(want).filter(([name, n]) => !r.message.includes(`${name}: ${n}`));
      return bad.length ? `expected ${bad.map(([k, v]) => `${k}: ${v}`).join(", ")} in "${r.message.replace(/\n/g, " / ")}"` : null;
    },
  });
  add(role, "DASHBOARD", "Show status summary matches the dashboard service", {
    say: "Show status summary", outcome: "DATA", intent: "dashboard_overview",
    check: async (r) => {
      const rows = await getAccessibleTickets(role);
      const LABEL = { OPEN: "Open", IN_PROGRESS: "In Progress", ON_HOLD: "On Hold", RESOLVED: "Resolved", CLOSED: "Closed", REOPENED: "Reopened" };
      const want = group(rows, (t) => t.status);
      const bad = Object.entries(want).filter(([s, n]) => !r.message.includes(`${LABEL[s]}: ${n}`));
      return bad.length ? `expected ${bad.map(([k, v]) => `${LABEL[k]}: ${v}`).join(", ")} in "${r.message.replace(/\n/g, " / ")}"` : null;
    },
  });
});
add("EMPLOYEE", "AUTHORIZATION", "Employee workload is refused", { say: "Show employee workload", outcome: "DENIED" });
each(["TEAMLEAD", "MANAGER", "ADMIN"], (role) => {
  const canned = {
    kpis: { total: 1 }, byStatus: [], byPriority: [], trend: [],
    workload: role === "ADMIN" ? [] : [{ agentId: "u_jamie", agentName: "Jamie User", openTickets: 2, inProgressTickets: 1, resolvedTickets: 0, closedTickets: 3 }],
    departmentWorkload: role === "ADMIN" ? [{ departmentId: "dept_bi", departmentName: "BI/Copilot", openTickets: 3, inProgressTickets: 1, resolvedTickets: 1, closedTickets: 1 }] : [],
  };
  add(role, "DASHBOARD", role === "ADMIN" ? "Show department workload lists each department" : "Show employee workload lists the employees", {
    say: role === "ADMIN" ? "Show department workload" : "Show employee workload", outcome: "DATA", intent: "dashboard_overview",
    // The workload comes from raw SQL in the dashboard service, which the in-memory database cannot run: its answer is supplied here.
    before: () => jest.spyOn(dashboardService, "getStats").mockResolvedValue(canned),
    check: (r) => (r.message.includes(role === "ADMIN" ? "BI/Copilot: 3 open" : "Jamie User: 2 open") ? null : "workload numbers were not shown"),
  });
});
add("TEAMLEAD", "DASHBOARD", "Another department's workload is refused", { say: "Show employee workload in Hardware", outcome: "DENIED", noLeak: ["Manoj Kumar S", "Hari Manager"] });

each(["TEAMLEAD", "MANAGER", "ADMIN"], (role) => {
  add(role, "EMPLOYEE_DATA", "Search employee asks who", { say: "Search employee", outcome: "CLARIFY", has: "Which employee" });
  add(role, "EMPLOYEE_DATA", "Show tickets assigned to an employee asks who", { say: "Show tickets assigned to an employee", outcome: "CLARIFY", has: "Which employee" });
});
add("EMPLOYEE", "AUTHORIZATION", "Search employee is refused for an Employee", { say: "Search employee", outcome: "DENIED" });
each(ROLES, (role) => {
  add(role, "NL_VARIATION", "Explain ticket workflow explains the statuses", { say: "Explain ticket workflow", intent: "status_definition", outcome: "DATA" });
  add(role, "NL_VARIATION", "Show recently created tickets lists accessible tickets, never others", {
    say: "Show recently created tickets", outcome: "DATA", intent: "list_tickets", allPages: true,
    check: async (r, ctx, st) => {
      const allowed = numbers(await getAccessibleTickets(role));
      const extra = st.nums.filter((n) => !allowed.includes(n));
      return extra.length ? `listed tickets outside the user's access: ${extra.join(",")}` : null;
    },
    checkType: "SECURITY",
  });
});

// ---- "Show me the things from last time": suggestions about recent things -------------------------
each(ROLES, (role) => {
  add(role, "FALLBACK_UX", 'Time-based wording gets recent-tickets suggestions that work: "Show me the things from last time."', {
    say: "Show me the things from last time.", outcome: ["UNSUPPORTED", "CLARIFY"], suggestions: true, has: "not sure",
    check: (r) => ((r.suggestedActions || []).some((a) => /recent|latest|updated recently/i.test(a.prompt)) ? null : "no suggestion about recent tickets"),
  });
});

void [status, prio, noWrite];
