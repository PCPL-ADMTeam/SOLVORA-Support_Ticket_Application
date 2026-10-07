# Chatbot — Tools, Permissions and Scope

Source of truth in code: `server/src/chatbot/permissions.js` (permissions, tool and action policy), `tools/` (read tools), `actions/registry.js` (write actions), `roleScope.js` (scope).

## Trust boundary

The backend alone decides: authenticated user id, role, department access, ownership, permissions, scope, confirmation state and execution. None of these is ever read from the chat message, the model's output, the request body, query parameters or browser storage. The request carries only `message`, `conversationId` and (for confirm/cancel) the server-issued `confirmationToken` + `conversationId`.

```
ALLOW = authenticated
        AND permission granted           (permissions.js: derived from the authenticated role)
        AND resource in authorized scope (ticket.service scope functions / department access)
        AND business validation passes   (the existing services' own rules)
        AND confirmation completed       (writes only)
```

Anything not explicitly allowed is denied: an unknown role, a tool or action missing from the policy, or a role missing from a policy row.

## Differences from the original request (and why)

| Requested | Implemented | Reason |
|---|---|---|
| Role `TEAM_LEAD` | `TEAMLEAD` | the application's existing role name |
| Granular permission identifiers stored/looked up | Derived from the role on the server (`permissions.js`) | the application has no permission table; the identifiers follow your naming |
| Admin `tickets.assign.all`, `tickets.create.all` | **Not granted** | `ticket.service` refuses both ("Administrators cannot raise tickets"; assignment is Manager/Team Lead only). The chatbot must not weaken that, so these requests are explained |
| `tenantId` | n/a | single-tenant application |
| `expectedVersion` (integer) | record fingerprint (`updatedAt` + key fields) taken at preview and re-checked before execution | there is no integer version column |
| Tool schemas with `departmentId`, `assigneeUserId`, `userId` supplied by the model | text references; the **backend** resolves them to ids inside the caller's scope | ids from a model are never trusted |
| `add_employee` with an invitation workflow | creates the account with a random, never-shown password and requests the existing password-setup (forgot-password) email | the app has no invitation feature; no plaintext password is ever requested, generated for display, or stored in chat |
| `deactivate_employee`: reassign dependencies | blocked (`CHAT_ACTION_BLOCKED_BY_DEPENDENCIES`) while open assigned tickets or Manager/Team Lead assignments exist, or for the last active Administrator | the dependency must be handled first (a Manager/Team Lead reassigns; remove the assignment) |
| `change_user_role` incl. `departmentIds` | role change only; department-role assignment is its own previewed action | existing services separate the two; the preview warns that grants are not changed automatically |
| ADMIN in `change_user_role` | not allowed (and an Admin's own role / any Admin's role cannot be changed) | no step-up authentication exists |
| `update_ticket` single tool | `change_ticket_priority`, `change_ticket_status`, `add_ticket_comment` | each maps to one existing service capability and one permission |

## Read tools (no confirmation)

| Tool | ADMIN | MANAGER | TEAMLEAD | EMPLOYEE | Scope forced by the backend |
|---|---|---|---|---|---|
| `search_authorized_tickets` | `tickets.read.all` | `tickets.read.allocatedDepartments` | same | `tickets.read.raisedBySelf` / `assignedToSelf` | ADMIN: any; MANAGER/TEAMLEAD: tickets of departments they have access to; EMPLOYEE: **raised by self OR assigned to self** (department alone grants nothing). Filters (status, priority, department, assigned-to, raised-by, dates, paging) only narrow this |
| `get_authorized_ticket`, `summarize_authorized_ticket`, `get_authorized_ticket_history` | same | same | same | same | the ticket is loaded **through** the scope; out of scope = missing = the neutral answer |
| `get_authorized_ticket_statistics` | same | same | same | same | own scope |
| `list_departments` | all | allocated only | allocated only | own only | |
| `get_department_members` | all | allocated only | allocated only | denied | names + role only; active people |
| `get_tickets_by_department`, `get_weekly_report` | yes | allocated | allocated | denied | |
| `get_department_headcount`, `get_manager_assignments`, `get_users_by_role`, `get_user_summary` | yes | denied | denied | denied | |

The neutral answer for an out-of-scope or missing ticket is always: *"You do not have permission to access this ticket, or the ticket could not be found."*

## Write actions (always preview, then Confirm)

| Action | Roles | Extra checks (preview, and again by the existing service at execution) |
|---|---|---|
| `create_ticket` | EMPLOYEE, MANAGER, TEAMLEAD | raised-by is the authenticated user; description <= 50 words; any department may receive; default priority when none given. ADMIN: explained, not allowed |
| `change_ticket_priority` | ADMIN, MANAGER, TEAMLEAD | ticket in scope. Employees may not |
| `change_ticket_status` (In Progress / On Hold / Resolved / Open) | ADMIN, MANAGER, TEAMLEAD, EMPLOYEE (assignee only) | valid transition (`VALID_TRANSITIONS`); notes required for On Hold / Resolved |
| `assign_ticket` | MANAGER, TEAMLEAD | ticket in scope and not closed; assignee found **only within the caller's departments**, active, an employee of the ticket's department (or, for a Team Lead, another Team Lead of it); not yourself. ADMIN: explained, not allowed |
| `close_ticket` | ADMIN, MANAGER, TEAMLEAD, EMPLOYEE (assignee only) | reason required; valid transition |
| `reopen_ticket` | ADMIN, MANAGER, TEAMLEAD, EMPLOYEE (requester or assignee) | reason required (added as a public comment); valid transition |
| `add_ticket_comment` | all roles | ticket in scope; public comment only, never an internal note |
| `create_department`, `rename_department` | ADMIN | unique names |
| `add_employee` | ADMIN | valid, unused email; department exists; no password handled in chat |
| `rename_user`, `activate_user`, `deactivate_user` | ADMIN | deactivation dependency checks, never yourself |
| `change_user_role` | ADMIN | never to/from Admin, never your own |
| `move_user_department` | ADMIN | |
| `grant_department_role`, `revoke_department_role` (Manager / Team Lead) | ADMIN | role must match; Team Lead: one department, max 2 per department |

Not offered at all: delete users/departments, password reset, escalate, granting Admin.

## Confirmation

Preview (action, target, current -> proposed state, impact) -> **Confirm** button. The pending action is stored on the server and is bound to the user, the conversation, the exact normalized parameters and a secret token (only its SHA-256 is stored); it expires after 10 minutes, is single-use (atomic claim), and before executing the server re-checks the caller's role/permission, ownership of the proposal, and that the records involved are unchanged. A typed "yes" never confirms.

## Errors

Safe codes (all returned as `{ code, message }`): `CHAT_AUTH_REQUIRED`, `CHAT_ACCESS_DENIED` (permission), `CHAT_TICKET_NOT_FOUND` (out of scope **or** missing, same text), `CHAT_INVALID_ROLE_OPERATION`, `CHAT_INVALID_TICKET_TRANSITION`, `CHAT_INVALID_ASSIGNEE`, `CHAT_ACTION_INVALID` (includes ambiguous names), `CHAT_ACTION_BLOCKED_BY_DEPENDENCIES`, `CHAT_RESOURCE_VERSION_CONFLICT`, `CHAT_ACTION_NOT_FOUND` (unknown/expired/other user's/replayed or wrong token), `CHAT_INVALID_INPUT`.

## Audit

`chat_audit_events` (actor, conversation, action, resource, result): tool and permission denials (`TOOL_PERMISSION_DENIED`, `ACTION_PERMISSION_DENIED`), scope denials (`TICKET_ACCESS_DENIED`), `ACTION_PROPOSED/EXECUTED/FAILED/CANCELLED/EXPIRED`, AI interpretation events. Executed writes also add `CHATBOT_ACTION_EXECUTED` (action, via, how it was understood) to `audit_logs`, next to the entries the existing services write themselves (with their own before/after values, as in the UI). Passwords, tokens, keys, headers, message text and ticket content are never audited.

## OpenRouter

The model may only propose a registered intent. The intent list sent to it is filtered by the authenticated role (a convenience, **not** a security boundary): the result is validated against the same role again, and every tool/action re-checks permission and scope on the server.
