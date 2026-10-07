const { article, route } = require("../schema");

// MANAGER and TEAMLEAD share one portal (/agent), so the navigation-facing
// articles are defined once here and re-used by the manager folder — never
// duplicated.
const shared = [
  article({
    id: "agent.create-ticket",
    title: "How to create a ticket",
    roles: ["TEAMLEAD", "MANAGER"],
    feature: "Raise a Ticket",
    route: route("/agent/new-ticket", "Open Raise a Ticket"),
    steps: [
      "Select Raise a Ticket in the left sidebar (or the Create Ticket button in the header).",
      "Fill in the Title, Priority, Department and Problem Summary.",
      "Optionally add attachments and Custom CC people, then select Raise a Ticket.",
    ],
    keywords: ["create ticket", "create a ticket", "raise ticket", "new ticket", "open a ticket", "raise a ticket"],
  }),
  article({
    id: "agent.tickets",
    title: "How to manage department tickets",
    roles: ["TEAMLEAD", "MANAGER"],
    feature: "Tickets",
    route: route("/agent/queue", "Open Tickets"),
    steps: [
      "Select Tickets in the left sidebar.",
      "Use the My Tickets tab for tickets you raised or are assigned to, and the Department Tickets tab for every ticket routed to a department you have access to.",
      "Filter by status, priority, assignee or department, then select a ticket to open it.",
    ],
    keywords: ["manage team tickets", "manage tickets", "queue", "tickets page", "view tickets"],
  }),
  article({
    id: "agent.dashboard",
    title: "Explain the dashboard",
    roles: ["TEAMLEAD", "MANAGER"],
    feature: "Dashboard",
    route: route("/agent", "Open Dashboard"),
    steps: [
      "Select Dashboard in the left sidebar.",
      "My Dashboard shows tickets you raised or are assigned to; Department Dashboard shows counts for the departments you have access to (total, unassigned, and per status).",
      "Use the Department selector to focus on one department; select a card or chart slice to open the matching tickets.",
    ],
    keywords: ["dashboard", "team dashboard", "manager dashboard", "overview", "charts", "kpi"],
  }),
  article({
    id: "agent.assignment",
    title: "How assignment works",
    roles: ["TEAMLEAD", "MANAGER"],
    feature: "Assign / Reassign",
    route: route("/agent/queue", "Open Tickets"),
    steps: [
      "Open the ticket from Tickets.",
      "Select Assign Ticket (or Reassign if it already has an assignee).",
      "Pick an eligible person, optionally add an assignment comment, and save.",
    ],
    warning: "Only active employees of the ticket's department can be assigned (a Team Lead can also assign to another Team Lead of that department). Managers cannot be assigned tickets, and Admins cannot assign. I can't assign for you.",
    keywords: ["assign", "assignment", "reassign", "assign ticket", "assign a ticket"],
  }),
  article({
    id: "agent.transfer",
    title: "How to transfer a ticket to another department",
    roles: ["TEAMLEAD", "MANAGER"],
    feature: "Transfer Department",
    route: route("/agent/queue", "Open Tickets"),
    steps: [
      "Open the ticket from Tickets.",
      "Select Transfer Department.",
      "Choose the destination department, enter a Transfer Reason, and save.",
    ],
    keywords: ["transfer", "move ticket", "transfer department", "another department"],
  }),
  article({
    id: "agent.close-reopen",
    title: "How to close or reopen a ticket",
    roles: ["TEAMLEAD", "MANAGER"],
    feature: "Status changes",
    route: route("/agent/queue", "Open Tickets"),
    steps: [
      "Open the ticket and select Edit Ticket.",
      "Change the status. Resolving requires resolution notes, putting on hold requires a reason, and closing requires a closing reason.",
      "To reopen a Resolved or Closed ticket, select Reopen Ticket or set the status to Reopened.",
    ],
    keywords: ["close ticket", "reopen", "re-open", "close a ticket", "reopen ticket"],
  }),
];

const teamLeadOnly = [
  article({
    id: "teamlead.workload",
    title: "How to see team workload",
    roles: ["TEAMLEAD"],
    feature: "Department Dashboard",
    route: route("/agent", "Open Dashboard"),
    steps: [
      "Select Dashboard in the left sidebar and open the Department Dashboard tab.",
      "The Employee Workload table lists employees of your department with their ticket counts; select a row to filter by that employee.",
    ],
    keywords: ["workload", "team workload", "employee workload", "who is busy"],
  }),
];

module.exports = { shared, articles: [...shared, ...teamLeadOnly] };
