jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// Chatbot regression suite (run with `npm run test:chatbot`).
// Every scenario sends real chat messages as one role through the real chatbot service on an
// in-memory copy of the database, and compares the answers with the application's own services.
// Only the code paths that SEND EMAIL or WRITE tickets are replaced by recording stand-ins
// (so each confirmed change can be checked without a real mail server or database).
const ticketService = require("../../services/ticket.service");
const userService = require("../../services/user.service");
const { seedRegression, db } = require("./data");
const { scenarios } = require("./scenarios");
require("./scenarios.shortforms"); // adds its scenarios to the same list
require("./scenarios.rolehome");
const { runScenario } = require("./harness");
const { generateRegressionReport, REPORT_DIR } = require("./report");

const ROLES = ["EMPLOYEE", "TEAMLEAD", "MANAGER", "ADMIN"];
const results = [];
let ctx;

beforeEach(() => {
  seedRegression();
  const apply = async (user, id, payload) => {
    const t = db.tickets.find((x) => x.id === id);
    if (!t) throw new Error("ticket not found");
    if (payload.assigneeId) {
      const u = db.users.find((x) => x.id === payload.assigneeId);
      t.assigneeId = u.id;
      t.assignee = { name: u.name };
    }
    if (payload.status) t.status = payload.status;
    if (payload.priorityId) {
      const p = db.priorities.find((x) => x.id === payload.priorityId);
      t.priorityId = p.id;
      t.priority = { name: p.name, level: p.level, color: p.color };
    }
    t.updatedAt = new Date();
    return t;
  };
  // The CC picker looks people up through the user service (a database query this stand-in cannot run).
  jest.spyOn(userService, "searchActiveEmployees").mockImplementation(async (q) => db.users.filter((u) => u.isActive && (u.name.toLowerCase().includes(String(q).toLowerCase()) || String(u.email).toLowerCase().includes(String(q).toLowerCase()))).map((u) => ({ id: u.id, name: u.name, email: u.email, department: u.department, departmentAccess: [] })));
  ctx = {
    spies: {
      updateTicket: jest.spyOn(ticketService, "updateTicket").mockImplementation(apply),
      addComment: jest.spyOn(ticketService, "addComment").mockResolvedValue({}),
      createTicket: jest.spyOn(ticketService, "createTicket").mockResolvedValue({ id: "id_2600999", ticketNumber: "2600999", status: "OPEN" }),
      transferDepartment: jest.spyOn(ticketService, "transferDepartment").mockResolvedValue({}),
    },
  };
});
afterEach(() => jest.restoreAllMocks());

for (const role of ROLES) {
  describe(role, () => {
    for (const sc of scenarios.filter((s) => s.role === role)) {
      test(`${sc.id} [${sc.category}] ${sc.name}`, async () => {
        const res = await runScenario(sc, ctx);
        results.push(res);
        if (res.status === "FAIL") throw new Error(`${res.failType}: ${res.reason}`);
      });
    }
  });
}

afterAll(() => {
  if (!results.length) return;
  const rep = generateRegressionReport(results);
  const s = rep.summary;
  // eslint-disable-next-line no-console
  console.log(`\nChatbot regression: ${s.overall.passed}/${s.overall.executed} passed (${s.overall.accuracy}%). Reports written to ${REPORT_DIR}`);
});
