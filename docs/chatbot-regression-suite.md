# Chatbot regression suite

Runs real chat messages as Employee, Team Lead, Manager and Admin through the real chatbot service on an
in-memory copy of the database (`src/chatbot/testkit/prismaMock.js`), and compares every answer with the
application's own services (`ticket.service.listTickets`, `dashboard.service.getStats`,
`notification.service`). No real database, mail server or AI model is used, and no production data is touched.
Ticket writes and emails are replaced by recording stand-ins so each confirmed change can be checked.

| Command (in `server`) | What it runs |
|---|---|
| `npm run test:chatbot` | the whole suite (about 500 scenarios) |
| `npm run test:chatbot:employee` / `:teamlead` / `:manager` / `:admin` | one role |
| `npm run test:chatbot:report` | prints the report written by the last run |
| `npm test` | the existing suite (unchanged; it does not include the regression files) |

Reports are written to `server/reports/` (git-ignored): `chatbot-regression-report.txt`, `.json` and
`chatbot-regression-results.csv`.

Code: `src/chatbot/regression/` — `data.js` (the test organisation), `harness.js` (sending, classifying and
checking answers), `scenarios.js` (the scenarios, as data), `report.js` (accuracy and reports),
`chatbot.regression.js` (the Jest entry). A scenario fails when the answer differs from the backend, leaks
data outside the user's access, or is the wrong kind of answer (denied / not found / no data / not
understood / asks a question / preview). The suite exits non-zero while a real chatbot defect exists; it does
not hide defects.
