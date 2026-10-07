const { article, route } = require("../schema");
const { shared } = require("../team-lead/articles");

// Shared agent-portal articles are reused as-is (see team-lead/articles.js).
module.exports = [
  ...shared,
  article({
    id: "manager.departments",
    title: "How department scope works for Managers",
    roles: ["MANAGER"],
    feature: "Department access",
    route: route("/agent", "Open Dashboard"),
    steps: [
      "A Manager can be given access to several departments by an administrator.",
      "The Dashboard and Tickets pages cover all of them by default; use the Department selector to focus on one.",
      "Tickets in departments you do not have access to are not visible to you or to me.",
    ],
    keywords: ["department scope", "my departments", "which departments", "department access"],
  }),
];
