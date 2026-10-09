// Deterministic parser for "do something" requests. It recognizes a fixed set
// of imperative phrasings from the user's OWN message and returns raw string
// arguments; it never looks at ticket content, and nothing here changes data.
// Names are resolved to real records, validated, and previewed later by the
// action registry; execution happens only after an explicit confirmation.

const { normalizeStatusPhrases, needsReason } = require("./statusPhrases");

const Q = "[\"“”']?"; // optional quote
const NAME = `${Q}(.+?)${Q}`;
const END = "\\s*[.!?]*$";
const ROLE_WORD = "(manager|team ?lead)";
const AS = "(?:as\\s+(?:the\\s+|a\\s+|an\\s+)?|to\\s+be\\s+(?:the\\s+|a\\s+)?)?";

const clean = (s) => (s === undefined || s === null ? undefined : String(s).trim());
const unquote = (v) => clean(String(v).replace(/^[\"“”']+|[\"“”']+$/g, ""));
const roleKey = (w) => (/team/i.test(w) ? "TEAMLEAD" : "MANAGER");

// Names are short; a long "name" means the sentence was free-form, not a command.
const shortName = (v) => typeof v === "string" && v.trim().split(/\s+/).length <= 4;
const PRONOUN = /^(someone|somebody|anyone|anybody|them|him|her|people|everyone)$/i;


// Splits "for Demo laptop to hardware team" / "to hardware department that I need a laptop" into
// { department, title, description } using only the user's words. Null when no explicit
// department/team marker is present.
function parseTicketRest(rest) {
  // Greedy prefix: the LAST "to/for/in <name> department|team" is the department.
  const dep = rest.match(/^(.*)\b(?:to|for|in|under)\s+(?:the\s+)?([a-z][\w&\-]*(?:\s+[\w&\-]+){0,2})\s+(?:department|dept|team)\b(.*)$/i);
  if (!dep) return null;
  const before = dep[1].trim().replace(/^(?:for|about|regarding|titled|called|named)\s+/i, "").replace(/[:\-]+$/, "").trim();
  let after = dep[3].trim().replace(/^[:\-]+\s*/, "");
  let title = before || undefined;
  let description;
  const lead = after.match(/^(?:that|saying|says|because|with|where|as)\s+(.+)$/i);
  if (lead) description = lead[1];
  else if (/^(?:about|regarding|for)\s+/i.test(after)) {
    const t = after.replace(/^(?:about|regarding|for)\s+/i, "");
    if (title) description = t;
    else title = t;
  } else if (after) description = after;
  return { department: clean(dep[2]), title: clean(title), description: clean(description) };
}

const RULES = [
  // The signed-in user's own notifications.
  {
    action: "mark_all_notifications_read",
    re: new RegExp(`^(?:please\\s+)?(?:(?:mark|set)\\s+(?:all\\s+)?(?:(?:of\\s+)?my\\s+)?(?:all\\s+)?notifications?\\s+(?:as\\s+)?read|read\\s+all\\s+(?:my\\s+)?notifications?|mark\\s+everything\\s+as\\s+read)${END}`, "i"),
    args: () => ({}),
  },
  {
    action: "mark_notification_read",
    re: new RegExp(`^(?:please\\s+)?mark\\s+(?:the\\s+|this\\s+|that\\s+|my\\s+)?(?:latest\\s+|newest\\s+|first\\s+|last\\s+|most recent\\s+)?notification\\s+as\\s+read${END}`, "i"),
    args: () => ({}),
  },
  {
    action: "clear_notifications",
    re: new RegExp(`^(?:please\\s+)?(?:clear|delete|remove|empty|dismiss)\\s+(?:all\\s+)?(?:of\\s+)?(?:my\\s+)?(?:all\\s+)?notifications?${END}`, "i"),
    args: () => ({}),
  },
  {
    action: "create_department",
    re: new RegExp(`^(?:please\\s+)?(?:create|add|make)\\s+(?:a\\s+)?(?:new\\s+)?department\\s+(?:(?:called|named|name)\\s+)?${NAME}${END}`, "i"),
    args: (m) => ({ name: clean(m[1]) }),
  },
  // "change department for Ravi to Cloud" / "change Ravi's department to Cloud" is a person's move, not a rename.
  {
    action: "move_user_department",
    re: new RegExp(`^(?:please\\s+)?(?:change|update|set|switch|move)\\s+(?:the\\s+)?department\\s+(?:for|of)\\s+${NAME}\\s+(?:to|into|as)\\s+(?:the\\s+)?${NAME}(?:\\s+department)?${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), department: clean(m[2]) }),
    guard: (a) => shortName(a.department) && shortName(a.user),
  },
  {
    action: "move_user_department",
    re: new RegExp(`^(?:please\\s+)?(?:change|update|set|switch)\\s+${NAME}['’]?s\\s+department\\s+(?:to|into|as)\\s+(?:the\\s+)?${NAME}(?:\\s+department)?${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), department: clean(m[2]) }),
    guard: (a) => shortName(a.department) && shortName(a.user),
  },
  // Department rename, in the phrasings people actually use:
  //   rename department X to Y / change the department X to Y / change the name of department X to Y
  {
    action: "rename_department",
    re: new RegExp(`^(?:please\\s+)?(?:rename|change|update|edit)\\s+(?:the\\s+)?(?:name\\s+of\\s+(?:the\\s+)?)?department\\s+${NAME}\\s+(?:to|as|into)\\s+${NAME}${END}`, "i"),
    args: (m) => ({ department: clean(m[1]), newName: clean(m[2]) }),
  },
  {
    action: "rename_department",
    re: new RegExp(`^(?:please\\s+)?rename\\s+${NAME}\\s+department\\s+(?:to|as|into)\\s+${NAME}${END}`, "i"),
    args: (m) => ({ department: clean(m[1]), newName: clean(m[2]) }),
  },
  // Person rename (name only; email, login and role are untouched):
  //   rename user X to Y / change the name of employee X to Y / change X's name to Y / rename X to Y
  {
    action: "rename_user",
    re: new RegExp(`^(?:please\\s+)?(?:rename|change|update|edit)\\s+(?:the\\s+)?(?:name\\s+of\\s+(?:the\\s+)?)?(?:user|employee|account|person|manager|team\\s?lead)\\s+${NAME}\\s+(?:to|as|into)\\s+${NAME}${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), newName: clean(m[2]) }),
  },
  {
    action: "rename_user",
    re: new RegExp(`^(?:please\\s+)?(?:change|update|edit)\\s+${NAME}['’]s\\s+name\\s+(?:to|as|into)\\s+${NAME}${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), newName: clean(m[2]) }),
  },
  {
    action: "rename_user",
    re: new RegExp(`^(?:please\\s+)?rename\\s+${NAME}\\s+(?:to|as|into)\\s+${NAME}${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), newName: clean(m[2]) }),
  },
  {
    action: "grant_department_role",
    re: new RegExp(`^(?:please\\s+)?(?:assign|make|set|add|appoint)\\s+${NAME}\\s+${AS}${ROLE_WORD}\\s+(?:for|of|to|in)\\s+(?:the\\s+)?${NAME}(?:\\s+department)?${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), role: roleKey(m[2]), department: clean(m[3]) }),
  },
  {
    action: "revoke_department_role",
    re: new RegExp(`^(?:please\\s+)?(?:remove|revoke|unassign)\\s+${NAME}\\s+(?:as\\s+(?:the\\s+|a\\s+)?|from\\s+being\\s+(?:the\\s+|a\\s+)?)${ROLE_WORD}\\s+(?:of|for|from|in)\\s+(?:the\\s+)?${NAME}(?:\\s+department)?${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), role: roleKey(m[2]), department: clean(m[3]) }),
  },
  {
    action: "deactivate_user",
    re: new RegExp(`^(?:please\\s+)?(?:deactivate|disable|suspend)\\s+(?:the\\s+)?(?:user\\s+|account\\s+(?:of\\s+|for\\s+)?)?${NAME}${END}`, "i"),
    args: (m) => ({ user: clean(m[1]) }),
  },
  {
    action: "activate_user",
    re: new RegExp(`^(?:please\\s+)?(?:activate|enable|reactivate)\\s+(?:the\\s+)?(?:user\\s+|account\\s+(?:of\\s+|for\\s+)?)?${NAME}${END}`, "i"),
    args: (m) => ({ user: clean(m[1]) }),
  },
  {
    action: "change_user_role",
    re: new RegExp(`^(?:please\\s+)?(?:change|set|update)\\s+(?:the\\s+)?role\\s+(?:of|for)\\s+${NAME}\\s+to\\s+(?:an?\\s+)?(admin|manager|team ?lead|employee)${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), roleName: m[2].toUpperCase().replace(/\s+/g, "") }),
  },
  // "Add an employee to Finance": the person is not named yet, so the user is asked.
  {
    action: "move_user_department",
    re: new RegExp(`^(?:please\\s+)?(?:add|put|place|assign)\\s+(?:an?\\s+|one\\s+)?(?:new\\s+)?(?:employee|user|person|member|staff(?:\\s+member)?|someone|somebody)\\s+(?:to|into)\\s+(?:the\\s+)?${NAME}(?:\\s+department)?${END}`, "i"),
    args: (m) => ({ department: clean(m[1]) }),
    guard: (a) => shortName(a.department),
  },
  {
    action: "move_user_department",
    re: new RegExp(`^(?:please\\s+)?(?:move|transfer)\\s+${NAME}\\s+(?:to|into)\\s+(?:the\\s+)?${NAME}(?:\\s+department)?${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), department: clean(m[2]) }),
    guard: (a) => shortName(a.department) && shortName(a.user),
  },
  {
    action: "move_user_department",
    re: new RegExp(`^(?:please\\s+)?(?:add|put|place)\\s+${NAME}\\s+(?:to|into)\\s+(?:the\\s+)?${NAME}(?:\\s+department)?${END}`, "i"),
    args: (m) => ({ user: clean(m[1]), department: clean(m[2]) }),
    guard: (a) => shortName(a.department) && shortName(a.user) && !PRONOUN.test(a.user),
  },
  {
    action: "change_ticket_priority",
    re: new RegExp(`^(?:please\\s+)?(?:change|set|update|raise|lower)\\s+(?:the\\s+)?priority\\s+(?:of|for|on)\\s+ticket\\s+#?(\\S+)\\s+to\\s+${NAME}${END}`, "i"),
    args: (m) => ({ ticket: clean(m[1]), priority: clean(m[2]) }),
  },
  {
    action: "change_ticket_priority",
    re: new RegExp(`^(?:please\\s+)?(?:change|set|update)\\s+ticket\\s+#?(\\S+)\\s+priority\\s+to\\s+${NAME}${END}`, "i"),
    args: (m) => ({ ticket: clean(m[1]), priority: clean(m[2]) }),
  },
  {
    action: "close_ticket",
    re: new RegExp(`^(?:please\\s+)?close\\s+ticket\\s+#?(\\S+?)(?:\\s+(?:with\\s+reason|reason|because|since|saying)\\s*[:\\-]?\\s*(.+?))?${END}`, "i"),
    args: (m) => ({ ticket: clean(m[1]), reason: clean(m[2]) }),
  },
  {
    action: "assign_ticket",
    re: new RegExp(`^(?:please\\s+)?(?:assign|reassign)\\s+ticket\\s+#?(\\S+)\\s+to\\s+${NAME}${END}`, "i"),
    args: (m) => ({ ticket: clean(m[1]), assignee: clean(m[2]) }),
  },
  {
    action: "transfer_ticket",
    re: new RegExp(`^(?:please\\s+)?transfer\\s+(?:the\\s+)?ticket\\s+#?(?:number\\s+)?(\\S+?)\\s+(?:to|into)\\s+(?:the\\s+)?(.+?)(?:\\s+(?:department|dept|team))?(?:\\s+(?:because|since|reason|as|with reason)\\s*[:\\-]?\\s*(.+?))?${END}`, "i"),
    args: (m) => ({ ticket: clean(m[1]), department: clean(m[2]), reason: clean(m[3]) }),
    guard: (a) => shortName(a.department),
  },
  {
    action: "reopen_ticket",
    re: new RegExp(`^(?:please\\s+)?re-?open\\s+ticket\\s+#?(\\S+?)(?:\\s+(?:with\\s+reason|reason|because|since|as)\\s*[:\\-]?\\s*(.+?))?${END}`, "i"),
    args: (m) => ({ ticket: clean(m[1]), reason: clean(m[2]) }),
  },
  {
    action: "change_ticket_status",
    re: new RegExp(`^(?:please\\s+)?(?:set|change|mark|move|update|put)\\s+ticket\\s+#?(\\S+)\\s+(?:status\\s+)?(?:to|as|into)\\s+(in progress|on hold|resolved|open)(?:\\s*[:\\-]\\s*|\\s+(?:because|reason|note|notes|with reason|with notes|since)\\s*[:\\-]?\\s*)(.+?)${END}`, "i"),
    args: (m) => ({ ticket: clean(m[1]), status: clean(m[2]), reason: clean(m[3]) }),
  },
  {
    action: "change_ticket_status",
    re: new RegExp(`^(?:please\\s+)?(?:set|change|mark|move|update|put)\\s+ticket\\s+#?(\\S+)\\s+(?:status\\s+)?(?:to|as|into)\\s+(in progress|on hold|resolved|open)${END}`, "i"),
    args: (m) => ({ ticket: clean(m[1]), status: clean(m[2]) }),
  },
  // Comment, in the phrasings people use:
  //   add a comment on ticket 2600007: text      add a comment "text" in the ticket 2600007
  //   add a comment on ticket 2600007            (asks what it should say)
  {
    action: "change_ticket_status",
    re: new RegExp(`^(?:please\\s+)?(resolve|solve)\\s+(?:the\\s+)?ticket\\s+#?(?:number\\s+)?(\\S+?)${END}`, "i"),
    args: (m) => ({ ticket: clean(m[2]), status: "resolved" }),
  },
  {
    action: "add_ticket_comment",
    re: new RegExp(`^(?:please\\s+)?(?:add|post|write|leave|put)\\s+(?:a\\s+|the\\s+)?(?:new\\s+)?comment\\s+(?:on|to|in|for)\\s+(?:the\\s+)?ticket\\s+#?([^\\s:"“]+)(?:\\s*(?:[:\\-]|(?:saying|that\\s+says|says))\\s*|\\s+(?=["“]))(.+)$`, "i"),
    args: (m) => ({ ticket: clean(m[1]), comment: unquote(m[2]) }),
  },
  {
    action: "add_ticket_comment",
    re: new RegExp(`^(?:please\\s+)?(?:add|post|write|leave|put)\\s+(?:a\\s+|the\\s+)?(?:new\\s+)?comment\\s+(.+?)\\s+(?:on|to|in|for)\\s+(?:the\\s+)?ticket\\s+#?(\\S+?)${END}`, "i"),
    guard: (a) => !/^(?:on|to|in|for)\s+ticket\b/i.test(a.comment),
    args: (m) => ({ ticket: clean(m[2]), comment: unquote(m[1]) }),
  },
  {
    action: "add_ticket_comment",
    re: new RegExp(`^(?:please\\s+)?(?:add|post|write|leave|put)\\s+(?:a\\s+|the\\s+)?(?:new\\s+)?comment\\s+(?:on|to|in|for)\\s+(?:the\\s+)?ticket\\s+#?(\\S+?)${END}`, "i"),
    args: (m) => ({ ticket: clean(m[1]) }),
  },
  {
    action: "add_ticket_comment",
    re: new RegExp(`^(?:please\\s+)?comment\\s+(.+?)\\s+(?:on|to|in)\\s+(?:the\\s+)?ticket\\s+#?(\\S+?)${END}`, "i"),
    args: (m) => ({ ticket: clean(m[2]), comment: unquote(m[1]) }),
  },
  // Free-form ticket: "raise a ticket for <subject> to <dept> team", "raise a new ticket to <dept> department
  // that <description>". Needs an explicit department/team marker; otherwise the simpler rule below applies.
  {
    action: "create_ticket",
    re: new RegExp(`^(?:please\\s+)?(?:raise|create|open|log|submit)\\s+(?:a\\s+)?(?:new\\s+)?ticket\\s+(.+?)${END}`, "i"),
    args: (m) => parseTicketRest(m[1]) || {},
    guard: (a) => Boolean(a.department) && shortName(a.department),
  },
  {
    action: "create_ticket",
    re: new RegExp(`^(?:please\\s+)?(?:raise|create|open|log|submit)\\s+(?:a\\s+)?(?:new\\s+)?ticket(?:\\s+(?:for|to)\\s+(?:the\\s+)?([^:\\-]+?)(?:\\s+department)?)?(?:\\s*[:\\-]\\s*(.+?))?${END}`, "i"),
    args: (m) => ({ department: clean(m[1]), title: clean(m[2]) }),
    guard: (a) => !a.department || shortName(a.department),
  },
];

// Tried BEFORE the redirects: an explicit "add employee <name> <email> to <department>".
const ADD_EMPLOYEE = new RegExp(`^(?:please\\s+)?(?:add|create|onboard|register)\\s+(?:a\\s+)?(?:new\\s+)?(?:employee|user)\\s+${NAME}\\s+(?:with\\s+(?:the\\s+)?email\\s+)?\\(?([^\\s@()]+@[^\\s@()]+)\\)?\\s+(?:to|in|into)\\s+(?:the\\s+)?${NAME}(?:\\s+department)?${END}`, "i");

// Requests the application deliberately does not allow through chat (or at all
// for an Admin). They get an explanation + the right page, never an action.
const REDIRECTS = [
  { key: "create_user", re: /^(?:please\s+)?(?:create|add)\s+(?:a\s+)?(?:new\s+)?user\b/i },
  { key: "reset_password", re: /^(?:please\s+)?(?:reset|change|set)\s+(?:the\s+)?password\b/i },
  { key: "delete_department", re: /^(?:please\s+)?(?:delete|remove)\s+(?:the\s+)?department\b/i },
  { key: "delete_user", re: /^(?:please\s+)?(?:delete|remove)\s+(?:the\s+)?(?:user|account)\b/i },
  { key: "escalate_ticket", re: /^(?:please\s+)?escalate\b/i },
];

function parseAction(message) {
  const text = normalizeStatusPhrases(String(message).trim());
  const emp = text.match(ADD_EMPLOYEE);
  if (emp && shortName(emp[1]) && shortName(emp[3])) {
    return { action: "add_employee", args: { name: clean(emp[1]), email: clean(emp[2]), department: clean(emp[3]) }, required: ACTION_REQUIRED.add_employee };
  }
  for (const r of REDIRECTS) if (r.re.test(text)) return { redirect: r.key };

  // "add a comment" with nothing else: ask which ticket and what to say.
  if (/^(?:please\s+)?(?:add|post|write|leave|put)\s+(?:a\s+|the\s+)?(?:new\s+)?comment(?:\s+(?:on|to|in|for)\s+(?:the\s+|this\s+|that\s+)?ticket)?\s*[.!?]*$/i.test(text)) {
    return { action: "add_ticket_comment", args: {}, required: ACTION_REQUIRED.add_ticket_comment, missing: ["ticket", "comment"] };
  }

  const mentionsTicket = /\bticket\b/i.test(text);
  for (const rule of RULES) {
    // A message about a ticket can only be a ticket action (keeps "transfer ticket 1 to X department" etc. away from user rules).
    if (mentionsTicket !== /ticket/.test(rule.action)) continue;
    const m = text.match(rule.re);
    if (m) {
      const args = rule.args(m);
      if (rule.guard && !rule.guard(args)) continue;
      const required = [...(ACTION_REQUIRED[rule.action] || []), ...(needsReason(rule.action, args) ? ["reason"] : [])];
      // Details not given in the message: the assistant asks for them instead of guessing.
      const missing = required.filter((f) => !args[f]);
      return { action: rule.action, args, required, ...(missing.length ? { missing } : {}) };
    }
  }
  return null;
}

// Required details per action. (A close reason is deliberately NOT here: the
// action itself explains how to supply it.)
const ACTION_REQUIRED = {
  create_department: ["name"],
  rename_department: ["department", "newName"],
  rename_user: ["user", "newName"],
  grant_department_role: ["user", "department"],
  revoke_department_role: ["user", "department"],
  deactivate_user: ["user"],
  activate_user: ["user"],
  change_user_role: ["user", "roleName"],
  move_user_department: ["user", "department"],
  change_ticket_priority: ["ticket", "priority"],
  close_ticket: ["ticket"],
  add_employee: ["name", "email", "department"],
  assign_ticket: ["ticket", "assignee"],
  reopen_ticket: ["ticket"],
  transfer_ticket: ["ticket", "department", "reason"],
  change_ticket_status: ["ticket", "status"],
  add_ticket_comment: ["ticket", "comment"],
  create_ticket: ["title", "description", "department"],
};

module.exports = { parseAction };
