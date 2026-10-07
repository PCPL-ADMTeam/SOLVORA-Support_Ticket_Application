# OpenRouter Hybrid Interpretation — Repository Analysis

Written before any hybrid-interpretation code. Complements `docs/chatbot-repository-analysis.md` (original portal analysis) and `docs/chatbot-architecture.md`.

## 1. Current architecture (relevant parts)

| Concern | Finding |
|---|---|
| Frontend | React 18 + Vite + MUI. One `ChatWidget` mounted in `AppShell` (shared by Admin, Manager/Team Lead, Employee layouts). |
| Backend | Express 4 (CommonJS), Prisma 5 / PostgreSQL, JWT auth (`middleware/auth.js` re-reads user + role from the DB on every request). |
| Tenant handling | **None.** The application is single-tenant: there is no tenant column on any model. "Tenant" in the request is therefore not applicable; scope is role + department access. This is documented rather than invented. |
| Roles | `ADMIN`, `MANAGER`, `TEAMLEAD`, `EMPLOYEE` (`roles` table). **There is no granular permission model.** "Permission" in the registry means "allowed role set + the application's existing row-level scope rules". |
| Scope rules | `ticket.service.js`: `scopeWhereForUser` / `scopeWhereForTab` / `resolveUserDepartmentIds` (department access via `UserDepartmentAccess`). Reused unchanged by `chatbot/roleScope.js`. |
| Audit | `AuditLog` (`utils/audit.js#recordAudit`) for administrative actions; `TicketHistory` for per-ticket events; chatbot's own `ChatAuditEvent`. |
| Transactions | Existing services use Prisma `$transaction` where they need it (e.g. `createDepartment`). The chatbot executes writes only by calling those services, so their transactional behavior is inherited. There is no separate transaction layer to add. |
| Validation | `express-validator` on routes; services throw `ApiError`. |
| HTTP client | `axios` (already a dependency; used by the existing Anthropic provider). Reused for OpenRouter. |
| Tests | Backend Jest (+ supertest), frontend Vitest + Testing Library. |

## 2. Current chatbot request flow (before this change)

1. `POST /api/v1/chatbot/messages` → `authenticate` → per-user rate limit → validators.
2. `chatbot.service.sendMessage`: clean message → `resolveRoleScope(req.user)` → conversation get/create.
3. `intents/router.js#classify`: ordered regex/keyword rules → `{intent, params}`; admin "do something" phrasings first via `intents/actionParser.js`.
4. `intents/handlers.js` runs controlled tools (`tools/`) → restricted DTOs; admin changes go through `actions/` (preview → separate Confirm call → existing service).
5. Optional rephrasing of a server-built draft by a `ChatModelProvider` (`mock` or `anthropic`), validated, with fallback to the draft.
6. Response persisted; audit events written.

**What the existing "AI" did:** nothing for understanding. `CHATBOT_PROVIDER=mock` returns the draft unchanged; no model interprets the user's words. Unrecognized phrasing ends in "unsupported" or the nearest keyword article.

## 3. Existing supported rules (summary)

Admin changes (parser): create/rename department, grant/revoke Manager/Team Lead of a department, deactivate/activate user, change role, move user to department, rename user, change ticket priority, close ticket; explanations for create user / reset password / delete / reassign / escalate.
Reads: ticket lists (mine/open/pending/recent/unassigned/no-recent-activity/department), ticket by number (summary, history, latest update, pending actions), statistics/trends, department names, department members (Admin), headcount, manager assignments, users by role, tickets by department, weekly report, SLA/overdue/escalation (honestly "not tracked"), guidance articles per role, greetings.

## 4. Authorization controls that already exist

Authentication on every endpoint; role from the DB per request; scope delegated to `ticket.service`; admin-only enforcement in router, action service and tools; per-user rate limit; preview + separate confirmation for writes (admin-bound, expiring, atomic once-only claim); audit events; model output validation; field allow-list DTOs.

## 5. Reusable services

`department.service` (create/update), `userDepartmentAccess.service` (manager/team lead access), `user.service` (update/deactivate), `ticket.service` (update/priority/close + scope), `chatbot/actions/*`, `chatbot/tools/*`, `chatbot/providers/*` (HTTP + validation patterns), `chatbot/roleScope`, `chatbot/chatbot.audit`.

## 6. Missing backend services / things the request names that do not exist

| Requested | Reality | Decision |
|---|---|---|
| SLA, overdue, escalated, SLA exceptions | SLA removed from the app (migration `remove_sla_functionality`); no due dates or escalation | Registered as intents that answer honestly "not tracked" (never invented). |
| Workflow services | None in the repository | Not registered. |
| Create user | Needs an initial password; chat does not handle passwords | Registered as an explanation + link to Users page. |
| Activate/deactivate **department** | No `isActive` on `Department` | Not registered (would require inventing a field). |
| Remove role | Role is a single required `roleId`; "removing" is changing role | Covered by role change. |
| Reassign / escalate ticket (Admin) | Admins may not assign; no escalation | Explanation only. |
| Tenant | Single-tenant | Documented; tenant fields omitted. |
| Resource versioning | `updatedAt` exists on `User`, `Department`, `Ticket` (not on access rows) | Used as the resource-version snapshot where available. |
| Conversation state for clarification / selection | No table | Stored in the assistant message's `structuredPayload` (already persisted per conversation). |

## 7. Security risks specific to adding an external model

1. **Data leaving the server** to OpenRouter and then to an upstream provider → minimize (intent model sees only the current message + role-filtered intent list; never ticket text or people).
2. **Model output as an attack surface** → strict schema, server registry, no IDs trusted, model cannot cause writes.
3. **Prompt injection** → the intent model never sees ticket/comment text; the summary model sees only authorized, minimized DTOs fenced as untrusted data.
4. **Cost/abuse** → per-user limits (existing + AI-specific), bounded retries/fallbacks/timeouts, circuit breaker.
5. **Silent capability drift** (model lacks structured output, expires) → explicit capability check; no automatic switch to arbitrary models.
6. **Key exposure** → env only; never logged; redacted.
7. **Confirmation forgery/replay** → additionally bind confirmation to a secret token hash and conversation, and re-verify resource versions.

## 8. Recommended implementation mapping

* Keep `intents/router.js` as the deterministic engine; add alias/typo normalization and a **confidence** (high/low) so only a *reliable* rule skips the model.
* New `chatbot/interpretation/`: `intentRegistry` (server-owned; each AI-enabled intent maps onto an **existing** handler intent or admin action — no duplicate tools), `intentSchemas` (builds the strict JSON Schema from the registry, filtered by the caller's role), `hybridInterpreter` (priority order, validation, entity resolution, clarification), `conversationContext`.
* `providers/`: `intentModelProvider` interface with `OpenRouterIntentProvider`, `MockIntentProvider`, `DisabledIntentProvider`; `modelCapabilityService` (catalog check, cached, never per message); an OpenRouter implementation of the existing `ChatModelProvider` for the **summary** model (reusing the existing output validation).
* Writes keep the existing preview → Confirm path; add confirmation-token hash, conversation binding and `updatedAt` snapshot re-check.
* Protected diagnostics: `GET /chatbot/diagnostics/ai` (Admin) and `npm run ai:check`.
* Frontend: confirmation sends token + conversation id; entity selection and clarification render as chips.
