const { COMMON_RULES, PROMPT_CANARY } = require("./common");

const ROLE_PROMPTS = {
  EMPLOYEE: require("./employee"),
  TEAMLEAD: require("./teamLead"),
  MANAGER: require("./manager"),
  ADMIN: require("./admin"),
};

// Role is always the server-derived one; there is no default/fallback role
// prompt — an unknown role gets no prompt (and the service refuses it).
function buildSystemPrompt(roleName) {
  const rolePrompt = ROLE_PROMPTS[roleName];
  if (!rolePrompt) return null;
  return `${COMMON_RULES}\n\n${rolePrompt}`;
}

module.exports = { buildSystemPrompt, PROMPT_CANARY, ROLE_PROMPTS };
