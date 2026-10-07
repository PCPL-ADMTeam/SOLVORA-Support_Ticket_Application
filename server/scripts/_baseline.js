const { classify } = require("../src/chatbot/intents/router");
const qs = [
  "show my tickets", "give me my tickets", "what tickets have I raised", "show tickets raised by me", "what support requests did I create", "list my tickets",
  "tickets assigned to me", "show my open tickets", "show open tickets", "what tickets are open", "list open support tickets", "show resolved tickets", "show closed tickets",
  "show ticket 2600269", "show tickets in Hardware", "show open tickets in BI/Copilot", "show Manoj's tickets", "show Manoj's open tickets",
  "tickets raised by Manoj", "tickets assigned to Manoj", "how many open tickets are in Hardware", "how many tickets in BI/Copilot",
  "who is the manager in BI/Copilot", "who are the managers in BI/Copilot", "who are the team leads in BI/Copilot", "who are the employees in BI/Copilot",
  "who manages Hardware", "show people in Cloud", "how many people are in Hardware", "show Manoj", "show tickets", "show manager", "show people",
  "only open ones", "only resolved",
];
for (const role of ["ADMIN", "EMPLOYEE"]) {
  for (const q of qs) {
    const c = classify(q, role);
    console.log("@@", role.padEnd(8), q.padEnd(44), c.intent, JSON.stringify(c.params), c.confidence);
  }
}
