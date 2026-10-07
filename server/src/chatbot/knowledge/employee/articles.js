const { article, route } = require("../schema");

module.exports = [
  article({
    id: "employee.create-ticket",
    title: "How to create a ticket",
    roles: ["EMPLOYEE"],
    feature: "Raise a Ticket",
    route: route("/portal/new-ticket", "Open Raise a Ticket"),
    steps: [
      "Select Raise a Ticket in the left sidebar (or the Create Ticket button in the header).",
      "Fill in the Title, Priority, Department and Problem Summary (required; keep it short).",
      "Optionally add attachments and Custom CC people.",
      "Select Raise a Ticket to submit.",
    ],
    warning: "You need a home department on your account to raise a ticket. Contact an administrator if the form says it is missing.",
    keywords: ["create ticket", "create a ticket", "raise ticket", "new ticket", "open a ticket", "submit ticket", "log a ticket", "raise a ticket"],
  }),
  article({
    id: "employee.my-tickets",
    title: "How to view your tickets",
    roles: ["EMPLOYEE"],
    feature: "Tickets",
    route: route("/portal/my-tickets", "Open My Tickets"),
    steps: [
      "Select Tickets in the left sidebar.",
      "Use the filters to narrow by status or priority; select a row to open the ticket.",
    ],
    keywords: ["my tickets", "view tickets", "ticket list", "tickets page", "where are my tickets"],
  }),
  article({
    id: "employee.dashboard",
    title: "Explain the employee dashboard",
    roles: ["EMPLOYEE"],
    feature: "Dashboard",
    route: route("/portal", "Open Dashboard"),
    steps: [
      "Select Dashboard in the left sidebar.",
      "It summarizes your tickets by status and priority.",
      "Select a card to jump to the matching tickets.",
    ],
    keywords: ["dashboard", "home", "overview", "portal"],
  }),
  article({
    id: "employee.close-reopen",
    title: "How to close or reopen a ticket",
    roles: ["EMPLOYEE"],
    feature: "Reopen Ticket",
    route: route("/portal/my-tickets", "Open My Tickets"),
    steps: [
      "Open the ticket from Tickets.",
      "If a ticket you raised is Resolved or Closed, select Reopen Ticket at the top of the ticket page.",
    ],
    warning: "Employees cannot close tickets they raised; closing is done by the person working the ticket or their department's management.",
    keywords: ["close ticket", "reopen", "re-open", "reopen ticket", "close a ticket"],
  }),
  article({
    id: "employee.assignment",
    title: "How assignment works",
    roles: ["EMPLOYEE"],
    feature: "Assignment",
    steps: [
      "Tickets are assigned by a Team Lead or Manager of the ticket's department.",
      "As an employee you can see who a ticket is assigned to on the ticket page, but you cannot assign or reassign tickets.",
    ],
    keywords: ["assign", "assignment", "assigned", "reassign", "who is working"],
  }),
];
