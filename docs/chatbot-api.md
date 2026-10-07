# Chatbot — API

Base path: `/api/v1/chatbot` (the project's versioned REST convention). Every endpoint requires `Authorization: Bearer <access token>`; identity and role come from the verified token + a fresh database read (`middleware/auth.js`). **No request accepts a role, user id or portal.**

Success responses: `{ "success": true, "data": … }`. Failures: `{ "success": false, "error": { "code", "message" } }`.

## POST `/messages`

Rate limited per authenticated user (default 20 / minute).

Request:

```json
{ "message": "Summarize ticket 2627001", "conversationId": "optional-existing-conversation-id" }
```

The message is interpreted by the rule engine first and, only if no reliable rule matches, by the AI interpreter (see `docs/chatbot-ai-interpretation.md`).

`message`: 1–1000 characters. `conversationId`: optional, must belong to the caller and be active.

Response `data`:

```json
{
  "conversationId": "…",
  "messageId": "…",
  "responseType": "data | guidance | preview | clarification | action | error | unsupported",
  "interpretation": { "method": "rule | openrouter | conversation_context | clarification", "confidence": 1, "model": "only when AI_EXPOSE_MODEL_METADATA" },
  "pendingAction": null,
  "message": "Ticket 2627001 is In Progress with High priority, assigned to Carol Worker. …",
  "intent": "summarize_ticket",
  "data": { "summary": { } },
  "suggestedActions": [{ "label": "Show ticket history", "prompt": "Show history of ticket 2627001" }],
  "navigationTarget": { "type": "route", "path": "/tickets/<id>", "label": "Open ticket" },
  "error": null
}
```

`navigationTarget` is `null`, `{ "type": "route", "path", "label" }`, or `{ "type": "dialog", "dialog": "profile" | "edit-profile", "label" }`.

**Conversational refusals return HTTP 200** with `error` set (they are answers, not failures): `CHAT_ACCESS_DENIED`, `CHAT_TICKET_NOT_FOUND`, `CHAT_INVALID_TICKET_ID`, `CHAT_NO_RESULTS`, `CHAT_UNSUPPORTED_INTENT`. `error` is `{ code, message, retryable: false }`.

`data` shapes by intent family:

| Intents | `data` |
|---|---|
| `list_tickets`, `search_tickets`, `find_ticket` | `{ tickets: [card], total }` |
| `summarize_ticket`, `latest_update`, `pending_actions` | `{ summary }` |
| `summarize_tickets` | `{ summaries: [summary], total }` |
| `ticket_history` | `{ history: { ticketNumber, entries: [{ at, description }] } }` |
| `ticket_statistics` | `{ statistics }` |
| guidance intents (`view_profile`, `change_password`, `create_ticket`, …) | `{ article: { id, title, feature, steps, warning } }` (+ `profile`, `priorities`, `statuses` where relevant) |

If a configured AI provider fails or returns an unusable answer, the server answers with its own draft and adds `data.degraded: true`.

### Ticket card

`ticketRouteId, ticketNumber, title, status, statusLabel, priority{name,color}, category, assignedTo, raisedBy, department, createdAt, lastUpdatedAt` — nothing else (no emails, ids of people, CC lists, attachments, internal notes).

### Ticket summary contract

```json
{
  "ticketId": "2627001", "ticketRouteId": "…", "subject": "…", "summary": "…",
  "category": null, "priority": "High", "status": "IN_PROGRESS", "statusLabel": "In Progress",
  "createdAt": "…", "lastUpdatedAt": "…", "assignedTo": "Carol Worker", "raisedBy": "…", "department": "…",
  "slaStatus": "Not tracked",
  "latestUpdate": "…", "latestUpdateAt": "…",
  "pendingActions": ["…"],
  "suggestions": ["…"],
  "resolutionSummary": null,
  "attachmentCount": 2,
  "unavailableFields": ["category", "resolutionSummary"]
}
```

* `pendingActions` are facts derived only from recorded fields (e.g. no assignee, on-hold reason, resolved-not-closed). `suggestions` are advice, are staff-only, and are kept separate.
* Absent data is `null` and listed in `unavailableFields`; it is never guessed.
* Internal notes are never included, for any role.
* A ticket that does not exist and a ticket the caller may not view produce the **identical** `CHAT_TICKET_NOT_FOUND` answer. The difference is recorded only in the audit trail.

## Changes (role-aware: preview, then Confirm)

Asking for a change ("Create new department Legal", "Deactivate user Ravi Kumar", "Close ticket 2627001 reason: duplicate") **prepares** it and returns a preview; nothing is changed. The response has `intent: "admin_action"` and

```json
"data": { "pendingAction": { "id": "…", "title": "Deactivate user", "summary": "Deactivate Ravi Kumar (Employee).", "impact": ["…"], "expiresAt": "…" } }
```

Names that are unknown or ambiguous, rule violations (e.g. a third Team Lead, deactivating yourself, granting Admin) and missing details (closing without a reason) are rejected at this stage with `error.code = "CHAT_ACTION_INVALID"` and an explanation; no pending action is created.

The preview's `pendingAction` also carries a one-time `confirmationToken`, shown only in this response and never stored (only its hash). Both `confirm` and `cancel` need it, together with the `conversationId`:

```json
{ "confirmationToken": "…", "conversationId": "…" }
```

A wrong token, a different conversation, another admin, or an expired/used proposal all answer `404 CHAT_ACTION_NOT_FOUND` (or the final status), and nothing executes.

### POST `/actions/:actionId/confirm`

Executes the prepared change **once**, through the application's existing service method, as the confirming admin. Response `data`: `{ actionId, status, message }` where `status` is `EXECUTED`, `FAILED` (the application rejected it or an error occurred; `message` says so and nothing is reported as done), `EXPIRED` (older than 10 minutes), `CANCELLED`, or `CONFIRMING`. Repeating the call never repeats the change. Errors: `401`, `400 CHAT_INVALID_INPUT` (malformed id), `403 CHAT_ACCESS_DENIED` (not an admin), `404 CHAT_ACTION_NOT_FOUND` (unknown, or belongs to another user).

### POST `/actions/:actionId/cancel`

Discards a pending change. Same errors as confirm.

Supported changes depend on the role (see `docs/chatbot-tool-registry.md`): Admin: create/rename department, add employee, rename/activate/deactivate user (with dependency checks), change role (never to or from Admin, never your own), move user to department, assign/remove a Manager or Team Lead, change priority/status, close/reopen, comment. Manager and Team Lead (own departments only): change priority and status, assign/reassign to eligible people, close, reopen, comment, raise a ticket. Employee: raise a ticket, comment, reopen (requester or assignee), and, on tickets assigned to them, change status and close.

Because changes are not only for admins any more, `confirm`/`cancel` accept any authenticated user for their own proposals; the role's permission for the action is re-checked on both calls.
Not offered, with an explanation and a link to the right page: create user (needs a password), reset password, delete department/user, reassign or escalate a ticket (Admins cannot assign; there is no escalation feature).

Report intents (read-only): *employee count by department*, *users by role*, *manager assignments* (Admin only); *tickets raised to each department*, *weekly ticket report* (Admin: whole system; Manager/Team Lead: their departments; Employee: denied).

## GET `/diagnostics/ai` (Admin only)

AI configuration status and a live capability check of the configured OpenRouter models against the model catalog: `{ enabled, provider, apiKeyConfigured, intentInterpretation, configurationProblems, intentModels, summaryModels, circuitBreaker, models }`. Never returns the key.

## Clarification and selection

When a detail is missing (`"Add an employee to Finance"`) the response is `responseType: "clarification"` with a question; when several people match, the message lists numbered choices and `suggestedActions` contains one chip per choice. The next message (a number, a chip label, or the missing detail) continues the request. Ids never leave the server.

## GET `/conversations/:conversationId`

Returns `{ conversationId, status, messages: [{ id, sender, text, intent, data, errorCode, createdAt }] }` (up to 200). **Owner only.** Another user — including an administrator — receives `404 CHAT_CONVERSATION_NOT_FOUND` and an audit event. (Administrator access to other people's chats was deliberately not enabled.)

## POST `/conversations/:conversationId/reset`

Archives the caller's conversation (`status: "ARCHIVED"`); the client then starts a fresh one by omitting `conversationId`.

## GET `/suggestions`

`{ portal, role, welcomeMessage, suggestions: [string] }` for the authenticated role. The widget renders this; it never picks a role itself.

## POST `/messages/:messageId/feedback`

```json
{ "rating": "helpful | not_helpful | incorrect | unauthorized_information | other", "reason": "optional, max 500 chars" }
```

Only for assistant messages in the caller's own conversations. One rating per user per message (re-submitting updates it). `unauthorized_information` also raises a dedicated audit action so it can be reviewed.

## Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `CHAT_INVALID_INPUT` | missing/too long/malformed message, id or rating |
| 400/200 | `CHAT_INVALID_TICKET_ID` | not a valid ticket number |
| 401 | `CHAT_AUTH_REQUIRED` | missing/expired authentication |
| 200 | `CHAT_ACCESS_DENIED` | role may not use that view or feature |
| 404/200 | `CHAT_TICKET_NOT_FOUND` | no ticket with that number *that you can access* |
| 404 | `CHAT_CONVERSATION_NOT_FOUND`, `CHAT_MESSAGE_NOT_FOUND`, `CHAT_ACTION_NOT_FOUND` | not found or not yours |
| 200 | `CHAT_ACTION_INVALID` | a requested change could not be prepared (reason in `message`; includes ambiguous names) |
| 200 | `CHAT_INVALID_ROLE_OPERATION`, `CHAT_INVALID_TICKET_TRANSITION`, `CHAT_INVALID_ASSIGNEE`, `CHAT_ACTION_BLOCKED_BY_DEPENDENCIES` | the change is not allowed for that role / status / person / because of dependencies |
| 200 (confirm: `FAILED`) | `CHAT_RESOURCE_VERSION_CONFLICT` | something changed after the preview; nothing was done |
| 200 | `CHAT_NO_RESULTS`, `CHAT_UNSUPPORTED_INTENT` | nothing matched / not something the assistant does |
| 429 | `CHAT_RATE_LIMITED` | per-user limit exceeded |
| 500 | `CHAT_DATABASE_ERROR` | unexpected server/database failure (generic text only) |
| 502/503/504 | `CHAT_PROVIDER_INVALID_RESPONSE` / `_UNAVAILABLE` / `_TIMEOUT` | defined and audited; in the current handlers a provider failure degrades to the server-built draft instead of surfacing |

## Supported questions (examples)

Guidance: view/update profile, change password, create ticket, view tickets, attach a file, add a comment, ticket history, status/priority/SLA/escalation/notifications, close/reopen, assign, dashboards, admin pages (Admin only).
Ticket information: *Show my open / pending / recently updated tickets*, *Show team/department tickets*, *Show unassigned tickets*, *Show tickets with no recent activity*, *Find ticket 2627001*, *Summarize ticket …*, *Summarize my department tickets*, *Latest update on ticket …*, *What is pending on ticket …*, *Show history of ticket …*, *Show department/overall ticket summary*, *Show ticket trends*, *Find tickets about printer*. Follow-ups such as *Show the history of it* reuse the previous ticket and are re-authorized.
"Overdue", "approaching SLA" and "escalated" are answered with an explanation that the application does not track them.

## Chat history

All three are authenticated, per-user rate-limited and scoped to the caller's own conversations. A conversation
opened under a different role than the caller's current one is treated as not found (its stored answers may hold
data the new role must not see).

| Method and path | Purpose |
|---|---|
| `GET /chatbot/conversations` | The caller's last 30 conversations: `{ conversationId, title, status, lastMessageAt }`. Title is the first message sent. |
| `POST /chatbot/conversations/:id/resume` | Reopen an archived conversation so it can be continued (audited as `CONVERSATION_RESUMED`). |
| `DELETE /chatbot/conversations/:id` | Permanently delete the caller's conversation, its messages and feedback; any open proposal is cancelled first (audited as `CONVERSATION_DELETED`). |

`GET /chatbot/conversations/:id` returns the messages. Replayed change proposals never include their confirmation
token, so the widget shows them as "From an earlier chat" and they cannot be confirmed. Conversations are also
removed by the existing retention purge (`docs/chatbot-deployment.md`).

## Raising a ticket (drafts)

| Method and path | Purpose |
|---|---|
| `POST /chatbot/drafts/attachments` | multipart: `conversationId`, `files`. Adds files to the open ticket draft (5 files / 10 MB rules). Returns the next assistant message and the updated `data.ticketDraft`. |
| `DELETE /chatbot/drafts/attachments/:attachmentId?conversationId=` | Removes one file from the draft. |

Messages that belong to the flow carry `data.ticketDraft` (title, priority, fromDepartment, department, cc, summary,
words, attachments, limits). The review also carries `data.pendingAction` (title "Raise ticket"); confirming it calls
the existing ticket service. See `chatbot-raise-ticket.md`.
