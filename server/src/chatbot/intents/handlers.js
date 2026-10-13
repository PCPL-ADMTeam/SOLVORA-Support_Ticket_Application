const prisma = require("../../config/prisma");
const { runTool } = require("../tools");
const { ChatError, CODES } = require("../chatbot.errors");
const { statusLabel } = require("../dto");
const { portalFor, authorizedWhere } = require("../roleScope");
const ticketService = require("../../services/ticket.service");
const { proposeAction, precheckAction, assigneeChoices } = require("../actions/actionService");
const { dashboardOverview, askPerson } = require("./overviewHandlers");
const { REDIRECTS } = require("../actions/registry");
const { resolveDepartment, resolvePriority, resolveUserArg, invalid } = require("../actions/resolvers");
const { matchDepartments } = require("../departmentMatch");
const { extractEntities, STATUS_LABEL } = require("../entities/extract");
const { toPlainText } = require("../text");
const { resolvePeriod, periodView } = require("../period");

// Each handler runs controlled tools and returns a result:
//   {
//     message,            // server-built answer ("draft"). NEVER contains
//                         // free text taken from tickets/comments — that only
//                         // appears in the structured `data` cards.
//     data,               // restricted DTOs for the UI cards
//     navigationTarget,   // permitted target from the role-filtered KB, or a ticket page
//     suggestedActions,   // [{ label, prompt }]
//     useModel,           // whether a model may rephrase `message`
//     ticketNumbers,      // authorized ticket numbers present in context
//   }
// A handler throws ChatError for refusals/not-found; the service turns that
// into a user-facing answer.

const numbered = (steps) => steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

function ticketTarget(routeId) {
  return { type: "route", path: `/tickets/${routeId}`, label: "Open ticket" };
}

function staffFollowUps(role) {
  return role === "EMPLOYEE"
    ? [{ label: "Show my open tickets", prompt: "Show my open tickets" }]
    : [
        { label: "Show unassigned tickets", prompt: "Show unassigned tickets" },
        { label: "Show tickets with no recent activity", prompt: "Show tickets with no recent activity" },
      ];
}

// ---- guidance -------------------------------------------------------------

async function guidance(ctx, params) {
  const { article } = await runTool("get_navigation_steps", ctx, { id: params.articleId });
  if (!article) throw new ChatError(CODES.UNSUPPORTED_INTENT);

  // The guide card shows the title, steps and note; the bubble only introduces it.
  const data = { article: { id: article.id, title: article.title, feature: article.feature, steps: article.steps, warning: article.warning }, headline: "Here's how to do it in Solvora." };
  const parts = [`${article.title}:`, numbered(article.steps)];
  if (article.warning) parts.push(`Note: ${article.warning}`);

  // Intents that benefit from live reference data.
  if (article.id === "common.ticket-priority") {
    const { priorities } = await runTool("get_priority_definition", ctx);
    data.priorities = priorities;
    parts.push(`Configured priorities (lowest to highest): ${priorities.map((p) => p.name).join(", ") || "none configured"}.`);
  }
  if (article.id === "common.ticket-status") {
    const { statuses } = await runTool("get_status_definition", ctx);
    data.statuses = statuses;
  }
  if (article.id === "common.sla") await runTool("get_sla_information", ctx);

  return {
    message: parts.join("\n"),
    data,
    navigationTarget: article.route,
    suggestedActions: [],
    useModel: false,
    ticketNumbers: [],
  };
}

async function viewProfile(ctx, params) {
  const base = await guidance(ctx, { articleId: "common.view-profile", ...params });
  const { profile } = await runTool("get_profile_summary", ctx);
  const lines = [
    `Name: ${profile.name || "not available"}`,
    `Email: ${profile.email || "not available"}`,
    `Role: ${profile.role}`,
    `Department: ${profile.departments.length ? profile.departments.join(", ") : "not available"}`,
  ];
  return { ...base, message: `Here is the profile I have on file for you:\n${lines.join("\n")}\n\n${base.message}`, data: { ...base.data, profile, headline: "Here is the profile I have on file for you, and how to view it." } };
}

// ---- ticket information ----------------------------------------------------

function resolveTicketNumber(ctx, params) {
  if (params.ticketNumber) return params.ticketNumber;
  if (params.useLastTicket && ctx.lastTicketNumber) return ctx.lastTicketNumber;
  // "when was the ticket created?" with no ticket in view: ask, don't call it an invalid number.
  if (params.useLastTicket || params.askTicket) throw new ChatError(CODES.ACTION_INVALID, { message: "Which ticket do you mean? Please give me the ticket number, for example: ticket 2627001." });
  throw new ChatError(CODES.INVALID_TICKET_ID, { internal: "no ticket reference" });
}

function askForTicket() {
  return {
    message: "Which ticket? Please give me the ticket number, for example: Summarize ticket 2627001.",
    data: {},
    navigationTarget: null,
    suggestedActions: [],
    useModel: false,
    ticketNumbers: [],
  };
}

const needsTicket = (ctx, p) => p.askTicket || (p.useLastTicket && !ctx.lastTicketNumber);

// Turns typed priority / department words into exact names. These only narrow
// the caller-scoped query inside the tool; they cannot widen what is visible.
// Only departments the caller may see can be named in a filter (and for them the
// tool query is still ANDed with the caller's scope).
async function visibleDepartmentNames(ctx) {
  const { scope } = ctx;
  if (scope.role === "ADMIN") return null; // every department
  if (scope.role === "EMPLOYEE") return scope.user.department?.name ? [scope.user.department.name] : [];
  if (!scope.departmentIds.length) return [];
  const rows = await prisma.department.findMany({ where: { id: { in: scope.departmentIds } }, select: { name: true } });
  return rows.map((r) => r.name);
}

async function resolveListFilters(params, ctx) {
  const out = {};
  if (params.priority) out.priority = (await resolvePriority(params.priority)).name;
  if (params.department) out.department = (await resolveDepartment(params.department, await visibleDepartmentNames(ctx))).name;
  // "hardware tickets": a department if one matches, otherwise a topic to search for.
  if (params.departmentOrText) {
    try {
      out.department = (await resolveDepartment(params.departmentOrText, await visibleDepartmentNames(ctx))).name;
    } catch {
      out.text = params.departmentOrText;
    }
  }
  return out;
}

// ---- people named in a question -------------------------------------------
// A name is only ever looked up among the people this user may see (everyone for an Admin,
// otherwise their own departments). Several matches are never guessed: the user chooses, and
// the chosen id is held server-side. Employees cannot look other people up at all.
const personScope = (ctx) => (ctx.scope.role === "ADMIN" ? null : ctx.scope.departmentIds);

async function resolvePerson(ctx, text, params = {}) {
  if (ctx.scope.role === "EMPLOYEE") {
    throw new ChatError(CODES.ACCESS_DENIED, { internal: "employee person lookup", message: "I can only show your own tickets. I can't look up other people." });
  }
  try {
    return await resolveUserArg({ user: text, userId: params.userId }, "user", (v) => String(v).trim(), personScope(ctx));
  } catch (err) {
    // Nobody by that name in the caller's departments, but a real person elsewhere: say plainly that people and
    // tickets of other departments are not available to this role, instead of "not found" or "not understood".
    // (Names are not secret here: the Raise a Ticket CC search lists every active user.) Nothing about that
    // person (department, tickets, role) is revealed.
    if (err instanceof ChatError && !err.choices?.length && personScope(ctx) && (await personOutsideScope(text))) {
      throw new ChatError(CODES.ACCESS_DENIED, { internal: "person outside the caller's departments", message: await outsideScopeMessage(ctx, text) });
    }
    throw err;
  }
}

// An active user whose name (or a word of it) starts with the text, or whose email is the text. Only called after
// the search INSIDE the caller's departments found nobody, so any match is a person outside them.
async function personOutsideScope(text) {
  const t = String(text || "").trim();
  if (t.length < 3 || t.length > 80) return false;
  const hits = await prisma.user.findMany({
    where: { isActive: true, OR: [{ email: { equals: t, mode: "insensitive" } }, { name: { startsWith: t, mode: "insensitive" } }, { name: { contains: ` ${t}`, mode: "insensitive" } }] },
    select: { id: true },
    take: 1,
  });
  return hits.length > 0;
}

async function outsideScopeMessage(ctx, text) {
  const mine = (await visibleDepartmentNames(ctx)) || [];
  const where = mine.length ? ` (${mine.join(", ")})` : "";
  const who = toPlainText(text, 60);
  return ctx.scope.role === "TEAMLEAD"
    ? `You don't have access to view employees or tickets of other departments. "${who}" isn't in your department${where}, so I can't show their details or tickets.`
    : `You don't have access to view employees or tickets of other departments. "${who}" isn't in the departments you manage${where}, so I can't show their details or tickets.`;
}

// "tickets for X" where X may be a department OR a person: real departments first.
async function resolveSubject(ctx, params) {
  const visible = await visibleDepartmentNames(ctx);
  try {
    return { department: (await resolveDepartment(params.subject, visible)).name };
  } catch (err) {
    if (!(err instanceof ChatError) || err.choices?.length) throw err;
  }
  if (ctx.scope.role === "EMPLOYEE") throw invalid(`I couldn't find a department called "${params.subject}" that you have access to.`);
  try {
    return { person: await resolvePerson(ctx, params.subject, params), relation: "either" };
  } catch (err) {
    if (err instanceof ChatError && !err.choices?.length) throw invalid(`I couldn't find a department or person called "${params.subject}" that you have access to.`);
    throw err;
  }
}

// Details the user mentioned that the rules did not already capture (layer 1).
// They only NARROW the result; the ticket tool still limits rows to the caller's scope.
async function withEntities(ctx, params, question) {
  if (!question) return { params, found: null };
  const found = await extractEntities(question, { visibleDepartments: await visibleDepartmentNames(ctx) });
  if (found.dateAmbiguous) throw new ChatError(CODES.ACTION_INVALID, { message: "I can't tell which day you mean (day/month or month/day). Please write the date like 4 Oct 2026 or 2026-10-04." });
  const out = { ...params };
  const used = [];
  if (!out.department && !out.departmentOrText && !out.skipDepartment && found.department) (out.department = found.department), used.push(`department ${found.department}`);
  if (!out.priority && found.priority) (out.priority = found.priority), used.push(`${found.priority} priority`);
  if (!out.status && (!out.filter || out.filter === "any") && found.status) (out.status = found.status), used.push(`status ${STATUS_LABEL[found.status]}`);
  if (!out.dateFrom && !out.dateTo && found.dateFrom) (out.dateFrom = found.dateFrom), (out.dateTo = found.dateTo), used.push(found.dateLabel);
  return { params: out, found, used };
}

const PAGE_SIZE = 5;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const countOf = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const titleWords = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// ---- ticket views: which tickets a list shows, its heading, and where to go next ----------------------------
//
// Each view is a distinct filter on search_authorized_tickets, always inside the signed-in user's own scope:
//   mine     -> requester = me OR assignee = me      "My Tickets" (the portal's "My Tickets" tab)
//   assigned -> assignee = me                        "Tickets Assigned to Me"
//   raised   -> requester = me                       "Tickets Raised by Me"
//   dept     -> the departments the user may see     "My Department's Tickets" (Manager / Team Lead; Admin: all)
//   named    -> one named department, inside that   "Tickets in Hardware"
//   person   -> one named person, inside that        "Tickets assigned to Ravi"
function ticketView(params, filters, person) {
  if (person) return "person";
  if (params.mine === "assignee") return "assigned";
  if (params.mine === "requester") return "raised";
  if (params.scope === "mine") return "mine";
  return filters.department ? "named" : "dept";
}

function viewTitle(view, kind, { role, department, who }) {
  const k = titleWords(kind); // "Tickets", "Open Tickets", "High Priority Tickets"
  const where = department ? ` in ${department}` : "";
  if (view === "mine") return `My ${k}${where}`;
  if (view === "assigned") return `${k} Assigned to Me${where}`;
  if (view === "raised") return `${k} Raised by Me${where}`;
  if (view === "dept") return role === "ADMIN" ? `All ${k}` : `My Department's ${k}`;
  if (view === "named") return `${k}${where}`;
  return `${cap(kind)} ${who}${where}`;
}

// "your department (BI/Copilot)" / "your departments (BI/Copilot, Hardware)": what "my department" covered.
function departmentScopeText(names) {
  if (!names?.length) return "your department";
  const shown = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
  return `your department${names.length === 1 ? "" : "s"} (${shown})`;
}

// One-click switches to the other views. Only views this role can use are offered: Employees have no department
// view, a Manager is never a ticket's assignee, and an Admin neither raises nor is assigned tickets. Each prompt is
// an ordinary question, classified afresh, so it runs the same filter as typing it.
const VIEW_SWITCHES = {
  mine: { label: "My Tickets", prompt: "Show my tickets" },
  assigned: { label: "Assigned to Me", prompt: "Show tickets assigned to me" },
  raised: { label: "Raised by Me", prompt: "Show tickets raised by me" },
  dept: { label: "My Department's Tickets", prompt: "Show my department's tickets" },
  deptOpen: { label: "Open in My Department", prompt: "Show open tickets in my department" },
  mineOpen: { label: "My Open Tickets", prompt: "Show my open tickets" },
  mineUnresolved: { label: "My Unresolved Tickets", prompt: "Show my unresolved tickets" },
  // An Admin's views (every department).
  allTickets: { label: "All Tickets", prompt: "Show all tickets" },
  allOpen: { label: "All Open Tickets", prompt: "Show all open tickets" },
  unassigned: { label: "Unassigned Tickets", prompt: "Show unassigned tickets" },
};
const NEXT_VIEWS = {
  mine: ["assigned", "raised", "dept"],
  dept: ["assigned", "raised", "deptOpen"],
  named: ["dept", "assigned", "raised"],
  assigned: ["raised", "dept", "mineOpen"],
  raised: ["assigned", "dept", "mineUnresolved"],
  person: ["dept", "mine"],
};
const FALLBACK_VIEWS = ["mine", "mineOpen", "assigned", "raised", "dept", "deptOpen", "allTickets", "allOpen", "unassigned"];

function viewAllowed(key, role) {
  if (key.startsWith("all") || key === "unassigned") return role === "ADMIN";
  if (key.startsWith("dept")) return role === "MANAGER" || role === "TEAMLEAD";
  if (key === "assigned") return role === "TEAMLEAD" || role === "EMPLOYEE";
  return role !== "ADMIN"; // mine / raised / my open tickets
}

// Up to `max` views to switch to after a list of `view`, never the one just shown.
function viewSwitches(view, role, { open = false, plain = false, filter, max = 3 } = {}) {
  const current = new Set();
  if (plain && ["mine", "dept", "assigned", "raised"].includes(view)) current.add(view);
  if (open && view === "mine") current.add("mineOpen").add("mineUnresolved");
  if (open && view === "dept") current.add("deptOpen");
  // An Admin's department view is every department.
  if (view === "dept" && plain) current.add("allTickets");
  if (view === "dept" && open) current.add("allOpen");
  if (filter === "unassigned") current.add("unassigned");
  const keys = [];
  for (const key of [...(NEXT_VIEWS[view] || []), ...(view === "person" || view === "named" ? [] : FALLBACK_VIEWS)]) {
    if (keys.length >= max) break;
    if (current.has(key) || keys.includes(key) || !viewAllowed(key, role)) continue;
    // "My open tickets" and "my unresolved tickets" are the same list: offer one.
    if ((key === "mineOpen" && keys.includes("mineUnresolved")) || (key === "mineUnresolved" && keys.includes("mineOpen"))) continue;
    keys.push(key);
  }
  return keys.map((k) => VIEW_SWITCHES[k]);
}

// After a ticket list: the other views first, then narrowing steps on this same list, three at most.
function listSuggestions(view, role, { open, plain, refine, params, filters }) {
  const out = viewSwitches(view, role, { open, plain, filter: params.filter });
  if (refine) {
    const offersOpen = out.some((s) => /\b(open|unresolved)\b/i.test(s.label));
    const narrowing = [
      ...(!params.status && params.filter !== "open" && !offersOpen ? [{ label: "Only Open", prompt: "Only open" }] : []),
      ...(!params.status ? [{ label: "Only Resolved", prompt: "Only resolved" }] : []),
      ...(!filters.priority ? [{ label: "High Priority", prompt: "Only high priority" }] : []),
    ];
    for (const s of narrowing) if (out.length < 3) out.push(s);
  }
  return out;
}

// An Employee asked for department / team tickets: the ticket tool refused (and audited it). Say why, and what they
// can see instead, rather than a bare "no access" (or, worse, silently showing their own tickets as if they were it).
function employeeDepartmentRefusal(params) {
  return new ChatError(CODES.ACCESS_DENIED, {
    internal: "employee requested department tickets",
    message:
      "Department tickets are available only to the Managers and Team Leads of that department. " +
      "As an Employee, you can view the tickets you raised and the tickets assigned to you.",
    suggestions: [
      params.filter === "open" ? VIEW_SWITCHES.mineOpen : VIEW_SWITCHES.mine,
      VIEW_SWITCHES.assigned,
      VIEW_SWITCHES.raised,
    ],
  });
}

async function listTickets(ctx, params0, question) {
  let base = { ...params0 };
  let person = null;
  let relation = base.personRelation || "either";
  if (base.subject && !base.department) {
    const r = await resolveSubject(ctx, base);
    if (r.department) base.department = r.department;
    else (person = r.person), (relation = r.relation);
  }
  // "Jamie tickets": one word before "tickets" is a department, then a person, and only then a topic to search for.
  if (base.departmentOrText && !base.department && !person && ctx.scope.role !== "EMPLOYEE") {
    let isDepartment = true;
    try {
      await resolveDepartment(base.departmentOrText, await visibleDepartmentNames(ctx));
    } catch {
      isDepartment = false;
    }
    if (!isDepartment) {
      try {
        person = await resolvePerson(ctx, base.departmentOrText, base);
        relation = "either";
        delete base.departmentOrText;
      } catch (err) {
        // Several people match: the user chooses. A person of another department: say it is not available.
        // Nobody matches: it stays a topic to search for.
        if (err instanceof ChatError && (err.choices?.length || err.code === CODES.ACCESS_DENIED)) throw err;
      }
    }
  }
  if (!person && (base.personText || base.userId)) {
    try {
      person = await resolvePerson(ctx, base.personText, base);
    } catch (err) {
      // "assigned to Finance" names a department, not a person.
      if (!(err instanceof ChatError) || err.choices?.length || !base.personText || err.code === CODES.ACCESS_DENIED) throw err;
      try {
        base.department = (await resolveDepartment(base.personText, await visibleDepartmentNames(ctx))).name;
      } catch {
        throw err;
      }
    }
  }
  if (person) base.skipDepartment = true;

  const { params, used = [] } = await withEntities(ctx, base, question);
  const filters = await resolveListFilters(params, ctx);
  const applied = [
    ...(filters.department ? [`department ${filters.department}`] : []),
    ...(filters.priority ? [`${filters.priority} priority`] : []),
    ...(params.status ? [`status ${STATUS_LABEL[params.status]}`] : []),
    ...(params.dateFrom ? [used.find((u) => !/department|priority|status/.test(u)) || `${params.dateFrom} to ${params.dateTo}`] : []),
  ];

  // Wording pieces shared by the count and the list answer.
  const qual = [params.filter === "open" ? "open" : params.filter === "pending" ? "pending" : null, params.status ? STATUS_LABEL[params.status].toLowerCase() : null, filters.priority ? `${filters.priority} priority` : null].filter(Boolean).join(" ");
  const kind = qual ? `${qual} tickets` : "tickets";
  const who = person ? { assignee: `assigned to ${person.name}`, requester: `raised by ${person.name}`, either: `assigned to or raised by ${person.name}` }[relation] : null;
  const whom = params.mine === "requester" ? "you raised" : params.mine === "assignee" ? "assigned to you" : null;

  const toolInput = {
    scope: params.scope,
    filter: params.filter,
    text: params.text,
    staleDays: params.staleDays,
    status: params.status,
    requester: params.mine === "requester" ? "me" : undefined,
    assignee: params.mine === "assignee" ? "me" : undefined,
    ...(person ? { [{ assignee: "assigneeId", requester: "requesterId", either: "involvedId" }[relation]]: person.id } : {}),
    assignedTo: params.assignedTo,
    raisedBy: params.raisedBy,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    page: params.page,
    ...(params.withReasons ? { withReasons: "yes" } : {}),
    ...filters,
    limit: params.mode === "count" || params.latest ? 1 : PAGE_SIZE,
    ...(params.latest || params.recentCreated ? { sort: "created" } : {}),
  };
  let result;
  try {
    result = await runTool("search_authorized_tickets", ctx, toolInput);
  } catch (err) {
    if (err instanceof ChatError && err.code === CODES.ACCESS_DENIED && params.scope === "staff" && ctx.scope.role === "EMPLOYEE") throw employeeDepartmentRefusal(params);
    throw err;
  }

  // Which view this is, its heading, and (for "my department") which departments it covered.
  const role = ctx.scope.role;
  const view = ticketView(params, filters, person);
  const filterWord = { unassigned: "unassigned", stale: "inactive", recent: "recently updated" }[params.filter];
  const listKind = filterWord ? `${filterWord} ${kind}` : kind; // "unassigned tickets", "open tickets"
  const title = viewTitle(view, listKind, { role, department: filters.department, who });
  const deptNames = view === "dept" && role !== "ADMIN" ? await visibleDepartmentNames(ctx) : null;
  const scopeText = view === "dept" ? (role === "ADMIN" ? "across all departments" : `in ${departmentScopeText(deptNames)}`) : "";
  const isOpen = params.filter === "open" && !params.status;
  const isPlain = (params.filter || "any") === "any" && !params.status && !filters.priority && !filters.department && !params.dateFrom && !filters.text && !params.text;

  // What a follow-up like "only open ones" builds on: resolved values only, no text from the message.
  const frame = {
    intent: "list_tickets",
    params: {
      scope: params.scope, filter: params.filter, status: params.status, mine: params.mine, mode: "list",
      department: filters.department, priority: filters.priority, dateFrom: params.dateFrom, dateTo: params.dateTo, page: params.page || 1,
      ...(person ? { userId: person.id, personRelation: relation } : {}),
    },
    at: Date.now(),
  };

  if (params.mode === "count") {
    const subjectLabel = person ? `${person.name} has` : filters.department ? `${filters.department} has` : params.scope === "mine" ? "You have" : result.total === 1 ? "There is" : "There are";
    // Say which tickets were counted: "(raised by you or assigned to you)", "in your department (BI/Copilot)".
    const tail = who ? ` (${who.replace(` ${person.name}`, " them")})` : whom ? (whom === "you raised" ? " that you raised" : ` ${whom}`) : view === "mine" && !filters.department ? " (raised by you or assigned to you)" : view === "dept" ? ` ${scopeText}` : "";
    return {
      message: result.total ? `${subjectLabel} ${countOf(result.total, qual ? `${qual} ticket` : "ticket")}${tail}.` : `${subjectLabel === "There are" || subjectLabel === "There is" ? "There are" : subjectLabel} no ${kind}${tail}.`,
      data: { total: result.total },
      navigationTarget: null,
      suggestedActions: [...(result.total ? [{ label: "Show them", prompt: "Show them" }] : []), ...viewSwitches(view, role, { open: isOpen, plain: isPlain, filter: params.filter, max: 2 })],
      state: { frame },
      useModel: false,
      ticketNumbers: [],
    };
  }

  if (result.total && !result.tickets.length) {
    throw new ChatError(CODES.NO_RESULTS, { message: `That is all: there are only ${result.total} ticket${result.total === 1 ? "" : "s"} matching these filters.` });
  }
  if (!result.total) {
    const suggestions = [];
    if (filters.department) suggestions.push({ label: `All tickets in ${filters.department}`, prompt: `Show tickets in ${filters.department}` });
    if (filters.priority) suggestions.push({ label: `All ${filters.priority} priority tickets`, prompt: `Show ${filters.priority} priority tickets` });
    // A word that matched no department or person was searched in the ticket text: offer the likelier meanings.
    if (filters.text && ctx.scope.role !== "EMPLOYEE") {
      suggestions.push({ label: `Assigned to ${filters.text}`, prompt: `Show tickets assigned to ${filters.text}` }, { label: `Raised by ${filters.text}`, prompt: `Show tickets raised by ${filters.text}` });
    }
    // Then the other views ("Raised by Me", "My Department's Tickets"...), so an empty view is never a dead end.
    for (const s of viewSwitches(view, role, { open: isOpen, plain: isPlain, filter: params.filter })) if (!suggestions.some((x) => x.prompt === s.prompt)) suggestions.push(s);
    suggestions.push({ label: "Recently updated tickets", prompt: "Show recently updated tickets" });
    const target = [person ? who : null, filters.department ? filters.department : null].filter(Boolean).join(" in ");
    // With no other filter, name the view that was empty ("raised by you or assigned to you", "in your department").
    const emptyView = view === "mine" ? " raised by you or assigned to you" : view === "dept" && role !== "ADMIN" ? ` ${scopeText}` : null;
    // An Admin never raises tickets or gets them assigned, so their own views are always empty: say so plainly.
    const adminOwn = role === "ADMIN" && ["mine", "assigned", "raised"].includes(view) && !filters.department;
    throw new ChatError(CODES.NO_RESULTS, {
      message: adminOwn
        ? "Admins don't raise tickets and are never assigned tickets, so there are no tickets of yours to show. As an Admin, you can view tickets from every department."
        : applied.length || who || whom
          ? `I couldn't find any ${listKind}${target ? ` for ${person ? who : target}` : whom ? ` ${whom}` : ""}${params.dateFrom ? ` (${used.find((u) => !/department|priority|status/.test(u)) || `${params.dateFrom} to ${params.dateTo}`})` : ""}. You can widen the search:`
          : emptyView
            ? `I couldn't find any ${listKind}${emptyView}.`
            : "I didn't find any matching tickets.",
      suggestions: suggestions.slice(0, 3),
    });
  }

  const page = params.page || 1;
  const shown = result.tickets.length;
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = (page - 1) * PAGE_SIZE + shown;
  const message =
    `${title}: found ${result.total} ticket${result.total === 1 ? "" : "s"}` +
    (result.total > shown || page > 1 ? `. Showing ${first}–${last} of ${result.total}.` : ".") +
    (params.filter === "pending" ? " \"Pending\" means tickets with status On Hold." : "") +
    (params.filter === "open" ? " \"Open\" includes Open, In Progress, On Hold and Reopened." : "") +
    (params.withReasons ? " The recorded reason is shown on each ticket." : "") +
    (params.filter === "stale" ? " This is based on the last update time only; this application does not track SLAs or due dates." : "");
  // What the list is, shown above the cards: the filters in force, the range shown, and what a word means.
  const dateUsed = params.dateFrom ? used.find((u) => !/department|priority|status/.test(u)) || `${params.dateFrom} to ${params.dateTo}` : null;
  const listing = {
    // What the list is, as the card's title ("My Tickets", "Tickets Assigned to Me", "My Department's Open Tickets").
    title,
    showing: `${first}–${last} of ${result.total}`,
    filters: [
      ...(whom ? [whom === "you raised" ? "Raised by you" : "Assigned to you"] : []),
      ...(view === "mine" ? ["Raised by you or assigned to you"] : []),
      ...(view === "dept" ? [role === "ADMIN" ? "All departments" : deptNames?.length === 1 ? deptNames[0] : "Your departments"] : []),
      ...(who ? [cap(who)] : []),
      ...({ open: ["Open (all active statuses)"], pending: ["On Hold"], unassigned: ["Unassigned"], stale: ["No recent activity"] }[params.filter] || []),
      ...(params.status ? [STATUS_LABEL[params.status]] : []),
      ...(filters.priority ? [`${filters.priority} priority`] : []),
      ...(filters.department ? [filters.department] : []),
      ...(dateUsed ? [dateUsed] : []),
      ...(filters.text ? [`Matching "${filters.text}"`] : []),
    ],
    notes: [
      // Which tickets the view covers, in the portal's own terms.
      view === "mine" ? "\"My Tickets\" are the tickets you raised plus the tickets assigned to you." : null,
      view === "dept"
        ? role === "ADMIN"
          ? "As an Admin, you see tickets from every department."
          : deptNames?.length
            ? `Shows tickets in the department${deptNames.length === 1 ? "" : "s"} you have access to: ${deptNames.join(", ")}.`
            : "Shows tickets in the departments you have access to."
        : null,
      params.filter === "pending" ? "\"Pending\" means tickets with status On Hold." : null,
      params.filter === "open" ? "\"Open\" includes Open, In Progress, On Hold and Reopened." : null,
      params.withReasons ? "The recorded reason is shown on each ticket." : null,
      params.filter === "stale" ? "Based on the last update time only; this application does not track SLAs or due dates." : null,
    ].filter(Boolean),
  };
  return {
    message: params.latest ? (params.scope === "mine" ? "Your latest ticket:" : "The latest ticket:") : message,
    data: {
      tickets: result.tickets,
      total: params.latest ? result.tickets.length : result.total,
      page,
      pageSize: PAGE_SIZE,
      ...(params.latest ? {} : { listing, headline: `I found ${countOf(result.total, "ticket")}${result.total > shown || page > 1 ? `; here are ${first}–${last}` : ""}.` }),
    },
    navigationTarget: null,
    suggestedActions: params.latest ? [] : [
      ...(last < result.total ? [{ label: "Show more", prompt: "Show more" }] : []),
      // "You can also try": first the other views this role can use, then (to fill up to three) narrowing steps that
      // fit what was just shown (those go through the normal follow-up rules, on this same list).
      ...listSuggestions(view, role, { open: isOpen, plain: isPlain, refine: result.total > 1, params, filters }),
    ],
    state: { frame: { ...frame, results: result.tickets.map((t) => t.ticketNumber) } },
    useModel: true,
    ticketNumbers: result.tickets.map((t) => t.ticketNumber),
  };
}

// "Show tickets": ask which tickets, the way the portal's own tabs differ per role.
// "Who is looking after my laptop issue?": no ticket number was given. Look for the user's own
// tickets about that topic (inside their scope) and answer when there is exactly one; otherwise
// ask which one, with each candidate as a one-click question.
async function whichTicket(ctx, params) {
  const scope = ctx.scope.role === "EMPLOYEE" ? "mine" : "staff";
  const topic = String(params.topic || "").replace(/\b(issue|problem|ticket|request)s?\b/gi, "").trim();
  const found = topic ? await runTool("search_authorized_tickets", ctx, { scope, text: topic.slice(0, 100), limit: 4 }) : { total: 0, tickets: [] };
  const none = { data: {}, navigationTarget: null, useModel: false, ticketNumbers: [] };
  if (found.total === 1) {
    const t = found.tickets[0];
    return { ...none, message: t.assignedTo ? `Ticket ${t.ticketNumber} is assigned to ${t.assignedTo}.` : `Ticket ${t.ticketNumber} has not been assigned to anyone yet.`, data: { tickets: found.tickets }, suggestedActions: [{ label: `Show ticket ${t.ticketNumber}`, prompt: `Show ticket ${t.ticketNumber}` }] };
  }
  if (found.total > 1) {
    return { ...none, message: `I found ${found.total} tickets about "${topic}". Which one do you mean?`, suggestedActions: found.tickets.map((t) => ({ label: `${t.ticketNumber}: ${String(t.title).slice(0, 40)}`, prompt: `Who is handling ticket ${t.ticketNumber}` })) };
  }
  return { ...none, message: `I couldn't find a ticket about "${topic || "that"}". Tell me the ticket number, for example "Who is handling ticket 2600007?", or look at your tickets first.`, suggestedActions: [{ label: "Show my tickets", prompt: ctx.scope.role === "EMPLOYEE" ? "Show my tickets" : "Show tickets raised by me" }, { label: "Show my open tickets", prompt: "Show my open tickets" }] };
}

// "What are resolved tickets?" could mean the tickets or the meaning of the status.
async function statusOrListQuestion(ctx, params) {
  const s = params.status;
  const own = ctx.scope.role === "EMPLOYEE" ? "my " : "";
  return {
    message: `Do you want to see ${s} tickets, or learn what "${s}" means?`,
    data: {},
    navigationTarget: null,
    suggestedActions: [{ label: `Show ${own}${s} tickets`, prompt: `Show ${own}${s} tickets` }, { label: `What does ${s} mean?`, prompt: `What does ${s} mean?` }],
    useModel: false,
    ticketNumbers: [],
  };
}

async function ticketScopeQuestion(ctx) {
  const role = ctx.scope.role;
  const depts = (await visibleDepartmentNames(ctx)) || [];
  const mineChips = [{ label: "Raised by me", prompt: "Show tickets raised by me" }, { label: "Assigned to me", prompt: "Show tickets assigned to me" }];
  if (role === "EMPLOYEE") {
    return { message: "Do you want tickets raised by you, assigned to you, or both?", data: {}, navigationTarget: null, suggestedActions: [...mineChips, { label: "Both", prompt: "Show my tickets" }], useModel: false, ticketNumbers: [] };
  }
  if (role === "TEAMLEAD") {
    return { message: "Do you want your department tickets, tickets assigned to you, or tickets raised by you?", data: {}, navigationTarget: null, suggestedActions: [...depts.slice(0, 3).map((d) => ({ label: `${d} tickets`, prompt: `Show tickets in ${d}` })), ...mineChips], useModel: false, ticketNumbers: [] };
  }
  return {
    message: "Which accessible department would you like to view, or should I show all your authorized departments?",
    data: {},
    navigationTarget: null,
    suggestedActions: [...depts.slice(0, 6).map((d) => ({ label: d, prompt: `Show tickets in ${d}` })), { label: "All my departments", prompt: "Show all tickets in my departments" }],
    useModel: false,
    ticketNumbers: [],
  };
}

// "show Manoj": who they are, then ask what is wanted instead of guessing.
async function personLookup(ctx, params) {
  let person;
  try {
    person = await resolvePerson(ctx, params.personText, params);
  } catch (err) {
    // "Show employee Nobody" named a person who does not exist: say so. A bare word that is not a person is just a message we did not understand.
    if (params.explicit && err instanceof ChatError && !err.choices?.length && err.code !== CODES.ACCESS_DENIED) throw invalid("I couldn't find a person called \"" + params.personText + "\".");
    if (err instanceof ChatError && !err.choices?.length && err.code !== CODES.ACCESS_DENIED) throw new ChatError(CODES.UNSUPPORTED_INTENT, { internal: "bare text is not a known person" });
    throw err;
  }
  const dept = person.department?.name;
  return {
    message: `${person.name} is ${/^[AEIOU]/i.test(person.role.label) ? "an" : "a"} ${person.role.label}${dept ? ` in ${dept}` : ""}${person.isActive ? "" : " (deactivated)"}. What would you like to know about ${person.name}?`,
    // Name, role and department only (what the people directory already shows staff); never an email or id.
    data: { person: { name: person.name, role: person.role.label, department: dept || null, active: Boolean(person.isActive) }, headline: `What would you like to know about ${person.name}?` },
    navigationTarget: null,
    suggestedActions: [
      { label: `Tickets assigned to ${person.name}`, prompt: `Show tickets assigned to ${person.name}` },
      { label: `Tickets raised by ${person.name}`, prompt: `Show tickets raised by ${person.name}` },
    ],
    useModel: false,
    ticketNumbers: [],
  };
}

async function findTicket(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);

  // A plain "show ticket N" shows the ticket's details (only fields this user may see).
  if (!params.focus) {
    const { summary } = await runTool("summarize_authorized_ticket", ctx, { ticketNumber });
    const lines = [
      // The title and problem summary are ticket content: they appear in the card below, never in this prose.
      `Ticket ${summary.ticketId} details:`,
      `Status: ${summary.statusLabel}`,
      `Priority: ${summary.priority || "Not set"}`,
      `Department: ${summary.department || "Not available"}`,
      `Raised by: ${summary.raisedBy || "Not available"}`,
      `Assigned to: ${summary.assignedTo || "Not assigned"}`,
      `Created: ${summary.createdAt ? utc(summary.createdAt) : "Not available"}`,
      `Last updated: ${summary.lastUpdatedAt ? utc(summary.lastUpdatedAt) : "Not available"}`,
    ];
    return {
      message: lines.join("\n"),
      // The card shows every field; the bubble only says what the card is.
      data: { summary, lastTicketNumber: summary.ticketId, headline: `Here are the details of ticket ${summary.ticketId}.` },
      navigationTarget: ticketTarget(summary.ticketRouteId),
      suggestedActions: [{ label: "Show history", prompt: `Show history of ticket ${summary.ticketId}` }, { label: "Show comments", prompt: `Show comments on ticket ${summary.ticketId}` }],
      useModel: false,
      ticketNumbers: [summary.ticketId],
    };
  }

  const { ticket } = await runTool("get_authorized_ticket", ctx, { ticketNumber });
  // The same authorized ticket card, with the asked-for fact stated first.
  const focused =
    params.focus === "raisedBy"
      ? ticket.raisedBy ? `Ticket ${ticket.ticketNumber} was raised by ${ticket.raisedBy}.` : `The requester of ticket ${ticket.ticketNumber} is not available.`
      : params.focus === "assignedTo"
        ? ticket.assignedTo ? `Ticket ${ticket.ticketNumber} is assigned to ${ticket.assignedTo}.` : `Ticket ${ticket.ticketNumber} is not assigned to anyone yet.`
        : params.focus === "status"
          ? `Ticket ${ticket.ticketNumber} is ${ticket.statusLabel}.`
          : params.focus === "priority"
            ? ticket.priority ? `Ticket ${ticket.ticketNumber} has ${ticket.priority.name} priority.` : `Ticket ${ticket.ticketNumber} has no priority set.`
            : null;
  const message = focused || `Found ticket ${ticket.ticketNumber}: ${ticket.statusLabel}${ticket.priority ? `, priority ${ticket.priority.name}` : ""}, ${ticket.assignedTo ? `assigned to ${ticket.assignedTo}` : "not assigned"}.`;
  return {
    message,
    data: { tickets: [ticket], total: 1, lastTicketNumber: ticket.ticketNumber },
    navigationTarget: ticketTarget(ticket.ticketRouteId),
    suggestedActions: [{ label: "Summarize this ticket", prompt: `Summarize ticket ${ticket.ticketNumber}` }],
    useModel: true,
    ticketNumbers: [ticket.ticketNumber],
  };
}

async function summarizeTicket(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);
  const { summary } = await runTool("summarize_authorized_ticket", ctx, { ticketNumber });
  const parts = [`Ticket ${summary.ticketId} is ${summary.statusLabel}${summary.priority ? ` with ${summary.priority} priority` : ""}, ${summary.assignedTo ? `assigned to ${summary.assignedTo}` : "not assigned"}.`];
  if (summary.unavailableFields.length) parts.push(`Not available: ${summary.unavailableFields.join(", ")}.`);
  parts.push("Details are in the card below. SLA is not tracked in this application.");
  return {
    message: parts.join(" "),
    data: { summary, lastTicketNumber: summary.ticketId, headline: `Here's a summary of ticket ${summary.ticketId}.` },
    navigationTarget: ticketTarget(summary.ticketRouteId),
    suggestedActions: [
      { label: "Show ticket history", prompt: `Show history of ticket ${summary.ticketId}` },
      { label: "What is pending?", prompt: `What actions are pending on ticket ${summary.ticketId}?` },
    ],
    useModel: true,
    ticketNumbers: [summary.ticketId],
  };
}

async function latestUpdate(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);
  const { summary } = await runTool("summarize_authorized_ticket", ctx, { ticketNumber });
  const message = summary.latestUpdate
    ? `The latest recorded update on ticket ${summary.ticketId} was on ${summary.latestUpdateAt}. It is shown in the card below.`
    : `No updates are recorded for ticket ${summary.ticketId}.`;
  return {
    message,
    data: { summary, focus: "latestUpdate", lastTicketNumber: summary.ticketId },
    navigationTarget: ticketTarget(summary.ticketRouteId),
    suggestedActions: [],
    useModel: true,
    ticketNumbers: [summary.ticketId],
  };
}

async function pendingActions(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);
  const { summary } = await runTool("summarize_authorized_ticket", ctx, { ticketNumber });
  const n = summary.pendingActions.length;
  const message = n
    ? `I found ${n} recorded pending item${n === 1 ? "" : "s"} for ticket ${summary.ticketId} (shown below as facts)${summary.suggestions.length ? ", plus a suggestion that is not a recorded fact" : ""}.`
    : `Nothing is recorded as pending for ticket ${summary.ticketId}. It is ${summary.statusLabel}.`;
  return {
    message,
    data: { summary, focus: "pendingActions", lastTicketNumber: summary.ticketId },
    navigationTarget: ticketTarget(summary.ticketRouteId),
    suggestedActions: [],
    useModel: true,
    ticketNumbers: [summary.ticketId],
  };
}

async function ticketHistory(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);
  const { ticket, entries } = await runTool("get_authorized_ticket_history", ctx, { ticketNumber, limit: 10 });
  const message = entries.length
    ? `Ticket ${ticket.ticketNumber} has ${entries.length} recent history entr${entries.length === 1 ? "y" : "ies"} (newest first), shown below.`
    : `No history entries are recorded for ticket ${ticket.ticketNumber}.`;
  return {
    message,
    data: { history: { ticketNumber: ticket.ticketNumber, entries }, lastTicketNumber: ticket.ticketNumber },
    navigationTarget: ticketTarget(ticket.ticketRouteId),
    suggestedActions: [],
    useModel: true,
    ticketNumbers: [ticket.ticketNumber],
  };
}

async function summarizeTickets(ctx, params) {
  const found = await runTool("search_authorized_tickets", ctx, { scope: params.scope, filter: "open", limit: 5 });
  if (!found.total) throw new ChatError(CODES.NO_RESULTS);
  const summaries = [];
  for (const t of found.tickets) {
    // Each ticket is re-authorized and field-filtered by the tool.
    const { summary } = await runTool("summarize_authorized_ticket", ctx, { ticketNumber: t.ticketNumber });
    summaries.push(summary);
  }
  const message = `Summarized the ${summaries.length} most recently updated open ticket${summaries.length === 1 ? "" : "s"} (of ${found.total} open). Each is shown below.`;
  return {
    message,
    data: { summaries, total: found.total },
    navigationTarget: null,
    suggestedActions: [],
    useModel: true,
    ticketNumbers: summaries.map((s) => s.ticketId),
  };
}

async function ticketStatistics(ctx, params) {
  const role = ctx.scope.role;
  const word = params.word;
  // Scope words are checked against the ROLE here as well as in the tool.
  if (word === "overall" && role !== "ADMIN") throw new ChatError(CODES.ACCESS_DENIED, { internal: "system-wide stats for non-admin" });
  if (word === "department" && role === "EMPLOYEE") throw new ChatError(CODES.ACCESS_DENIED, { internal: "department stats for employee" });

  const scope = word === "mine" ? "mine" : "staff";
  const stats = await runTool("get_authorized_ticket_statistics", ctx, { scope });
  const label = role === "ADMIN" && scope === "staff" ? "System-wide" : scope === "staff" ? "Your departments" : "Your tickets";
  if (!stats.total) throw new ChatError(CODES.NO_RESULTS);

  const statusText = Object.entries(stats.byStatus).map(([s, n]) => `${statusLabel(s)} ${n}`).join(", ");
  const message =
    `${label}: ${stats.total} tickets (${statusText}). ` +
    `${stats.openUnassigned} open ticket${stats.openUnassigned === 1 ? " has" : "s have"} no assignee, and ${stats.openInactiveOver7Days} open ticket${stats.openInactiveOver7Days === 1 ? " has" : "s have"} had no update for over 7 days. ` +
    `Created in the last 7 days: ${stats.createdLast7Days} (previous 7 days: ${stats.createdPrevious7Days}); last 30 days: ${stats.createdLast30Days}.`;
  return {
    message,
    data: { statistics: { ...stats, label }, headline: `${label}: ${countOf(stats.total, "ticket")} in total.` },
    navigationTarget: null,
    suggestedActions: scope === "staff" ? staffFollowUps(role) : [],
    useModel: true,
    ticketNumbers: [],
  };
}

async function listDepartments(ctx, params, question = "") {
  const { departments, scope } = await runTool("list_departments", ctx);
  const role = ctx.scope.role;
  // "Show Jamie's department": looking another person up is not offered to an Employee.
  if (role === "EMPLOYEE" && /\b[a-z][a-z.\-]*'s (?:department|dept)\b/i.test(question) && !/\bmy\b/i.test(question)) throw new ChatError(CODES.ACCESS_DENIED);
  // "Show department XYZ": a name was given, so say whether that department exists for this user.
  const asked = String(question).match(/\b(?:department|dept)\s+(?!names?\b|list\b|are\b|is\b|there\b|available\b|all\b|for\b|stat\w*|summary\b|overview\b|report\b|tickets?\b|people\b|members?\b|employees?\b|dashboard\b|details?\b|info\w*)([a-z0-9][a-z0-9&/\- ]*?)\s*[?.!]*$/i);
  if (asked && departments.length) {
    const found = matchDepartments(asked[1], departments);
    if (!found.length) throw invalid(`I couldn't find a department called "${asked[1].trim()}". ${role === "EMPLOYEE" ? `Your department is ${departments[0]}.` : `You can ask about: ${departments.join(", ")}.`}`);
    return report(`${found.join(", ")} ${found.length === 1 ? "is a department" : "are departments"} you can ask about.`, { departments: found });
  }
  if (!departments.length) {
    if (role === "EMPLOYEE") return report("No department is recorded on your profile.", { departments: [] });
    throw new ChatError(CODES.NO_RESULTS);
  }
  const n = departments.length;
  const message =
    scope === "own"
      ? `Your department: ${departments[0]}.`
      : scope === "allocated"
        ? `You have access to ${n === 1 ? "1 department" : `${n} departments`}: ${departments.join(", ")}.`
        : `There ${n === 1 ? "is 1 department" : `are ${n} departments`}: ${departments.join(", ")}.`;
  const headline = scope === "own" ? "Your department:" : scope === "allocated" ? `You have access to ${n === 1 ? "1 department" : `${n} departments`}:` : `There ${n === 1 ? "is 1 department" : `are ${n} departments`}:`;
  return report(message, { departments, headline });
}

// ---- people: employees, Team Leads, Managers, Admins, counts and names ------------------------
// Names + role labels only, never emails or ids. Free text such as names is placed in the message directly,
// which is safe because this intent never goes through the model (useModel: false).
//
// The question's role(s), department(s) and output (names, count, both, a breakdown) are decided BEFORE any
// data is read (queryFrame.peopleFrame). The tool then returns, for the caller's own departments only (every
// department for an Admin), each person once with exact per-role counts; the filters are applied here, and the
// count and the names always come from the SAME filtered set. A role asked for without a department means every
// department the user may see; only a question with neither a role nor a department asks "which department?".
const ROLE_NOUN = { MANAGER: "manager", TEAMLEAD: "team lead", EMPLOYEE: "employee", ADMIN: "administrator" };
const ROLE_TITLE = { MANAGER: "Managers", TEAMLEAD: "Team Leads", EMPLOYEE: "Employees", ADMIN: "Administrators" };
const ROLE_LABEL_TO_KEY = { Manager: "MANAGER", "Team Lead": "TEAMLEAD", Employee: "EMPLOYEE" };
const DEPARTMENT_ROLES = ["MANAGER", "TEAMLEAD", "EMPLOYEE"];

const nounFor =(roles) => (n) => (roles.length === 1 ? (n === 1 ? ROLE_NOUN[roles[0]] : `${ROLE_NOUN[roles[0]]}s`) : n === 1 ? "person" : "people");
const listWords = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const breakdownText = (counts) => DEPARTMENT_ROLES.filter((r) => counts[r] !== undefined).map((r) => plural(counts[r], ROLE_NOUN[r], `${ROLE_NOUN[r]}s`)).join(", ");

// "in Narnia" / "of the HR team": the department a question names, if any. Only used when the tool found no
// department of that name among the ones this user may see, to say so instead of guessing another one.
function namedDepartment(question) {
  const q = String(question || "").replace(/[?.!]+\s*$/, "");
  const hit = q.match(/\b(?:in|of|for|from|at)\s+(?:the\s+)?([a-z0-9][\w&/.\- ]{0,40}?)(?:\s+(?:department|dept|team))?\s*(?:,.*|\s+(?:including|with|along|and|show|list|who|please)\b.*)?$/i);
  if (!hit) return null;
  const name = hit[1].trim();
  if (!name || /^(?:each|every|all|my|our|your|their|total|overall|general|here|the company|company|organi[sz]ation|it all)\b/i.test(name) || /\bdepartments?\b/i.test(name)) return null;
  return name;
}

// "Administrators": they belong to no department, and only an Administrator may list them.
function adminsBlock(list, mode) {
  const { total, admins } = list;
  if (!total) return { text: "No active administrators were found. Total administrators: 0.", data: { total: 0, members: [] } };
  const names = mode === "count" ? [] : admins;
  const lines = [`Administrators`, `Total administrators: ${total}`, ...names.map((a, i) => `${i + 1}. ${a.name} — Admin`)];
  if (names.length && total > names.length) lines.push(`…and ${total - names.length} more`);
  return { text: lines.join("\n"), data: { total, members: names } };
}

async function peopleDirectory(ctx, params, question) {
  const role = ctx.scope.role;
  const roles = [...new Set(params.roleFilters || (params.roleFilter ? [params.roleFilter] : []))];
  const mode = params.mode === "count" || params.mode === "both" ? params.mode : "list";
  const showNames = mode !== "count";
  const wantsAdmins = roles.includes("ADMIN");
  const deptRoles = roles.filter((r) => r !== "ADMIN");

  // Administrators first: an Administrator-only list (the tool policy refuses anyone else, too).
  let admins = null;
  if (wantsAdmins) {
    if (role !== "ADMIN") throw new ChatError(CODES.ACCESS_DENIED, { internal: "admin list for non-admin", message: "Only an Administrator can see who the administrators are. I can show the people of your own departments." });
    admins = adminsBlock(await runTool("get_admin_users", ctx, {}), mode);
    if (!deptRoles.length) {
      return {
        message: admins.text,
        data: { people: { title: "Administrators", roles: ["ADMIN"], mode, departments: [], total: admins.data.total, admins: admins.data }, headline: `${plural(admins.data.total, "administrator", "administrators")}.` },
        navigationTarget: null,
        suggestedActions: [],
        useModel: false,
        ticketNumbers: [],
      };
    }
  }

  const ask = { question: params.question || question, roleFilter: deptRoles.length === 1 ? deptRoles[0] : undefined };
  let { departments: found, availableDepartments } = await runTool("get_department_members", ctx, { ...ask, all: params.all ? "yes" : undefined });
  let everyDepartment = Boolean(params.all);

  if (!found.length) {
    // A department was named that this user does not have: say so, never answer for another one.
    const named = namedDepartment(params.question || question);
    if (named) {
      throw new ChatError(CODES.ACTION_INVALID, {
        message: `I couldn't find a department called "${toPlainText(named, 40)}"${role === "ADMIN" ? "" : " among the departments you can see"}. You can ask about: ${availableDepartments.join(", ") || "no departments"}.`,
        suggestions: availableDepartments.slice(0, 4).map((d) => ({ label: d, prompt: `${deptRoles.length === 1 ? `Show ${ROLE_TITLE[deptRoles[0]].toLowerCase()}` : "Show the people"} in ${d}` })),
      });
    }
    // A role, a count or a breakdown with no department: every department this user may see.
    if (deptRoles.length || mode !== "list" || params.breakdown) {
      ({ departments: found } = await runTool("get_department_members", ctx, { ...ask, all: "yes" }));
      everyDepartment = true;
    } else {
      return {
        message: `Which department do you mean? I can list people for: ${availableDepartments.join(", ")}. You can also ask for "employees in each department".`,
        data: { departments: availableDepartments },
        navigationTarget: null,
        suggestedActions: [...availableDepartments.slice(0, 4).map((d) => ({ label: d, prompt: `show me the people in ${d}` })), { label: "All my departments", prompt: "show the people in each department" }],
        useModel: false,
        ticketNumbers: [],
      };
    }
  }

  // The same filter for the count and for the names: the roles asked for, or every department role.
  const keys = deptRoles.length ? deptRoles : DEPARTMENT_ROLES;
  const breakdown = Boolean(params.breakdown);
  const rows = found.map((d) => {
    const counts = d.counts || {};
    const total = d.counts ? keys.reduce((n, k) => n + (counts[k] || 0), 0) : d.total;
    const members = (d.members || []).filter((m) => keys.includes(ROLE_LABEL_TO_KEY[m.role]));
    return { name: d.name, total, counts: Object.fromEntries(keys.map((k) => [k, counts[k] || 0])), members };
  });
  const noun = nounFor(deptRoles);
  const grand = rows.reduce((n, d) => n + d.total, 0);
  const roleWord = deptRoles.length ? listWords(deptRoles.map((r) => ROLE_TITLE[r])) : "People";
  const where = rows.length === 1 && !everyDepartment ? `in ${rows[0].name}` : role === "ADMIN" ? "in all departments" : role === "MANAGER" ? "in your departments" : "in your department";
  const title = breakdown && rows.length > 1 ? `${roleWord} by department` : `${roleWord} ${where}`;
  const nounPlural = noun(2);

  // In a list of several departments, departments with nobody of that role are left out (and said once).
  const shownRows = showNames && rows.length > 1 && !breakdown ? rows.filter((d) => d.total > 0) : rows;
  const emptyNames = rows.filter((d) => d.total === 0).map((d) => d.name);

  const nameLines = (d) => {
    const lines = d.members.map((m, i) => `${i + 1}. ${m.name} — ${m.role} — ${d.name}`);
    if (d.total > d.members.length) lines.push(`…and ${d.total - d.members.length} more`);
    return lines;
  };

  let message;
  if (!grand) {
    message = rows.length === 1 && !everyDepartment ? `No ${roleWord} were found in the ${rows[0].name} department. Total ${nounPlural}: 0.` : `No ${roleWord} were found ${where}. Total ${nounPlural}: 0.`;
  } else if (rows.length === 1 && !everyDepartment) {
    const d = rows[0];
    const head = [`${roleWord} in ${d.name}`, `Total ${nounPlural}: ${d.total}${!deptRoles.length || breakdown ? ` (${breakdownText(d.counts)})` : ""}`];
    message = [...head, ...(showNames ? nameLines(d) : [])].join("\n");
  } else if (!showNames) {
    const lines = rows.map((d) => `• ${d.name}: ${breakdown || !deptRoles.length ? `${d.total} (${breakdownText(d.counts)})` : d.total}`);
    message = [title, ...lines, `Total ${nounPlural}: ${grand}`].join("\n");
  } else {
    const blocks = shownRows.map((d) => [`${d.name}: ${plural(d.total, noun(1), nounPlural)}${breakdown || !deptRoles.length ? ` (${breakdownText(d.counts)})` : ""}`, ...nameLines(d)].join("\n"));
    message = [`${title}\nTotal ${nounPlural}: ${grand}`, ...blocks, ...(emptyNames.length && deptRoles.length ? [`No ${roleWord.toLowerCase()} in: ${emptyNames.join(", ")}.`] : [])].join("\n\n");
  }
  if (admins) message = `${message}\n\n${admins.text}`;

  const frame = { intent: "people_directory", params: { question: rows.map((d) => d.name).join(", "), roleFilters: deptRoles, mode: "list" }, at: Date.now() };
  const people = {
    title,
    roles: roles.map((r) => ROLE_TITLE[r]),
    mode,
    breakdown,
    scope: everyDepartment ? "every" : "named",
    total: grand,
    noun: nounPlural,
    departments: shownRows.map((d) => ({ name: d.name, total: d.total, counts: d.counts, ...(showNames ? { members: d.members } : {}) })),
    ...(emptyNames.length && showNames && rows.length > 1 && !breakdown ? { emptyDepartments: emptyNames } : {}),
    ...(admins ? { admins: admins.data } : {}),
  };
  // Asked for a count: offer the names (the same filters), and the other way round.
  const rolePhrase = deptRoles.length === 1 ? `${ROLE_NOUN[deptRoles[0]]}` : "people";
  const placePhrase = rows.length === 1 && !everyDepartment ? `in ${rows[0].name}` : "in each department";
  const suggestedActions = grand
    ? mode === "count"
      ? [{ label: "Show their names", prompt: `Show the ${rolePhrase === "people" ? "people" : `${rolePhrase} names`} ${placePhrase}` }]
      : mode === "list"
        ? [{ label: "Count only", prompt: `How many ${rolePhrase === "people" ? "people" : `${rolePhrase}s`} are ${placePhrase}?` }]
        : []
    : [];

  return {
    message,
    data: {
      people,
      // The earlier shape, kept for existing callers: the departments with their (filtered) members.
      departmentMembers: shownRows.map((d) => (showNames ? { name: d.name, total: d.total, members: d.members } : { name: d.name, total: d.total })),
      headline: !grand
        ? message
        : rows.length === 1 && !everyDepartment
          ? `${rows[0].name}: ${plural(rows[0].total, noun(1), nounPlural)}.`
          : `${plural(grand, noun(1), nounPlural)} ${where}.`,
    },
    navigationTarget: !deptRoles.length && role === "ADMIN" ? { type: "route", path: "/admin/departments", label: "Open Departments" } : null,
    suggestedActions,
    state: { frame },
    useModel: false,
    ticketNumbers: [],
  };
}

// ---- the signed-in user's own dashboard numbers ---------------------------
// Uses the dashboard service through get_my_dashboard, so the numbers are exactly the ones on
// the Dashboard page ("Raised by me" / "Assigned to me", Last 7 / 30 / 90 days).
const DASH_STATUS_LABEL = { OPEN: "Open", IN_PROGRESS: "In Progress", ON_HOLD: "On Hold", RESOLVED: "Resolved", CLOSED: "Closed", REOPENED: "Reopened" };

// "the last 30 days" / "today" / "Oct 1 – Oct 5, 2026", for sentences.
const periodName = (p) => (/^Last \d+ days$/.test(p.label) ? `the ${p.label.toLowerCase()}` : /^(Today|Yesterday|This week|Last week|This month|Last month|This year)$/.test(p.label) ? p.label.toLowerCase() : p.rangeText);

async function dashboardSummary(ctx, params, question) {
  const found = question ? await extractEntities(question, { visibleDepartments: await visibleDepartmentNames(ctx) }) : {};
  if (found.dateAmbiguous) throw new ChatError(CODES.ACTION_INVALID, { message: "I can't tell which day you mean (day/month or month/day). Please write the date like 4 Oct 2026 or 2026-10-04." });
  // The window: one the question names (a day starts at the user's own midnight), else the Dashboard
  // page's default "Last 30 days" (exactly 30 x 24 hours back, as the page sends it).
  const period = resolvePeriod({ question, defaultDays: params.days || 30, rolling: true, timeZone: ctx.timeZone });
  if (period.ambiguous) throw new ChatError(CODES.ACTION_INVALID, { message: "I can't tell which day you mean (day/month or month/day). Please write the date like 4 Oct 2026 or 2026-10-04." });
  const runsToNow = period.to.getTime() >= Date.now() - 60000;
  const range = { days: Math.min(period.days, 365), dateFrom: period.from.toISOString(), ...(runsToNow ? {} : { dateTo: new Date(period.to.getTime() - 1).toISOString() }) };
  const rangeLabel = periodName(period);
  const status = params.status || found.status || null;
  const priority = params.priority || found.priority || null;
  const rels = params.rel === "created" ? ["created"] : params.rel === "assigned" ? ["assigned"] : ["created", "assigned"];
  const names = { created: "Raised by you", assigned: "Assigned to you" };

  const got = {};
  for (const rel of rels) got[rel] = await runTool("get_my_dashboard", ctx, { scope: rel, ...range });
  // "How many of my tickets are open?": "open" is the application's open group (Open, In Progress, On Hold, Reopened).
  const openGroup = !status && /\bopen\b/i.test(String(question || ""));
  const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "ON_HOLD", "REOPENED"];
  const pick = (d) => (status ? d.byStatus.find((s) => s.status === status)?.count ?? 0 : openGroup ? d.byStatus.filter((s) => OPEN_STATUSES.includes(s.status)).reduce((a, s) => a + s.count, 0) : priority ? d.byPriority.find((p) => p.priority.toLowerCase() === priority.toLowerCase())?.count ?? 0 : d.total);
  const dashboardTarget = { type: "route", path: ctx.scope.role === "EMPLOYEE" ? "/portal" : ctx.scope.role === "ADMIN" ? "/admin" : "/agent", label: "View Dashboard" };

  // "How many resolved tickets do I have?": one answer per dashboard tab, never a guess about which.
  if (params.view === "count") {
    const what = [status ? DASH_STATUS_LABEL[status].toLowerCase() : openGroup ? "open" : null, priority ? `${priority} priority` : null].filter(Boolean).join(" ");
    const noun = what ? `${what} ticket` : "ticket";
    const lines = rels.map((rel) => `• ${names[rel]}: ${pick(got[rel])}`);
    return {
      message: rels.length === 1 ? `${rel2sentence(rels[0], pick(got[rels[0]]), noun)} (${rangeLabel}).` : `${cap(noun)}s in ${rangeLabel}:\n${lines.join("\n")}`,
      data: { dashboard: Object.fromEntries(rels.map((r) => [r, pick(got[r])])) },
      navigationTarget: dashboardTarget,
      suggestedActions: [],
      useModel: false,
      ticketNumbers: [],
    };
  }

  // Each section has its own status AND priority counts, so "raised by you" and "assigned to you" are
  // never mixed. Only the statuses and priorities the dashboard service returns are shown.
  const statusLine = (d) => d.byStatus.map((s) => `${DASH_STATUS_LABEL[s.status] || s.status} ${s.count}`).join(" · ");
  const prioLine = (d) => d.byPriority.map((p) => `${p.priority} ${p.count}`).join(" · ");
  const blocks = rels.map((rel) => `${names[rel]}: ${got[rel].total}\n• Status: ${statusLine(got[rel])}${got[rel].byPriority.length ? `\n• Priority: ${prioLine(got[rel])}` : ""}`);
  const summaryReport = {
    title: "Your Ticket Summary",
    period: periodView(period),
    sections: rels.map((rel) => ({
      key: rel,
      label: names[rel],
      total: got[rel].total,
      byStatus: got[rel].byStatus.map((s) => ({ status: s.status, label: DASH_STATUS_LABEL[s.status] || s.status, count: s.count })),
      byPriority: got[rel].byPriority.map((p) => ({ priority: p.priority, count: p.count })),
    })),
  };
  return {
    message: `Your ticket summary — ${period.label} (${period.rangeText})\n\n${blocks.join("\n\n")}`,
    data: {
      dashboard: Object.fromEntries(rels.map((r) => [r, { total: got[r].total, byStatus: got[r].byStatus, byPriority: got[r].byPriority }])),
      summaryReport,
      headline: `Here's your ticket summary for ${rangeLabel}.`,
    },
    navigationTarget: dashboardTarget,
    suggestedActions: [
      ...(period.label !== "Last 7 days" ? [{ label: "Last 7 days", prompt: "Show my dashboard summary for the last 7 days" }] : []),
      ...(period.label !== "Last 30 days" ? [{ label: "Last 30 days", prompt: "Show my dashboard summary for the last 30 days" }] : []),
      ...(period.label !== "Last 90 days" ? [{ label: "Last 90 days", prompt: "Show my dashboard summary for the last 90 days" }] : []),
    ],
    useModel: false,
    ticketNumbers: [],
  };
}

function rel2sentence(rel, n, noun) {
  const plural = `${n} ${noun}${n === 1 ? "" : "s"}`;
  return rel === "created" ? `You raised ${plural}` : `You have ${plural} assigned to you`;
}

// ---- notifications (the bell) -----------------------------------------------
const ago = (d) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
};
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

async function notificationsList(ctx, params) {
  const { unread, notifications } = await runTool("get_my_notifications", ctx, { unreadOnly: params.unreadOnly ? "yes" : undefined });
  let rows = notifications;
  if (params.ticketNumber) rows = rows.filter((n) => n.ticketNumber === String(params.ticketNumber));
  if (params.today) rows = rows.filter((n) => sameDay(n.createdAt, new Date()));
  const scope = [params.unreadOnly ? "unread " : "", params.ticketNumber ? `for ticket ${params.ticketNumber} ` : "", params.today ? "from today " : ""].join("");
  const adjective = params.unreadOnly ? "unread " : "";
  const suffix = `${params.ticketNumber ? ` for ticket ${params.ticketNumber}` : ""}${params.today ? " from today" : ""}`;

  if (params.mode === "count") {
    return report(unread ? `You have ${countOf(unread, "unread notification")}.` : "You have no unread notifications.", { notifications: { unread } });
  }
  if (!rows.length) {
    return report(params.unreadOnly || params.ticketNumber || params.today ? `You have no ${scope.trim()} notifications.` : "You have no notifications.", { notifications: { unread } });
  }
  const shown = rows.slice(0, 10);
  const lines = shown.map((n) => `• ${n.isRead ? "" : "(unread) "}${n.ticketNumber ? `Ticket ${n.ticketNumber} — ` : ""}${toPlainText(n.title, 80)}: ${toPlainText(n.message, 120)} (${ago(n.createdAt)})`);
  // The user's own notifications, as the bell shows them. A ticket link only when the ticket is still in their scope.
  const items = shown.map((n) => ({ id: n.id, type: n.type, title: toPlainText(n.title, 80), message: toPlainText(n.message, 160), isRead: n.isRead, at: new Date(n.createdAt).toISOString(), ticketNumber: n.ticketNumber, ticketRouteId: n.ticketRouteId }));
  return {
    message: `${countOf(rows.length, `${adjective}notification`)}${suffix}${rows.length > shown.length ? `; showing the latest ${shown.length}` : ""}. ${unread} unread in total.\n${lines.join("\n")}`,
    data: {
      notifications: { unread, shown: shown.length, matching: rows.length, items, filter: scope.trim() || null },
      headline: `${countOf(rows.length, `${adjective}notification`)}${suffix}${rows.length > shown.length ? ` (showing the latest ${shown.length})` : ""}.`,
    },
    // Each notification card has its own Open Ticket button, so no single link is added under the answer.
    navigationTarget: null,
    suggestedActions: [
      ...(unread ? [{ label: "Mark all as read", prompt: "Mark all notifications as read" }] : []),
      { label: "Clear all notifications", prompt: "Clear all my notifications" },
    ],
    useModel: false,
    ticketNumbers: [],
  };
}

// ---- more questions about one ticket ----------------------------------------
// "when was ticket N created": the recorded dates, shown in UTC so they mean the same to everyone.
const utc = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") + " UTC";

async function ticketDates(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);
  const { ticket } = await runTool("get_authorized_ticket", ctx, { ticketNumber });
  const updated = params.focus === "updated";
  const when = updated ? ticket.lastUpdatedAt : ticket.createdAt;
  const message = when ? `Ticket ${ticket.ticketNumber} was ${updated ? "last updated" : "created"} on ${utc(when)}.${updated ? "" : ` It was last updated on ${utc(ticket.lastUpdatedAt)}.`}` : `The ${updated ? "last update" : "creation"} date of ticket ${ticket.ticketNumber} is not available.`;
  return withTicket(ticket, message, {});
}

async function ticketComments(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);
  const { ticket, total, comments } = await runTool("get_authorized_ticket_comments", ctx, { ticketNumber, limit: 5 });
  if (!comments.length) return withTicket(ticket, `Ticket ${ticket.ticketNumber} has no comments yet.`, {});
  const lines = comments.map((c) => `• ${c.author || "Someone"}${c.at ? ` (${c.at.slice(0, 10)})` : ""}: ${c.text}`);
  return withTicket(ticket, `Ticket ${ticket.ticketNumber} has ${countOf(total, "comment")}${total > comments.length ? `; the latest ${comments.length}` : ""}:\n${lines.join("\n")}`, { comments });
}

// "Why was ticket N closed / resolved / put on hold / reopened": the reasons the application recorded.
// The text is ticket content, so it travels in the data (shown in a card), never in the prose message.
async function ticketReasons(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);
  const { ticket, current, reopened, history } = await runTool("get_authorized_ticket_reasons", ctx, { ticketNumber });
  const want = params.statusWord; // closed | resolved | on_hold | reopened | undefined
  const KIND = { closed: "CLOSED_REASON", resolved: "RESOLUTION_NOTES", on_hold: "ON_HOLD_REASON", reopened: "REOPENED_REASON" };
  const NAME = { closed: "closed reason", resolved: "resolution notes", on_hold: "on-hold reason", reopened: "reopened reason" };
  let reasons = [];
  if (want === "reopened") {
    reasons = history.filter((h) => h.kind === KIND.reopened).map((h, i) => ({ label: h.label, text: h.text, by: h.by, at: h.at, current: i === 0 && ticket.status === "REOPENED" }));
    if (!reasons.length && reopened?.text) reasons = [{ ...reopened, current: ticket.status === "REOPENED" }]; // older reopen noted in a comment
  } else if (want) reasons = history.filter((h) => h.kind === KIND[want]).map((h, i) => ({ label: h.label, text: h.text, by: h.by, at: h.at, current: i === 0 && ticket.status === { closed: "CLOSED", resolved: "RESOLVED", on_hold: "ON_HOLD" }[want] }));
  else {
    // No status named: the reason for where the ticket is now, then any earlier ones.
    if (current?.text) reasons.push({ ...current, current: true });
    for (const h of history) if (!(current?.text && h.label === current.label && h.text === current.text)) reasons.push({ label: h.label, text: h.text, by: h.by, at: h.at, current: false });
    if (reopened?.text && ticket.status !== "REOPENED") reasons.push({ ...reopened, current: false });
  }
  if (want && !reasons.length && current?.text && current.label === ({ closed: "Closed reason", resolved: "Resolution notes", on_hold: "On-hold reason" }[want])) reasons = [{ ...current, current: true }];
  const what = want ? NAME[want] : "reason";
  const message = reasons.length
    ? `Ticket ${ticket.ticketNumber} (${ticket.statusLabel}): the recorded ${reasons.length === 1 ? what : `${what}s`} ${reasons.length === 1 ? "is" : "are"} shown below.`
    : want === "reopened"
      ? `No reopen reason is recorded for ticket ${ticket.ticketNumber}${ticket.status === "REOPENED" ? " (it was reopened before reasons were required)" : ` (it is ${ticket.statusLabel})`}.`
      : `No ${what} is recorded for ticket ${ticket.ticketNumber}${ticket.status ? ` (it is ${ticket.statusLabel})` : ""}.`;
  return withTicket(ticket, message, reasons.length ? { reasons } : {});
}

async function ticketAttachments(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);
  const { ticket, attachments } = await runTool("get_authorized_ticket_attachments", ctx, { ticketNumber });
  if (!attachments.length) return withTicket(ticket, `Ticket ${ticket.ticketNumber} has no attachments.`, {});
  const lines = attachments.map((a) => `• ${a.fileName} (${a.sizeKb} KB)${a.uploadedBy ? ` — ${a.uploadedBy}` : ""}`);
  return withTicket(ticket, `Ticket ${ticket.ticketNumber} has ${countOf(attachments.length, "attachment")}:\n${lines.join("\n")}`, { attachments });
}

// "Who is the manager / team lead for ticket N": the people of the ticket's department, by role.
async function ticketPeople(ctx, params) {
  const ticketNumber = resolveTicketNumber(ctx, params);
  const { ticket } = await runTool("get_authorized_ticket", ctx, { ticketNumber });
  const roles = params.roleFilters?.length ? params.roleFilters : ["MANAGER", "TEAMLEAD"];
  const { departments } = await runTool("get_department_members", ctx, { question: ticket.department || "", roleFilter: roles.length === 1 ? roles[0] : undefined });
  const dept = departments.find((d) => d.name === ticket.department);
  if (!dept) return withTicket(ticket, `I can't list the people of ${ticket.department || "that department"} for you.`, {});
  const members = dept.members.filter((m) => roles.some((r) => ({ MANAGER: "Manager", TEAMLEAD: "Team Lead" })[r] === m.role));
  const noun = roles.length === 1 ? (roles[0] === "MANAGER" ? "manager" : "team lead") : "manager or team lead";
  if (!members.length) return withTicket(ticket, `Ticket ${ticket.ticketNumber} belongs to ${ticket.department}, which has no ${noun}s.`, {});
  return withTicket(ticket, `Ticket ${ticket.ticketNumber} belongs to ${ticket.department}:\n${members.map((m) => `• ${m.name} — ${m.role}`).join("\n")}`, {});
}

// ---- "how do I transfer a ticket" / "2600011 transfer to Hardware" -----------------------
// How a ticket is moved to another department, for THIS user: the steps on the ticket page, the rules,
// and whether they may do it. "May they" is the ticket service's own transfer rule (the one the transfer
// itself enforces), never a copy. Nothing is changed here; a role that may transfer is offered the
// confirm-first chat action as a next step.
const TICKETS_PAGE = { ADMIN: ["/admin/tickets", "Open All Tickets"], MANAGER: ["/agent/queue", "Open Tickets"], TEAMLEAD: ["/agent/queue", "Open Tickets"], EMPLOYEE: ["/portal/my-tickets", "Open My Tickets"] };
const WHO_CAN_TRANSFER = "Who can transfer: a Manager or Team Lead of the ticket's department, or the employee the ticket is assigned to. Administrators can't transfer tickets.";

async function transferGuidance(ctx, params) {
  const role = ctx.scope.role;
  const ticketNumber = params.ticketNumber || (params.useLastTicket ? ctx.lastTicketNumber : null);
  let ticket = null;
  let access;
  if (ticketNumber) {
    // Only a ticket this user may see (otherwise the usual neutral "not found or no permission").
    ({ ticket } = await runTool("get_authorized_ticket", ctx, { ticketNumber }));
    const row = await prisma.ticket.findFirst({ where: { AND: [{ ticketNumber: ticket.ticketNumber }, authorizedWhere(ctx.scope)] }, select: { toDepartmentId: true, assigneeId: true } });
    try {
      ticketService.assertCanTransferDepartment(ctx.scope.user, row, ctx.scope.departmentIds);
      access = { tone: "ok", text: `You can transfer ticket ${ticket.ticketNumber}.` };
    } catch (err) {
      access = { tone: "blocked", text: role === "ADMIN" ? `Administrators can't transfer tickets. A Manager or Team Lead of ${ticket.department || "the ticket's department"}, or the employee it is assigned to, can.` : err.message };
    }
  } else {
    access =
      role === "ADMIN"
        ? { tone: "blocked", text: "Administrators can't transfer tickets in this application. A Manager or Team Lead of the ticket's department, or the employee it is assigned to, can." }
        : role === "EMPLOYEE"
          ? { tone: "info", text: "You can transfer a ticket while it is assigned to you." }
          : { tone: "info", text: "You can transfer tickets that belong to the departments you manage." };
  }

  // The destination: any department may receive a transfer (as on the ticket page), so all names are checked.
  let target = null;
  let targetNote = null;
  if (params.department) {
    const names = (await prisma.department.findMany({ select: { name: true } })).map((d) => d.name);
    const hit = matchDepartments(params.department, names);
    if (hit.length === 1) target = hit[0];
    else targetNote = `I couldn't find a department called "${toPlainText(params.department, 60)}". Pick the department in Transfer To on the ticket page.`;
    if (target && ticket?.department && target.toLowerCase() === ticket.department.toLowerCase()) targetNote = `Ticket ${ticket.ticketNumber} is already in ${target}.`;
  }

  const which = ticket ? `ticket ${ticket.ticketNumber}` : "the ticket";
  const steps = [
    `Open ${which}${ticket ? " (use Open Ticket below)" : " from your ticket list"}.`,
    "Select Transfer Department at the top of the ticket page.",
    `In Transfer To, choose ${target && !targetNote ? target : "the department that should handle it"}.`,
    "Enter the Transfer Reason (it is required).",
    "Select Transfer Ticket.",
  ];
  const notes = [
    "The destination department needs an active Manager or Team Lead. Departments without one are marked \"No active management\" and can't receive tickets.",
    "A ticket can't be transferred to the department it is already in.",
    "After the transfer the ticket is unassigned until the new department assigns it. The requester and the new department's Managers and Team Leads are notified, with your reason.",
    WHO_CAN_TRANSFER,
  ];
  const canAct = access.tone === "ok" && role !== "ADMIN" && target && !targetNote;
  if (canAct) access.text += ` I can also do it here: I'll ask for the reason and show a preview before anything changes.`;

  const title = "How to transfer a ticket to another department";
  const guide = {
    kind: "transfer",
    title,
    ticket: ticket ? { ticketNumber: ticket.ticketNumber, title: ticket.title, department: ticket.department, status: ticket.status, statusLabel: ticket.statusLabel, ticketRouteId: ticket.ticketRouteId } : null,
    target,
    targetNote,
    access,
    steps,
    notes,
  };
  const [path, label] = TICKETS_PAGE[role] || TICKETS_PAGE.EMPLOYEE;
  const message = [
    title,
    ticket ? `Ticket ${ticket.ticketNumber} is in ${ticket.department || "no department"}${target && !targetNote ? `; the destination is ${target}` : ""}.` : null,
    targetNote,
    access.text,
    `Steps:\n${numbered(steps)}`,
    `Good to know:\n${notes.map((n) => `• ${n}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");

  return {
    message,
    data: {
      guide,
      headline: ticket ? `Here's how to transfer ticket ${ticket.ticketNumber}${target && !targetNote ? ` to ${target}` : ""}.` : "Here's how to transfer a ticket to another department.",
      ...(ticket ? { lastTicketNumber: ticket.ticketNumber } : {}),
    },
    navigationTarget: ticket ? { type: "route", path: `/tickets/${ticket.ticketRouteId}`, label: `Open Ticket ${ticket.ticketNumber}` } : { type: "route", path, label },
    suggestedActions: canAct ? [{ label: `Transfer ${ticket.ticketNumber} to ${target} here`, prompt: `Transfer ticket ${ticket.ticketNumber} to ${target}` }] : [],
    useModel: false,
    ticketNumbers: ticket ? [ticket.ticketNumber] : [],
  };
}

// ---- an Employee asking to assign or reassign -------------------------------------------------
// The application lets only a Manager or Team Lead of the ticket's department assign or reassign
// (ticket.service.updateTicket's assignment block), even when the ticket is assigned to the Employee.
// Say so, and what they CAN do with a ticket assigned to them. Nothing is changed.
async function assignNotAllowed(ctx, params) {
  let ticket = null;
  let mine = false;
  if (params.ticketNumber) {
    // Only a ticket this user may see (otherwise the usual neutral "not found or no permission").
    ({ ticket } = await runTool("get_authorized_ticket", ctx, { ticketNumber: params.ticketNumber }));
    const row = await prisma.ticket.findFirst({ where: { AND: [{ ticketNumber: ticket.ticketNumber }, authorizedWhere(ctx.scope)] }, select: { assigneeId: true } });
    mine = row?.assigneeId === ctx.scope.userId;
  }
  const lines = [
    `In Solvora only a Manager or Team Lead of the ticket's department${ticket?.department ? ` (${ticket.department})` : ""} can assign or reassign a ticket. Employees can't, even when the ticket is assigned to them.`,
    mine
      ? `Ticket ${ticket.ticketNumber} is assigned to you, so you can change its status, add a comment, or transfer it to another department if another team should handle it.`
      : ticket
        ? `You can still follow ticket ${ticket.ticketNumber} and add comments to it.`
        : "While a ticket is assigned to you, you can change its status, add a comment, or transfer it to another department.",
  ];
  // A refusal (shown as "Not available for your role"), with what they CAN do as one-click next steps.
  throw new ChatError(CODES.ACCESS_DENIED, {
    internal: "employee assign",
    message: lines.join("\n\n"),
    suggestions: ticket
      ? [...(mine ? [{ label: "How to transfer it", prompt: `How do I transfer ticket ${ticket.ticketNumber}` }] : []), { label: "Add a comment", prompt: `Add a comment on ticket ${ticket.ticketNumber}` }, { label: "Show this ticket", prompt: `Show ticket ${ticket.ticketNumber}` }]
      : [{ label: "Tickets assigned to me", prompt: "Show tickets assigned to me" }],
  });
}

function withTicket(ticket, message, data) {
  return {
    message,
    data: { ...data, lastTicketNumber: ticket.ticketNumber },
    navigationTarget: ticketTarget(ticket.ticketRouteId),
    suggestedActions: [],
    useModel: false,
    ticketNumbers: [ticket.ticketNumber],
  };
}

// ---- "What's new": a short digest for the signed-in user, from the same scoped tools -------------
// Every count comes from the database (the tools' totals), limited to what this role may see, and
// covers exactly the window named in the answer: "today" starts at the user's own midnight. Unread
// notifications are a running total (any date) and are labelled that way, never as today's activity.
// A ticket is counted once per section; tickets already shown under "Assigned to you" are not
// shown again under "Your tickets".
const DIGEST_CARDS = 3;
const NOTIFICATION_PEEK = 3;

// "today" / "this week" / "in the last 7 days" / "in Oct 1 – Oct 5, 2026", for sentences.
function periodPhrase(p) {
  if (/^(Today|Yesterday|This week|Last week|This month|Last month|This year)$/.test(p.label)) return p.label.toLowerCase();
  if (/^Last \d+ days$/.test(p.label)) return `in the ${p.label.toLowerCase()}`;
  return `in ${p.rangeText}`;
}

async function whatsNew(ctx, params, question) {
  const role = ctx.scope.role;
  const staff = role !== "EMPLOYEE";
  const period = resolvePeriod({ question, defaultDays: params.days || 7, timeZone: ctx.timeZone });
  if (period.ambiguous) throw new ChatError(CODES.ACTION_INVALID, { message: "I can't tell which day you mean (day/month or month/day). Please write the date like 4 Oct 2026 or 2026-10-04." });
  const updatedWindow = { updatedSince: period.from.toISOString(), updatedUntil: period.to.toISOString() };
  const total = async (input) => (await runTool("search_authorized_tickets", ctx, { limit: 1, ...input })).total;

  const [{ unread, notifications }, updated, assigned, created, unassigned] = await Promise.all([
    runTool("get_my_notifications", ctx, {}),
    runTool("search_authorized_tickets", ctx, { scope: staff ? "staff" : "mine", ...updatedWindow, limit: DIGEST_CARDS * 2 }),
    // Managers and Admins are never assignees, so they have no "assigned to you" section.
    role === "ADMIN" || role === "MANAGER" ? Promise.resolve(null) : runTool("search_authorized_tickets", ctx, { scope: "mine", assignee: "me", ...updatedWindow, limit: DIGEST_CARDS }),
    staff ? total({ scope: "staff", createdSince: period.from.toISOString(), createdUntil: period.to.toISOString() }) : Promise.resolve(null),
    staff ? total({ scope: "staff", filter: "unassigned" }) : Promise.resolve(null),
  ]);

  const when = periodPhrase(period);
  // Notifications created inside the window (from the newest 50 the bell keeps); "50+" if the window holds them all.
  const inWindow = notifications.filter((n) => new Date(n.createdAt) >= period.from && new Date(n.createdAt) < period.to);
  const notificationsInPeriod = { count: inWindow.length, capped: notifications.length >= 50 && inWindow.length === notifications.length };
  const peek = inWindow.slice(0, NOTIFICATION_PEEK).map((n) => ({ title: toPlainText(n.title, 80), message: toPlainText(n.message, 140), ticketNumber: n.ticketNumber, ticketRouteId: n.ticketRouteId, at: new Date(n.createdAt).toISOString(), isRead: n.isRead }));

  const assignedNumbers = new Set((assigned?.tickets || []).map((t) => t.ticketNumber));
  const updatedShown = updated.tickets.filter((t) => !assignedNumbers.has(t.ticketNumber)).slice(0, DIGEST_CARDS);
  const updatedLabel = role === "EMPLOYEE" ? "Your tickets" : role === "ADMIN" ? "All tickets" : "Department tickets";

  const caughtUp = !unread && !notificationsInPeriod.count && !updated.total && !created && !(assigned?.total);
  const digest = {
    period: periodView(period),
    notifications: { unread, inPeriod: notificationsInPeriod.count, inPeriodCapped: notificationsInPeriod.capped, latest: peek },
    assigned: assigned ? { count: assigned.total, tickets: assigned.tickets } : null,
    // `count` is every ticket in this scope updated in the window; the cards skip ones already shown above.
    updated: { label: updatedLabel, count: updated.total, tickets: updatedShown, skippedAssigned: updated.tickets.some((t) => assignedNumbers.has(t.ticketNumber)) },
    created,
    unassigned,
    caughtUp,
  };

  // The same content as plain text (what Copy copies and what the transcript keeps).
  const n = (x, capped) => `${x}${capped ? "+" : ""}`;
  const sections = [
    `Notifications\n• Unread (any date): ${unread}\n• New ${when}: ${n(notificationsInPeriod.count, notificationsInPeriod.capped)}`,
    ...(assigned ? [`Assigned to you\n• Updated or newly assigned ${when}: ${assigned.total}`] : []),
    `${updatedLabel}\n• Updated ${when}: ${updated.total}${created !== null ? `\n• Created ${when}: ${created}` : ""}${unassigned !== null ? `\n• Open with nobody assigned (now): ${unassigned}` : ""}`,
  ];
  const title = `What's New — ${period.label} (${period.rangeText})`;
  const message = caughtUp
    ? `${title}\nYou're all caught up. Nothing new ${when}, and you have no unread notifications.${unassigned ? `\n• Open with nobody assigned (now): ${unassigned}` : ""}`
    : `${title}\n\n${sections.join("\n\n")}`;
  const shown = [...(assigned?.tickets || []), ...updatedShown];

  return {
    message,
    data: { digest, headline: caughtUp ? `You're all caught up ${when === "today" ? "for today" : when}.` : `Here's what's new ${when}.` },
    navigationTarget: null,
    suggestedActions: [
      ...(unread ? [{ label: "Show unread notifications", prompt: "Show unread notifications" }] : []),
      ...(unassigned ? [{ label: "Show unassigned tickets", prompt: "Show unassigned tickets" }] : []),
      ...(assigned?.total ? [{ label: "Tickets assigned to me", prompt: "Show tickets assigned to me" }] : []),
      { label: "My dashboard", prompt: "Show my dashboard summary" },
    ],
    // "The first one" / "open the second" refer to the tickets in the order they are shown.
    state: shown.length ? { frame: { intent: "list_tickets", params: { scope: staff ? "staff" : "mine", filter: "any", mode: "list", page: 1 }, results: shown.map((t) => t.ticketNumber), at: Date.now() } } : undefined,
    useModel: false,
    ticketNumbers: shown.map((t) => t.ticketNumber),
  };
}

// ---- admin changes (preview only; execution needs a separate confirmation) ---

// What to ask when a required detail was not given ("Add an employee to Finance").
const MISSING_QUESTION = {
  user: (a) => (a.department ? `Which person should I use for ${a.department}? Please give their full name.` : "Which person do you mean? Please give their full name."),
  department: () => "Which department do you mean?",
  newName: () => "What should the new name be?",
  name: () => "What should the department be called?",
  priority: () => "Which priority should it be?",
  ticket: () => "Which ticket number?",
  roleName: () => "Which role: Manager, Team Lead or Employee?",
  email: () => "What is their email address?",
  assignee: () => "Who should it be assigned to? Please give their full name.",
  comment: () => "What should the comment say?",
  reason: (a, parsed) => (parsed?.action === "close_ticket" ? "Why are you closing this ticket? The reason is saved with the ticket." : parsed?.action === "reopen_ticket" ? "Why are you reopening this ticket?" : /^resolved$/i.test(a.status || "") ? "What were the resolution notes? (How was it resolved?)" : /on hold/i.test(a.status || "") ? "Why is the ticket being put on hold?" : "What is the reason?"),
  status: () => "Which status: In Progress, On Hold or Resolved?",
  title: () => "What is the ticket about? Give a short subject.",
  description: () => "Please describe the problem in a sentence or two (up to 50 words).",
};

async function adminAction(ctx, params) {
  const parsed = params.parsed;
  // A required detail is missing: ask for it. The next message answers it
  // (conversation state lives in the saved assistant message, server side).
  if (parsed.missing?.length) {
    await precheckAction(ctx, parsed);
    const field = parsed.missing[0];
    let message = (MISSING_QUESTION[field] || (() => "I need one more detail."))(parsed.args, parsed);
    let suggestedActions = [];
    // "Assign ticket N" with nobody named: offer the people who can take it (checked like the action itself).
    if (parsed.action === "assign_ticket" && field === "assignee" && parsed.args.ticket) {
      const { ticketNumber, people, canSelfAssign } = await assigneeChoices(ctx, parsed);
      message = people.length || canSelfAssign
        ? `Who should ticket ${ticketNumber} be assigned to? Pick someone below, or type their name or email.`
        : `Who should ticket ${ticketNumber} be assigned to? No active employee of its department is available to pick; you can type a name or email.`;
      suggestedActions = [...(canSelfAssign ? [{ label: "Assign to me", prompt: "me" }] : []), ...people.map((u) => ({ label: u.name, prompt: u.name }))];
    }
    return {
      message,
      data: {},
      state: { clarification: { kind: "action", parsed: { action: parsed.action, args: parsed.args }, required: parsed.required, field, at: Date.now() } },
      navigationTarget: null,
      suggestedActions,
      useModel: false,
      ticketNumbers: [],
    };
  }
  // How the request was understood is recorded with the proposal (audit): rule / openrouter / conversation_context.
  const pending = await proposeAction(ctx, parsed, { method: ctx.method, intent: ctx.aiIntent });
  // The preview details travel in data.pendingAction (rendered as a card with Confirm/Cancel).
  const message = `I can do that. ${pending.summary} Nothing has been changed yet. Please review the change below and confirm or cancel; this request expires in 10 minutes.`;
  return {
    message,
    data: { pendingAction: { id: pending.id, title: pending.title, summary: pending.summary, impact: pending.impact, expiresAt: pending.expiresAt, confirmationToken: pending.confirmationToken, ...(pending.edit ? { edit: pending.edit } : {}) } },
    navigationTarget: null,
    suggestedActions: [],
    useModel: false,
    ticketNumbers: [],
  };
}

async function adminRedirect(ctx, params) {
  if (ctx.scope.role !== "ADMIN") throw new ChatError(CODES.ACCESS_DENIED);
  const r = REDIRECTS[params.key];
  return {
    message: r.message,
    data: {},
    navigationTarget: r.path ? { type: "route", path: r.path, label: r.label } : null,
    suggestedActions: [],
    useModel: false,
    ticketNumbers: [],
  };
}

// ---- reports (counts / names only; deterministic text, never sent to a model) -----

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const report = (message, data) => ({ message, data, navigationTarget: null, suggestedActions: [], useModel: false, ticketNumbers: [] });

async function departmentHeadcount(ctx) {
  const { departments } = await runTool("get_department_headcount", ctx);
  const lines = departments.map((d) => `${d.name}: ${plural(d.employees, "employee", "employees")}, ${plural(d.managers, "manager", "managers")}, ${plural(d.teamLeads, "team lead", "team leads")}`);
  return report(`Active people by department:
${lines.join("\n")}`, { headcount: departments });
}

async function managerAssignments(ctx, params = {}) {
  let { departments } = await runTool("get_manager_assignments", ctx);
  if (params.department) {
    // "Who manages Support?" — narrow to the named department (typo tolerant).
    const names = matchDepartments(params.department, departments.map((d) => d.name));
    if (!names.length) throw invalid(`I couldn't find a department called "${params.department}". Departments: ${departments.map((d) => d.name).join(", ")}.`);
    departments = departments.filter((d) => names.includes(d.name));
  }
  const lines = departments.map((d) => `${d.name}
  Managers: ${d.managers.join(", ") || "none"}
  Team Leads: ${d.teamLeads.join(", ") || "none"}`);
  return report(`Manager and Team Lead assignments:
${lines.join("\n")}`, { assignments: departments });
}

async function userSummary(ctx, params) {
  const { user } = await runTool("get_user_summary", ctx, { user: params.user });
  const where = user.departments.length ? ` in ${user.departments.join(", ")}` : "";
  return report(`${user.name} is ${/^[AEIOU]/i.test(user.role) ? "an" : "a"} ${user.role}${where} (${user.active ? "active" : "deactivated"}).`, { userSummary: user });
}

async function usersByRole(ctx) {
  const { roles } = await runTool("get_users_by_role", ctx);
  return report(`Active users by role:
${roles.map((r) => `${r.role}: ${r.count}`).join("\n")}`, { roles });
}

async function ticketsByDepartment(ctx, params = {}) {
  const { departments } = await runTool("get_tickets_by_department", ctx);
  if (!departments.length) throw new ChatError(CODES.NO_RESULTS);

  // Ranking is computed HERE, in application code, from the tool's counts. A
  // model never ranks or counts anything.
  if (params.rank) {
    const key = params.rank === "most_total" ? "total" : "open";
    const sorted = [...departments].sort((a, b) => (params.rank === "fewest_open" ? a[key] - b[key] : b[key] - a[key]));
    const top = sorted[0];
    const tied = sorted.filter((d) => d[key] === top[key]).map((d) => d.name);
    const what = params.rank === "most_total" ? "tickets in total" : "open tickets";
    const lead = params.rank === "fewest_open" ? "fewest" : "most";
    // "Most open tickets: IT Support (2)" reads the same whatever the department is called
    // (including tickets that have no department).
    const headline = `${lead === "most" ? "Most" : "Fewest"} ${what}: ${tied.join(" and ")} (${top[key]}${tied.length > 1 ? " each" : ""}).`;
    const lines = sorted.map((d) => `${d.name}: ${d[key]}`);
    return report(`${headline}
All departments (${what}):
${lines.join("\n")}`, { ticketsByDepartment: departments });
  }

  const lines = departments.map((d) => `${d.name}: ${plural(d.total, "ticket", "tickets")} (${d.open} open)`);
  return report(`Tickets by department:
${lines.join("\n")}`, { ticketsByDepartment: departments });
}

async function weeklyReport(ctx) {
  const r = await runTool("get_weekly_report", ctx);
  const statusText = Object.entries(r.byStatus).map(([s, n]) => `${statusLabel(s)} ${n}`).join(", ") || "none";
  const lines = [
    `Weekly ticket report (last 7 days, ${r.from.slice(0, 10)} to ${r.to.slice(0, 10)}):`,
    `Created: ${r.created}   Resolved: ${r.resolved}   Closed: ${r.closed}   Open now: ${r.openNow}`,
    `All tickets by status: ${statusText}`,
  ];
  if (r.createdByDepartment.length) lines.push(`Created by department: ${r.createdByDepartment.map((d) => `${d.name} ${d.count}`).join(", ")}`);
  if (r.createdByPriority.length) lines.push(`Created by priority: ${r.createdByPriority.map((p) => `${p.name} ${p.count}`).join(", ")}`);
  return report(lines.join("\n"), { weeklyReport: r });
}

// ---- features this application does not have --------------------------------

async function notTracked(ctx, what) {
  await runTool("get_sla_information", ctx);
  return {
    message: `This application doesn't track ${what}, so I can't list or count them. Priority and last-update time are recorded, so I can show tickets with no recent activity instead.`,
    data: { slaTracked: false },
    navigationTarget: null,
    suggestedActions: staffFollowUps(ctx.scope.role),
    useModel: false,
    ticketNumbers: [],
  };
}

async function help(ctx) {
  const { capabilities } = await runTool("get_portal_capabilities", ctx);
  const portal = portalFor(ctx.scope.role);
  return {
    message: `I'm the ${portal?.name || "portal"} assistant. Here's what I can do for you:\n${capabilities.map((c) => `• ${c}`).join("\n")}\nI can only read and explain — I can't change tickets.`,
    data: { capabilities },
    navigationTarget: null,
    suggestedActions: [],
    useModel: false,
    ticketNumbers: [],
  };
}

const HANDLERS = {
  help: (ctx) => help(ctx),
  view_profile: viewProfile,
  list_tickets: listTickets,
  person_lookup: personLookup,
  ticket_scope_question: ticketScopeQuestion,
  which_ticket_question: whichTicket,
  dashboard_overview: dashboardOverview,
  ask_person: askPerson,
  status_or_list_question: statusOrListQuestion,
  ticket_draft: (ctx, _params, question) => require("../ticketDraft/flow").start(ctx, question),
  dashboard_summary: dashboardSummary,
  notifications: notificationsList,
  whats_new: whatsNew,
  ticket_comments: ticketComments,
  ticket_reasons: ticketReasons,
  ticket_dates: ticketDates,
  ticket_attachments: ticketAttachments,
  ticket_people: ticketPeople,
  transfer_guidance: transferGuidance,
  assign_not_allowed: assignNotAllowed,
  search_tickets: (ctx, p) => listTickets(ctx, { ...p, filter: p.filter || "any", title: p.title || `Tickets matching "${p.text}"` }),
  list_departments: listDepartments,
  people_directory: peopleDirectory,
  admin_action: adminAction,
  clarification_required: (ctx, p) => ({ message: p.question, data: {}, state: p.state, navigationTarget: null, suggestedActions: [], useModel: false, ticketNumbers: [] }),
  admin_redirect: adminRedirect,
  department_headcount: departmentHeadcount,
  manager_assignments: managerAssignments,
  users_by_role: usersByRole,
  user_summary: userSummary,
  tickets_by_department: ticketsByDepartment,
  weekly_report: weeklyReport,
  find_ticket: findTicket,
  summarize_ticket: (ctx, p) => (needsTicket(ctx, p) ? askForTicket() : summarizeTicket(ctx, p)),
  latest_update: (ctx, p) => (needsTicket(ctx, p) ? askForTicket() : latestUpdate(ctx, p)),
  pending_actions: (ctx, p) => (needsTicket(ctx, p) ? askForTicket() : pendingActions(ctx, p)),
  ticket_history: (ctx, p) => (needsTicket(ctx, p) ? askForTicket() : ticketHistory(ctx, p)),
  summarize_tickets: summarizeTickets,
  ticket_statistics: ticketStatistics,
  overdue_tickets: (ctx) => notTracked(ctx, "due dates, SLAs or overdue status"),
  sla_approaching: (ctx) => notTracked(ctx, "SLA targets"),
  escalated_tickets: (ctx) => notTracked(ctx, "escalation status"),
  search_prompt: () => ({
    message: "What should I search for? For example: Find tickets about printer.",
    data: {},
    navigationTarget: null,
    suggestedActions: [],
    useModel: false,
    ticketNumbers: [],
  }),
  invalid_ticket_ref: () => {
    throw new ChatError(CODES.INVALID_TICKET_ID);
  },
  restricted_feature: () => {
    throw new ChatError(CODES.ACCESS_DENIED, { internal: "feature of another role" });
  },
  unsupported: () => {
    throw new ChatError(CODES.UNSUPPORTED_INTENT);
  },
};

// Anything not in HANDLERS is a guidance intent backed by a KB article.
function handlerFor(intent) {
  return HANDLERS[intent] || guidance;
}

module.exports = { handlerFor, HANDLERS, visibleDepartmentNames, resolvePerson };
