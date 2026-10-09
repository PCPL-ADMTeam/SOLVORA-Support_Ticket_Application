const { ChatError, CODES } = require("../chatbot.errors");
const { runTool } = require("../tools");
const { resolveDepartment } = require("../actions/resolvers");
const { statusLabel } = require("../dto");

// Dashboard-style answers: priority summary, status summary and workload (ticket trends are the existing statistics answer). The numbers come
// from the dashboard service (via the get_dashboard_overview tool), so they are exactly the
// numbers on the Dashboard pages, for the department scope this user may see.

const reply = (message, extra = {}) => ({ message, data: {}, navigationTarget: null, suggestedActions: [], useModel: false, ticketNumbers: [], ...extra });
const scopeLabel = (role) => (role === "EMPLOYEE" ? "Your tickets" : role === "TEAMLEAD" ? "Your department" : role === "MANAGER" ? "Your departments" : "All departments");

async function visibleDepartments(ctx) {
  return (await runTool("list_departments", ctx)).departments;
}

// "Show employee workload in Hardware": a named department, only among the ones this user may see.
async function pickDepartment(ctx, name) {
  const visible = await visibleDepartments(ctx);
  return resolveDepartment(name, visible);
}

async function dashboardOverview(ctx, params) {
  const role = ctx.scope.role;
  const view = params.view;
  // Workload is a staff view: an Employee only has their own tickets.
  if (view === "workload" && role === "EMPLOYEE") throw new ChatError(CODES.ACCESS_DENIED, { internal: "workload for employee" });

  let departmentId;
  let departmentName;
  if (view === "workload" && params.department) {
    const d = await pickDepartment(ctx, params.department);
    departmentId = d.id;
    departmentName = d.name;
  } else if (view === "workload" && role === "MANAGER") {
    // A Manager with exactly one department goes straight to its employees; with several, the departments come first.
    const visible = await visibleDepartments(ctx);
    if (visible.length === 1) {
      const d = await resolveDepartment(visible[0], visible);
      departmentId = d.id;
      departmentName = d.name;
    }
  }

  const o = await runTool("get_dashboard_overview", ctx, { ...(departmentId ? { departmentId } : {}) });
  const label = departmentName || scopeLabel(role);
  // These counts are not limited to a date range (no dateFrom is sent), so the card says "All time".
  const PERIOD = "All time";

  if (view === "priority") {
    const rows = o.byPriority.filter((p) => p.count > 0);
    if (!o.total) throw new ChatError(CODES.NO_RESULTS);
    const heading = `${label}, tickets by priority (${o.total} in total):`;
    return reply(`${heading}\n${(rows.length ? rows : o.byPriority).map((p) => `• ${p.priority}: ${p.count}`).join("\n")}`, {
      data: { overview: { kind: "priority", title: "Tickets by priority", scope: label, period: PERIOD, total: o.total, rows: o.byPriority.map((p) => ({ label: p.priority, count: p.count })) }, headline: heading.replace(/:$/, ".") },
      suggestedActions: [{ label: "Status summary", prompt: "Show status summary" }],
    });
  }

  if (view === "status") {
    if (!o.total) throw new ChatError(CODES.NO_RESULTS);
    const heading = `${label}, tickets by status (${o.total} in total):`;
    return reply(`${heading}\n${o.byStatus.map((s) => `• ${statusLabel(s.status)}: ${s.count}`).join("\n")}`, {
      data: { overview: { kind: "status", title: "Tickets by status", scope: label, period: PERIOD, total: o.total, rows: o.byStatus.map((s) => ({ status: s.status, label: statusLabel(s.status), count: s.count })) }, headline: heading.replace(/:$/, ".") },
      suggestedActions: [{ label: "Priority summary", prompt: "Show priority summary" }],
    });
  }

  // workload
  const COLUMNS = ["Open", "In progress", "Resolved", "Closed"];
  if (o.workload.length) {
    const lines = o.workload.map((w) => `• ${w.agentName}: ${w.openTickets} open, ${w.inProgressTickets} in progress, ${w.resolvedTickets} resolved, ${w.closedTickets} closed`);
    const heading = `Employee workload${departmentName ? ` in ${departmentName}` : ""}`;
    return reply(`${heading}:\n${lines.join("\n")}`, {
      data: { overview: { kind: "workload", title: heading, scope: departmentName || label, period: PERIOD, columns: COLUMNS, note: "Open counts every ticket not yet Resolved or Closed.", rows: o.workload.map((w) => ({ label: w.agentName, values: [w.openTickets, w.inProgressTickets, w.resolvedTickets, w.closedTickets] })) }, headline: `${heading}.` },
    });
  }
  if (o.departmentWorkload.length) {
    const lines = o.departmentWorkload.map((d) => `• ${d.departmentName}: ${d.openTickets} open, ${d.inProgressTickets} in progress, ${d.resolvedTickets} resolved, ${d.closedTickets} closed`);
    return reply(`Workload by department:\n${lines.join("\n")}\nAsk for one department to see its employees.`, {
      data: { overview: { kind: "workload", title: "Workload by department", scope: label, period: PERIOD, columns: COLUMNS, rows: o.departmentWorkload.map((d) => ({ label: d.departmentName, values: [d.openTickets, d.inProgressTickets, d.resolvedTickets, d.closedTickets] })) }, headline: "Workload by department. Pick one to see its employees." },
      suggestedActions: o.departmentWorkload.slice(0, 4).map((d) => ({ label: d.departmentName, prompt: `Show employee workload in ${d.departmentName}` })),
    });
  }
  throw new ChatError(CODES.NO_RESULTS, { message: "There is no workload to show yet." });
}

// "Search employee" / "tickets assigned to an employee": the person was not named, so ask.
async function askPerson(ctx) {
  if (ctx.scope.role === "EMPLOYEE") throw new ChatError(CODES.ACCESS_DENIED, { internal: "people lookup for employee" });
  return reply('Which employee do you mean? Type their name, for example "Find Jamie" or "Show tickets assigned to Jamie".');
}

module.exports = { dashboardOverview, askPerson };
