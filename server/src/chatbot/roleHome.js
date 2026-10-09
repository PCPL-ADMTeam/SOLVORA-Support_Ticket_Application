// The assistant's home screen for each role: the greeting line, four to six quick actions, and the
// "What I can do" list. The SERVER decides this from the authenticated role (the browser never
// picks a role); each quick action is an ordinary question that goes through the same rules, role
// scope and checks as if it had been typed, so a role is never offered something it cannot do.
// The regression suite sends every quick action as every role it is offered to.

const ACTION = (label, prompt, icon) => ({ label, prompt, icon });

const HOME = {
  EMPLOYEE: {
    subtitle: "How can I help you with your tickets today?",
    quickActions: [
      ACTION("My Tickets", "Show my tickets", "tickets"),
      ACTION("Open Tickets", "Show my open tickets", "open"),
      ACTION("Raise Ticket", "Raise a ticket", "raise"),
      ACTION("Notifications", "Show my notifications", "notifications"),
    ],
    capabilities: [
      { title: "Tickets", items: ["View your tickets", "Check a ticket's status, priority and assignee", "View tickets assigned to you", "Raise a ticket, with attachments"] },
      { title: "Notifications", items: ["View your notifications"] },
      { title: "Guidance", items: ["Ask how to use Solvora"] },
    ],
  },
  TEAMLEAD: {
    subtitle: "How can I help you manage your department tickets today?",
    quickActions: [
      ACTION("My Tickets", "Show my tickets", "tickets"),
      ACTION("Department Tickets", "Show my department tickets", "department"),
      ACTION("Unassigned", "Show unassigned tickets", "unassigned"),
      ACTION("Assigned to Me", "Show tickets assigned to me", "assigned"),
      ACTION("Ticket Summary", "Show department ticket summary", "summary"),
      ACTION("Notifications", "Show my notifications", "notifications"),
    ],
    capabilities: [
      { title: "Tickets", items: ["View your department's tickets", "Filter by status, priority, assignee or date", "Assign, reassign and transfer tickets (you confirm first)", "Add comments and change status"] },
      { title: "Department", items: ["View the people in your department", "View employee workload"] },
      { title: "Analytics", items: ["View your department's ticket summary and trends"] },
      { title: "Notifications", items: ["View your notifications"] },
      { title: "Guidance", items: ["Ask how to use Solvora"] },
    ],
  },
  MANAGER: {
    subtitle: "How can I help you manage your departments and tickets today?",
    quickActions: [
      ACTION("Department Tickets", "Show my department tickets", "department"),
      ACTION("Unassigned Tickets", "Show unassigned tickets", "unassigned"),
      ACTION("My Tickets", "Show my tickets", "tickets"),
      ACTION("Ticket Summary", "Show ticket summary by department", "summary"),
      ACTION("Employee Workload", "Show employee workload", "workload"),
      ACTION("Notifications", "Show my notifications", "notifications"),
    ],
    capabilities: [
      { title: "Tickets", items: ["View tickets in your authorized departments", "View unassigned tickets", "Assign and reassign tickets (you confirm first)"] },
      { title: "Departments", items: ["View department summaries", "View department and employee workload"] },
      { title: "Analytics", items: ["View ticket trends, status and priority summaries"] },
      { title: "Notifications", items: ["View your notifications"] },
      { title: "Guidance", items: ["Ask how to use Solvora"] },
    ],
  },
  ADMIN: {
    subtitle: "How can I help you manage Solvora today?",
    quickActions: [
      ACTION("All Tickets", "Show all tickets", "tickets"),
      ACTION("Users", "Show employees", "users"),
      ACTION("Departments", "Show all departments", "departments"),
      ACTION("Ticket Summary", "Show ticket summary", "summary"),
      ACTION("Ticket Trends", "Show ticket trends", "trends"),
      ACTION("Notifications", "Show my notifications", "notifications"),
    ],
    capabilities: [
      { title: "Tickets", items: ["View system-wide tickets", "Search and filter tickets"] },
      { title: "Users", items: ["Search employees and users", "View managers and team leads by department"] },
      { title: "Departments", items: ["View department information and workload"] },
      { title: "Analytics", items: ["View system-wide ticket summaries and trends"] },
      { title: "Notifications", items: ["View your notifications"] },
      { title: "Guidance", items: ["Ask how to use Solvora and how roles work"] },
    ],
  },
};

// Offered on every role's home, under the greeting: the "what's new" digest (same rules and scope as typed).
const WHATS_NEW = { label: "What's New today", prompt: "What's new today" };

const homeFor = (role) => HOME[role] || null;

module.exports = { homeFor, HOME, WHATS_NEW };
