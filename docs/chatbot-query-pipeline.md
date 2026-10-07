# Chatbot query pipeline (rules, no AI required)

How a data question ("show open tickets in BI/Copilot", "who is the manager in Hardware", "only resolved") becomes an exact
answer. AI interpretation stays optional and only runs when no reliable rule matched.

## Audit of the chatbot before this change

| Area | What existed | Weakness found |
|---|---|---|
| Flow | `chatbot.service` -> `decide()` (state, rules, optional AI) -> handler -> tool | Rules were one regex per phrasing in `router.js`, so a new wording meant a new rule |
| Intents | ~60, `router.js` + `intentRegistry.js` | "what tickets have I raised", "tickets assigned to me", "show resolved tickets" were unsupported or answered with a guidance article |
| Entities | Department/priority/status/date for ticket lists (added earlier) | No people: "Manoj's tickets", "raised by Manoj" unsupported; `BI/Copilot` broke the department matcher (the `/`) |
| People questions | `people_directory`, `manager_assignments` | Role words ignored: "the Manager in X" listed the whole department |
| Counts | `ticket_statistics` | "how many open tickets in Hardware" returned overall statistics, not that number |
| Context | selection / clarification / last ticket | No memory of the previous list, so "only open ones" was not understood |
| Authorization | Role scope in `roleScope`, tools re-check scope, deny-by-default permissions | Sound; reused unchanged |

## After: one structured layer

```
message
  -> normalize (aliases, typos)
  -> ACTIONS first (create/assign/comment...: preview + confirm, unchanged)
  -> queryFrame.parseFrame  ->  { intent, filters }          intents/queryFrame.js
  -> (no frame) legacy rules, guidance, optional AI
  -> handler: resolve filters against real data, scoped to the signed-in user
       departments  -> real department list the user may see (typo tolerant)   entities/extract.js
       people       -> real users in the user's own departments (ambiguity => ask)
       status/priority/dates -> real enum values / configured priorities
  -> ticket / people tool (the tool restricts rows to the caller's scope)
  -> exact response (count | list | person | detail)
  -> resolved filters saved as conversation state for follow-ups
```

### Intent catalog (data questions)

| Intent | Filters |
|---|---|
| `list_tickets` | `mine` (requester / assignee), `personText` + `personRelation` (assignee / requester / either), `department` or `subject` (department-or-person), `status`, `priority`, dates, `filter` (open/pending), `text`, `mode` (list / count) |
| `people_directory` | department (from the question), `roleFilters` (MANAGER / TEAMLEAD / EMPLOYEE, one or several), `mode` (list / count) |
| `person_lookup` | `personText`: asks what the user wants to know and offers tickets assigned / raised |
| `find_ticket` | ticket number, optional `focus` (raisedBy, assignedTo) |

The earlier spec names map as: MY_TICKETS / ASSIGNED_TICKETS = `list_tickets` with `mine`; TICKETS_BY_STATUS / PRIORITY /
DEPARTMENT / EMPLOYEE = filters of `list_tickets`; TICKET_COUNT = `mode: count`; DEPARTMENT_PEOPLE / MANAGER_DETAILS /
TEAM_LEAD_DETAILS = `people_directory` + `roleFilters`; TICKET_DETAILS = `find_ticket`; RAISE / ASSIGN / REASSIGN are actions.
No separate intent per sentence.

### "me", "my", "I"

Never read as a name. `mine: requester` -> `requester: "me"` and `mine: assignee` -> `assignee: "me"` in the tool, and the
tool uses `ctx.scope.userId` (the authenticated user). "Tickets I raised" and "tickets assigned to me" are different queries.

### Entity resolution

- Departments: matched against the departments this user may see; the filter uses the real department name. A name outside
  their scope behaves like an unknown name.
- People: looked up only among the caller's own departments (everyone for an Admin). Several matches (Manoj Kumar R / S)
  are never guessed: the user picks by number and the chosen id is held server-side. Employees cannot look people up.
- "assigned to Finance" / "tickets for Hardware": the handler tries real departments first, then people.
- Status, priority and dates are read against the real values (`OPEN`, `IN_PROGRESS`, `ON_HOLD`, `RESOLVED`, `CLOSED`,
  `REOPENED`; the configured priorities; relative dates). Nothing is invented or silently remapped.
  "Open" keeps the application's meaning (Open, In Progress, On Hold, Reopened) and the answer says so.

### Conversation context

After a ticket or people answer, the resolved filters are stored on the assistant message (server side, 10 minutes, never
sent to the browser). A short message that starts with only / just / and / what about, or says "ones", "them", "show them",
changes only what it mentions and keeps the rest:

```
show Manoj's tickets   -> which Manoj?   1   -> 3 tickets   only open ones -> 2 open tickets
show BI/Copilot tickets -> 4 tickets      only resolved -> 1 ticket
who are the people in BI/Copilot -> 4 people      only managers -> the manager
```

A follow-up cannot widen access: the same scoped tools run again, and an Employee is still refused other people.

### Exact answers

| Question | Answer |
|---|---|
| who is the manager in BI/Copilot | `BI/Copilot` + `• Jayakumar J — Manager` (only managers) |
| how many open tickets are in Hardware | `Hardware has 1 open ticket.` (no cards) |
| how many people are in Hardware | `Hardware has 3 people.` |
| show open tickets in BI/Copilot | `Open tickets in BI/Copilot: found 2 tickets.` + cards |
| nothing found | `I couldn't find any closed tickets for Hardware.` + buttons to widen |
| ambiguous name | `More than one user matches "Manoj"...` numbered choices |
| not understood | what was recognized + "Did you mean" buttons built from real questions for that role |

## Security

No new authorization system. The pipeline only produces filters. Scope is enforced by the same permission matrix, role
scope and ticket/people tools as before. `requester/assignee: "me"` use the authenticated user. Person ids come from a
server-side lookup, never from the message. The model, when enabled, still never decides authorization.

## Tests

- `__tests__/accuracy.test.js`: 57 end-to-end cases across all four roles (data seeded with BI/Copilot, Hardware, Cloud and
  two people named Manoj), including follow-ups, ambiguity and scope. It writes `docs/chatbot-accuracy-report.md`
  (totals, accuracy, per-case results, every actual answer, and details for any failure).
- `__tests__/corpus/phrasings.json` + `corpus.test.js`: real phrasings and their expected intent/filters.
- `npm run chat:misses`: questions that were not understood / had no results / were rated badly, for the corpus.

## Defects found and fixed while building this

| Input | Was | Root cause | Fix |
|---|---|---|---|
| show me the Manager in BI/Copilot | whole department | role word never read | `roleFilters` end to end |
| what tickets have I raised / tickets assigned to me | unsupported / guidance | no requester/assignee concept | `mine` filters using the authenticated user |
| show resolved / closed tickets | ticket-status guidance | status words not read for lists | status read against real enum values |
| show open tickets in BI/Copilot | department lost | `/` not allowed in department words | department matcher accepts `/` and digits |
| how many open tickets are in Hardware | overall statistics | count mode missing | `mode: count` answers one number |
| Manoj's tickets | unsupported | no person filter | person resolution with ambiguity choice |
| only open ones | unsupported | no memory of the previous list | resolved-filter conversation state |
| tickets assigned to Zebedee Quux | name echoed in lower case | matched on the lower-cased copy | original capitalization kept |
| show Manoj (person that does not exist) / gibberish | "no such user" | bare names treated as people | not understood -> "Did you mean" |
| Display critical tickets assigned to Finance | person "Finance" | name vs department ambiguity | handler tries real departments first |

## Remaining limitations

- Wording is still rule-based: very unusual phrasing is not understood (it gets "Did you mean" buttons, never a guess).
- "Open" follows the application's meaning (Open, In Progress, On Hold, Reopened), not the single status `OPEN`; ask for
  "status Open" semantics only if you want that changed.
- "show tickets" with no filter lists the user's whole authorized view (recent first) instead of asking.
- Person questions cover tickets and a short description (role and department); no workload report.
- If a department is outside a Manager or Team Lead's scope, people questions answer with the departments they can list
  rather than saying the department exists.

## Dashboard, notifications and ticket detail questions

Added on the same pipeline (all reuse existing services; the user is always the authenticated one):

| Area | Intent | Source |
|---|---|---|
| "my dashboard summary", "how many tickets did I raise / are assigned to me / resolved do I have", last 7/30/90 days | `dashboard_summary` | `dashboard.service.getStats` (the Dashboard page's own numbers, "Raised by me" = scope `created`, "Assigned to me" = `assigned`) via `get_my_dashboard` |
| "show my notifications", "unread", "how many unread", "today", "for ticket N" | `notifications` | `notification.service.listForUser` / `countUnread` via `get_my_notifications` |
| mark all read / mark latest read / clear all | actions `mark_all_notifications_read`, `mark_notification_read`, `clear_notifications` | `notification.service.markAllRead / markRead / clearAll`; preview and Confirm first; only the caller's own rows |
| comments / attachments / who manages a ticket / status of a ticket | `ticket_comments`, `ticket_attachments`, `ticket_people`, `find_ticket` focus `status` | existing authorized ticket loader; internal notes and file paths are never returned |
| transfer a ticket | action `transfer_ticket` | `ticket.service.transferDepartment` (its own role rules apply; Admin cannot) |
| "the first one", "its comments" | follow-up | the last shown tickets are kept server-side as ticket numbers; the phrase is replaced by the number and goes through the same checks |

"How many tickets do I have?" is answered per dashboard tab (raised by you / assigned to you) rather than asking which, so
nothing is guessed. A list question such as "show my tickets" still shows both (raised or assigned).

The whole catalogue, with the phrasings tested for every allowed role, is in `chatbot-capability-map.md`
(generated from `server/src/chatbot/capabilityMap.js`).

### Where the application differs from the request

- Reopening: the ticket service lets the requester reopen their own RESOLVED/CLOSED ticket, and the assignee, Managers,
  Team Leads and Admins drive the workflow. The chatbot follows the service (it does not invent a stricter rule); a person
  with no link to the ticket is refused at preview.
- The notification bell is not a page, so there is no "Open Notifications" link; ticket notifications link to the ticket.
- Admins cannot raise, assign or transfer tickets in this application, so the assistant explains instead of offering it.

## Ticket access: the assistant is another client of the same rules

- **One source of truth for who may see what.** The assistant derives the signed-in user from the session and takes every
  scope from `ticket.service` itself (`scopeWhereForTab`, `resolveUserDepartmentIds`, `isManagementRole`, the same functions
  behind My Tickets, Department Tickets and the dashboard). Department access (`UserDepartmentAccess`) is therefore
  never re-implemented, and nothing in a message (role, department, user id) is read as authorization.
- **Proven, not claimed.** `__tests__/webparity.test.js` runs the assistant and the application's own list API
  (`ticket.service.listTickets`) side by side for all four roles and 16 filter combinations (status, priority, department,
  assignee, raised by me, assigned to me, dates, and combinations): the ticket sets must be identical (72 checks). It also
  checks, for every ticket and role, that "show ticket N" succeeds exactly when the application's own ticket page
  (`getTicketById`) would open it, and that a ticket the user cannot open gets the same neutral answer as one that does not
  exist, with none of its details.
- **Why the filters are composed in the chatbot tool rather than calling `listTickets`:** `listTickets` cannot express
  "raised OR assigned", the open group, or a named person, and returns fields the assistant must not echo (emails). The
  tool therefore ANDs its extra filters onto the service's scope function, so it can only narrow.
- **Pagination:** 5 per page with "Showing 1–5 of 47" and a Show more button (also "next" / "previous"); counts use the
  database count, never the page.
- **"Show tickets" with nothing else asks:** Employee: raised, assigned or both; Team Lead: department, assigned or raised;
  Manager: which accessible department or all. (Admin gets the list.)
- **Dates:** today, yesterday, this/last week, last N days, this/last month, this year, "from October 1 to October 7",
  "between 1 Oct and 5 Oct", "since September 20", ISO dates. A date like 4/10/2026 is ambiguous, so the assistant asks.
- **Admin:** the application lets an Admin view every ticket but not raise, assign or transfer one; the assistant mirrors
  exactly that (read: yes; raise/assign/transfer: explained, never previewed).
