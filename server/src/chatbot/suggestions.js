const { portalFor } = require("./roleScope");

// Role-specific starter prompts, served by GET /chatbot/suggestions so the
// widget renders what the SERVER authorizes for the authenticated role — the
// frontend never picks a role.
//
// Deviation from the original request, on purpose: prompts about overdue /
// SLA exception / escalated tickets are replaced with prompts this
// application can really answer (it tracks neither SLAs nor escalation — see
// docs/chatbot-repository-analysis.md).
const SUGGESTIONS = {
  EMPLOYEE: [
    "Show my open tickets",
    "Summarize a ticket",
    "How do I create a ticket?",
    "How do I change my password?",
    "Where can I view my profile?",
  ],
  TEAMLEAD: [
    "Show team tickets",
    "Show unassigned tickets",
    "Show tickets with no recent activity",
    "How do I assign a ticket?",
    "Explain the team dashboard",
  ],
  MANAGER: [
    "Show department ticket summary",
    "Show unassigned tickets",
    "Show tickets with no recent activity",
    "Explain the manager dashboard",
    "Show ticket trends",
  ],
  ADMIN: [
    "Show overall ticket summary",
    "How do I manage users?",
    "Explain notification settings",
  ],
};

function getSuggestions(user) {
  const role = user.role.name;
  const portal = portalFor(role);
  if (!portal) return null;
  return {
    portal: portal.name,
    role,
    welcomeMessage: `Hi ${String(user.name || "").split(" ")[0] || "there"}! I'm your ${portal.name} assistant. Ask me about your tickets or how to use this portal.`,
    suggestions: SUGGESTIONS[role],
  };
}

module.exports = { getSuggestions, SUGGESTIONS };
