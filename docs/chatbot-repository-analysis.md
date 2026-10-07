# Chatbot — Repository Analysis

Produced before any chatbot code was written. Everything below was read from the repository, not assumed.

## 1. Current technology stack

| Concern | Finding |
|---|---|
| Frontend | React 18 + Vite 7, React Router 7, Material UI 6, axios, notistack, recharts. **JavaScript (JSX), no TypeScript.** |
| Backend | Node (CommonJS) + Express 4, `express-async-errors`, `express-validator`, `helmet`, `cors`, `express-rate-limit`, `morgan`. **JavaScript, no TypeScript.** |
| Database / ORM | PostgreSQL via Prisma 5 (`server/prisma/schema.prisma`, SQL migrations under `server/prisma/migrations`). |
| Auth | JWT access token (15m, `Authorization: Bearer`, held in memory on the client) + refresh token in an httpOnly cookie (hash stored in `refresh_tokens`). |
| API style | REST, versioned: `/api/v1/*`. Responses `{ success, data | message, details }`. |
| Tests | Backend: Jest + supertest (`npm test`, one existing unit test). **Frontend: none** (only ESLint). |
| Lint / format | Client: `eslint src`. Server: none. No Prettier. No type checker (plain JS). |
| Env strategy | `server/src/config/env.js` reads `process.env` once; `server/.env.example`, `client/.env.example` (`VITE_API_BASE_URL`). |
| Logging / errors | `morgan` request log; `console.error` in `middleware/errorHandler.js`; services `throw new ApiError(status, message, details)`. System audit log: `utils/audit.js#recordAudit` → `audit_logs`. Ticket-scoped trail: `ticket_history`. |

## 2. Relevant folders and files

- `server/src/middleware/auth.js` — `authenticate`: verifies JWT, **re-loads the user from the DB** (role, department, teamMemberships) and rejects inactive users. `req.user` is therefore always server-derived.
- `server/src/middleware/rbac.js` — `requireRole(...)` route gate.
- `server/src/services/ticket.service.js` — authoritative ticket access rules (`scopeWhereForUser`, `scopeWhereForTab`, `assertCanView*`, `canViewInternalNotes`, `scrubInternalComments`, `resolveUserDepartmentIds`, `isManagementRole`).
- `server/src/services/userDepartmentAccess.service.js` — `UserDepartmentAccess` rows (manager / team-lead ↔ department).
- `server/src/services/dashboard.service.js` — aggregate stats built on the same scope functions.
- `server/src/routes/v1/*` + `controllers/*` + `validators/*` — route/controller/validator layering.
- `client/src/components/layout/AppShell.jsx` — **the single shell used by all four portals** (`AdminLayout`, `AgentLayout`, `PortalLayout`, and `RoleAwareLayout` all render `AppShell`).
- `client/src/components/layout/ProfileDialog.jsx` — profile view, Edit Profile, and Change Password.
- `client/src/api/axios.js` — authenticated axios instance with refresh-on-401.
- `client/src/components/common/{StatusBadge,PriorityBadge}.jsx` — reusable badges.

## 3. Authentication flow

1. `POST /auth/login` → access token (body) + refresh cookie.
2. Client stores the access token in memory (`api/axios.js`) and sends `Authorization: Bearer`.
3. `authenticate` verifies the JWT, then loads the user + role from Postgres on **every** request.
4. On 401 the client calls `POST /auth/refresh` once and retries; failure triggers the unauthorized handler (logout).

The chatbot reuses `authenticate` unchanged, so identity and role are never taken from the request body.

## 4. Authorization model

Four roles in the `roles` table: `ADMIN`, `MANAGER`, `TEAMLEAD`, `EMPLOYEE` (renamed from ADMIN/AGENT/USER).

| Role | Ticket visibility (existing rule) |
|---|---|
| ADMIN | every ticket (view); may not assign/reassign/transfer |
| MANAGER | tickets whose `toDepartmentId` is in their `UserDepartmentAccess` set (may be several) |
| TEAMLEAD | same shape as MANAGER; exactly one department (app-enforced), max 2 team leads per department |
| EMPLOYEE | tickets they raised **or** are assigned to (`requesterId` / `assigneeId`) |

Extra read-only rule: a MANAGER/TEAMLEAD may view (and list under the `authorized` scope) a ticket they personally raised even in a department they do not manage.

Internal notes (`TicketComment.isInternal`) are visible only to ADMIN, to MANAGER/TEAMLEAD of the ticket's department, and to the ticket's assignee.

## 5. Ticket and user data model (actual fields)

- **Ticket**: `ticketNumber` (unique string, e.g. `2627001`), `title`, `problemSummary`, `status` (`OPEN | IN_PROGRESS | ON_HOLD | RESOLVED | CLOSED | REOPENED`), `priorityId`, `categoryId?`, `requesterId`, `assigneeId?`, `fromDepartmentId?`, `toDepartmentId?`, `managerId?` (legacy), `resolvedAt?`, `closedAt?`, `resolutionNotes?`, `onHoldReason?`, `closedReason?`, `createdAt`, `updatedAt`.
- **Priority**: `name`, `level`, `color` (Low/Medium/High/Critical by seed).
- **TicketComment** (`isInternal`), **TicketAttachment**, **TicketHistory** (`action`, `fieldName`, `oldValue`, `newValue`), **TicketCC**, **Notification**, **AuditLog**.
- **User**: `name`, `email`, `roleId`, `departmentId?`, `isActive`, plus `UserDepartmentAccess` for management roles.
- **Team / TeamMember**: dormant (kept for history only). In this app, "team" for a Team Lead/Manager **means department access**, not the `Team` table.

## 6. Existing APIs reused or relevant

`GET /tickets` (scoped, filterable, searchable), `GET /tickets/:id`, `PATCH /tickets/:id`, `PATCH /tickets/:id/transfer-department`, `POST /tickets/:id/comments`, `GET /dashboard/stats`, `GET /notifications`, `POST /auth/change-password`, `PATCH /users/me/profile`, `GET /auth/me`, `GET /priorities`, `GET /users/me/department-access`.

## 7. Portal routes and UI labels (read from `App.jsx` and the layouts)

- **Employee** (`/portal`): Dashboard `/portal`, Raise a Ticket `/portal/new-ticket`, Tickets `/portal/my-tickets`.
- **Manager / Team Lead** (`/agent`, shared): Dashboard `/agent` (tabs *My Dashboard* / *Department Dashboard*), Raise a Ticket `/agent/new-ticket`, Tickets `/agent/queue` (tabs *My Tickets* / *Department Tickets*).
- **Admin** (`/admin`): Dashboard, All Tickets `/admin/tickets`, Users `/admin/users`, Departments `/admin/departments`, Priorities `/admin/priorities`, Email Templates `/admin/email-templates`, Settings `/admin/settings`, Audit Logs `/admin/audit-logs`.
- **Shared**: ticket detail `/tickets/:id`, edit `/tickets/:id/edit`.
- **Profile / password**: there is no profile route. The avatar menu in the header offers *Profile*, *Edit Profile*, *Logout*; the *Change Password* form lives inside the Profile dialog.
- Ticket detail buttons: *Edit Ticket*, *Update Status*, *Assign Ticket* / *Reassign*, *Transfer Department*, *Reopen Ticket*.

## 8. Reusable components and services

Server: `authenticate`, `validate`, `ApiError`, `recordAudit`, `ticket.service` scope helpers, `express-rate-limit`, `env.js`. Client: `AppShell`, `StatusBadge`, `PriorityBadge`, `api/axios`, `AuthContext`, MUI theme.

## 9. Integration risks and mismatches with the request

1. **SLA does not exist.** Migration `20260928120000_remove_sla_functionality_keep_priorities` removed it. There is no due date, SLA target, breach or "approaching SLA" data. "Overdue", "SLA exceptions", "approaching SLA" cannot be answered from data. **Decision:** the bot says plainly that these are not tracked, explains priority, and offers an "inactive for N days" view that is explicitly *not* an SLA.
2. **Escalation does not exist** as a feature or field. **Decision:** the bot explains related real mechanisms (priority change, department transfer, reassignment) and never reports "escalated" tickets.
3. **Categories** exist in the schema but there is no admin page, and tickets are created without a category in the current UI. The bot will not claim category management exists.
4. **Employee scope.** The request says employees see tickets they *created*; the app also lets an employee see tickets *assigned* to them. **Decision:** reuse the app's own rule (parity with the portal; the bot never shows more or less than the portal). Documented in the security doc.
5. **Team Lead "team".** Existing authorization is department-based; the `Team` table is dormant. The bot follows department access.
6. **Write operations.** The services have secure write methods, but the request mandates a read-only first release. The bot gives guidance and a navigation button for close/reopen/assign/comment/attachment; it never mutates tickets. **Update:** a later request added Admin-only changes (preview + explicit confirmation, through these same services); see `docs/chatbot-security.md`.
7. **No notification-settings page** exists (admin "Settings" is a configuration landing page; email templates are editable). The KB describes only what exists.
8. **Jest and `sanitize-html`.** `ticket.service.js` pulls in ESM-only `sanitize-html`, which Jest cannot `require` (noted in the existing test). The chatbot tests stub that one module via `moduleNameMapper` so the real scope functions are exercised.
9. **No frontend test framework.** Vitest + Testing Library (+ jsdom) are added as devDependencies.
10. **No type checker** (plain JS). The "type-check" gate is not applicable; JSDoc typedefs are used instead.
11. **Windows ARM64 note in README** — Prisma engine may not load locally; DB-backed manual verification may need Docker.

## 10. Missing data relationships

- No ticket ↔ SLA/due date, no escalation flag, no "employee-visible" flag on notes other than `isInternal` (non-internal == visible to requester).
- Attachment metadata exists (`fileName`, `mimeType`, `fileSize`); the bot only ever exposes counts/names, never file contents or storage paths.

## 11. Recommended implementation approach

- Backend module `server/src/chatbot/` mounted at `/api/v1/chatbot` behind the existing `authenticate`, with its own rate limiter.
- **Deterministic intent router (allow-list) → authorized tools → restricted DTOs → optional model phrasing.** The model never selects tools, never sees raw rows, and structured cards always come from DTOs, not model text.
- Ticket authorization reuses `ticket.service` scope functions (single source of truth) via a thin role-scope resolver.
- New Prisma tables `ChatConversation`, `ChatMessage`, `ChatFeedback`, `ChatAuditEvent` (no existing chat tables to reuse; `audit_logs` is kept for admin actions, chat audit events get their own table as specified).
- Model provider interface with `mock` (default for dev/test) and `anthropic` implementations; keys only from env.
- One `ChatWidget` mounted in `AppShell`, which covers all four portals; data from the backend (`/chatbot/suggestions`) so role-specific content is server-authorized.
