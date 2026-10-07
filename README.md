# Helpdesk — IT Ticketing / Support System

A full-stack IT helpdesk / ticketing application (comparable in scope to Jira Service
Management or GLPI): ticket lifecycle management, role-based portals for
Admins/Agents/End Users, a live analytics dashboard, email notifications, and file
attachments.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 (Vite), React Router, Axios, Material UI, Recharts |
| Backend | Node.js, Express, JWT auth, bcrypt, express-validator |
| Database | PostgreSQL via Prisma ORM (migrations + seed script) |
| Other | Multer (attachments), Nodemailer (email), Docker Compose |

## Folder Structure

```
helpdesk-app/
├── docker-compose.yml
├── server/                 # Express API (see server/README notes below)
│   ├── prisma/schema.prisma, seed.js, migrations/
│   └── src/{config,middleware,routes,controllers,services,validators,utils,jobs}
└── client/                 # React (Vite) SPA
    └── src/{api,context,routes,theme,components,pages}
```

See inline comments in `server/prisma/schema.prisma` for the full data model
(users, roles, teams, tickets, comments, attachments, history, categories,
priorities, notifications, audit logs).

## Quick Start (Docker Compose — recommended)

This runs Postgres, the API, and the React dev server together, and
automatically applies migrations + seeds the database on first boot.

```bash
cp server/.env.example server/.env      # already provided with dev defaults
cp client/.env.example client/.env      # already provided with dev defaults
docker compose up --build
```

- API: http://localhost:5000/api/v1
- Client: http://localhost:5173
- Postgres: localhost:5432 (user/pass/db: `helpdesk` / `helpdesk_dev_password` / `helpdesk`)

## Manual Setup (without Docker)

**1. Database** — start a local PostgreSQL 16 instance (or `docker compose up -d postgres`).

**2. Backend**
```bash
cd server
npm install
cp .env.example .env        # edit DATABASE_URL / JWT secrets if needed
npx prisma migrate dev --name init
npm run seed                # creates roles, default admin, sample data
npm run dev                 # starts on http://localhost:5000
```

**3. Frontend**
```bash
cd client
npm install
cp .env.example .env
npm run dev                 # starts on http://localhost:5173
```

> **Note (Windows on ARM64):** Prisma's engine binaries don't ship a native
> Windows-ARM64 build; running the API directly with `npm run dev` on an
> ARM64 Windows host will fail to load the query engine. Use Docker Compose
> instead (the container runs Linux, which is unaffected), or run the API
> under an x64 Node.js install.

## Default Login Credentials (from `prisma/seed.js`)

| Role | Email | Password |
|---|---|---| 
| Admin | `admin@helpdesk.local` | `Admin@12345` |
| Agent (IT department manager) | `alex.agent@helpdesk.local` | `Agent@12345` |
| Agent | `sam.support@helpdesk.local` | `Agent@12345` |
| End User | `jamie.user@helpdesk.local` | `User@12345` |
| End User | `riley.requester@helpdesk.local` | `User@12345` |

There is no separate "Manager" role or manager-only accounts — a department
manager is just an existing Agent with `isManager: true`, selectable as a
ticket's Manager for their department (see the "Is a department manager"
toggle on the admin Users page). They log in with the same Agent
credentials as any other agent.

Change `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `server/.env` before
seeding a non-dev environment.

## Portals

- **Admin** (`/admin`) — dashboard, all tickets, users, teams, categories,
  priorities, audit logs, settings.
- **Agent** (`/agent`) — personal dashboard, assigned/team ticket queue.
- **End User** (`/portal`) — personal dashboard, raise a ticket, my tickets, profile.
- Ticket detail (`/tickets/:id`) is shared across all three portals; access
  is enforced server-side (see `server/src/services/ticket.service.js#assertCanView`).

## API Overview (`/api/v1`)

All endpoints require `Authorization: Bearer <accessToken>` except `/auth/login`
and `/auth/refresh` (refresh token travels as an httpOnly cookie). Full request/
response shapes are defined by the validators in `server/src/validators/` and the
route files in `server/src/routes/v1/`.

| Resource | Routes |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| Users | `GET/POST /users`, `GET/PATCH/DELETE /users/:id`, `PATCH /users/me/profile`, `GET /users/assignable-agents` (Admin, except self-service routes) |
| Teams | `GET /teams`, `GET/POST/PATCH/DELETE /teams(/:id)` (write = Admin) |
| Categories | `GET /categories`, `POST/PATCH/DELETE /categories(/:id)` (write = Admin) |
| Priorities | `GET /priorities`, `POST/PATCH /priorities(/:id)` (write = Admin) |
| Tickets | `GET/POST /tickets`, `GET/PATCH /tickets/:id`, `POST /tickets/:id/comments`, `POST /tickets/:id/attachments`, `POST /tickets/bulk` (Admin) |
| Dashboard | `GET /dashboard/stats?days=30&dateFrom=&dateTo=` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` |
| Audit Logs | `GET /audit-logs` (Admin) |
| Chatbot | `POST /chatbot/messages`, `GET /chatbot/conversations/:id`, `POST /chatbot/conversations/:id/reset`, `GET /chatbot/suggestions`, `POST /chatbot/messages/:messageId/feedback`, `POST /chatbot/actions/:id/confirm`, `POST /chatbot/actions/:id/cancel` (Admin) — see [docs/chatbot-api.md](docs/chatbot-api.md) |

Ticket list/dashboard query params: `status`, `priorityId`, `categoryId`,
`assigneeId`, `teamId`, `overdue=true`, `search`, `dateFrom`, `dateTo`,
`sortBy`, `sortOrder`, `page`, `limit`.

## Assistant (Chatbot)

A role-aware assistant is available in every portal (round chat button, bottom
right). It answers "how do I…" questions from a role-filtered knowledge base and
answers ticket questions only from data the signed-in user is already authorized
to see (it reuses `ticket.service.js`'s scope rules). Ticket text is treated as
untrusted data. **Every role** can ask it to make a limited set of changes allowed for that role
(for example an Employee raises or comments on their own tickets, a Team Lead or
Manager assigns and closes tickets in their departments, an Admin manages
departments and users); every change is shown as a preview and only made after
the user presses **Confirm**, through the application's existing services and
rules. See [tools and permissions](docs/chatbot-tool-registry.md).

- Setup: apply the new migrations (`cd server && npx prisma migrate deploy`), then
  optionally set the `CHATBOT_*` variables in `server/.env` (see `server/.env.example`).
  The default `CHATBOT_PROVIDER=mock` needs no key and sends nothing off the server.
- AI: an OpenRouter model can interpret free-form wording when no reliable rule matches (optional; off until configured); it only picks a registered intent and never reads data or executes anything. See [AI interpretation](docs/chatbot-ai-interpretation.md) and `npm run ai:check`.
- Docs: [analysis](docs/chatbot-repository-analysis.md) · [OpenRouter analysis](docs/openrouter-chatbot-analysis.md) · [AI interpretation](docs/chatbot-ai-interpretation.md) · [tools and permissions](docs/chatbot-tool-registry.md) ·
  [architecture](docs/chatbot-architecture.md) · [API](docs/chatbot-api.md) ·
  [security](docs/chatbot-security.md) · [knowledge base](docs/chatbot-knowledge-base.md) ·
  [testing](docs/chatbot-testing.md) · [deployment](docs/chatbot-deployment.md)

## Security Notes

- Passwords hashed with bcrypt (12 rounds); JWT access token (15m) + rotating
  httpOnly-cookie refresh token (7d, revoked on logout/password change).
- Every route re-checks role server-side (`middleware/rbac.js`) **and**
  row-level ownership in the service layer (`ticket.service.js#assertCanView`)
  — the frontend's route guards are UX only, never the source of truth.
  Internal ticket notes are stripped server-side before any End User response.
- Rich-text ticket descriptions/comments are sanitized both server-side
  (`sanitize-html`, before persisting) and client-side (`DOMPurify`, before
  rendering) as defense in depth against stored XSS.
- File uploads are restricted by MIME allow-list and a 10 MB size limit, and
  stored under randomly generated filenames (`config/multer.js`).
- Helmet security headers, CORS locked to `CLIENT_URL`, and rate limiting
  (global + a stricter limiter on `/auth/login`) are enabled by default.

## Running Tests / Linting

```bash
cd server && npm test         # jest + supertest (includes the chatbot suites)
cd client && npm test         # vitest + React Testing Library (chatbot widget)
cd client && npm run lint     # NOTE: the repo has no ESLint config file yet, so this errors
```
