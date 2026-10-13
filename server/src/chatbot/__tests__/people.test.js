jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// People questions: Employees, Team Leads, Managers, Admins and "everyone", as names, counts or both, for one
// department, every department the user may see, or a department-wise breakdown. Runs the real chatbot
// (routing, handler, tool, scope) against the in-memory data double. Counts must be unique people by id and
// must match the names listed; role filters come from the user's words, never from the model.

const service = require("../chatbot.service");
const { classify } = require("../intents/router");
const { users, seedDefault, prismaMock } = require("../testkit/fixtures");

const db = prismaMock.__db;
const ask = (user, message) => service.sendMessage(user, { message });
const BI = { id: "dept_bi", name: "BI/Copilot" };

// A Manager of BI/Copilot, shaped like the fixture users (role from the session, never from the message).
const mgrBI = { id: "u_jk", name: "jayakumarj", email: "u_jk@example.test", isActive: true, createdAt: new Date("2026-01-01"), departmentId: null, department: null, role: { name: "MANAGER", label: "Manager" } };

beforeEach(() => {
  seedDefault();
  db.departments.push({
    ...BI,
    users: [
      { id: "u_kamalesh", name: "Kamalesh M", isActive: true, role: { name: "EMPLOYEE" } },
      { id: "u_srihari", name: "srihari", isActive: true, role: { name: "EMPLOYEE" } },
      { id: "u_gone", name: "Gone Employee", isActive: false, role: { name: "EMPLOYEE" } },
      // A Team Lead whose legacy home department is BI/Copilot but who has no access to it: not a BI Team Lead.
      { id: "u_legacy", name: "Legacy Lead", isActive: true, role: { name: "TEAMLEAD" } },
      // A role the directory does not know: never counted, never breaks the answer.
      { id: "u_odd", name: "Odd Contractor", isActive: true, role: { name: "CONTRACTOR" } },
    ],
    userAccess: [
      { user: { id: "u_jk", name: "jayakumarj", isActive: true, role: { name: "MANAGER" } } },
      { user: { id: "u_pavithran", name: "Pavithran M", isActive: true, role: { name: "TEAMLEAD" } } },
      // The same access twice (a duplicated join row): still one person.
      { user: { id: "u_pavithran", name: "Pavithran M", isActive: true, role: { name: "TEAMLEAD" } } },
    ],
  });
  db.access.push({ userId: "u_jk", departmentId: BI.id });
  db.users.push({ ...mgrBI, roleId: "r_mgr" });
});

const names = (r) => r.data.people.departments.flatMap((d) => (d.members || []).map((m) => `${m.name}:${m.role}`));

describe("role filters", () => {
  test("Employees only: no Managers, Team Leads, inactive people or unknown roles", async () => {
    const r = await ask(users.admin, "Show employees in BI/Copilot");
    expect(r.intent).toBe("people_directory");
    expect(names(r)).toEqual(["Kamalesh M:Employee", "srihari:Employee"]);
    expect(r.data.people).toMatchObject({ title: "Employees in BI/Copilot", total: 2 });
    expect(r.message).not.toMatch(/jayakumarj|Pavithran|Legacy|Gone|Contractor/);
  });

  test("Team Leads only (once each, never the legacy home-department one)", async () => {
    const r = await ask(users.admin, "Show team lead in BI/Copilot");
    expect(names(r)).toEqual(["Pavithran M:Team Lead"]);
    expect(r.data.people.total).toBe(1);
  });

  test("Managers only", async () => {
    for (const q of ["Show manager in BI/Copilot", "Who is the manager of BI/Copilot?"]) {
      const r = await ask(users.admin, q);
      expect({ q, people: names(r) }).toEqual({ q, people: ["jayakumarj:Manager"] });
    }
  });

  test("everyone in the department, every role, with each person's role and department", async () => {
    for (const q of ["Show all people in BI/Copilot", "list everyone in BI/Copilot", "show the complete BI/Copilot team", "show me the people in BI/Copilot"]) {
      const r = await ask(users.admin, q);
      expect({ q, people: names(r) }).toEqual({ q, people: ["jayakumarj:Manager", "Pavithran M:Team Lead", "Kamalesh M:Employee", "srihari:Employee"] });
      expect(r.data.people.total).toBe(4);
      expect(r.data.people.departments[0].counts).toEqual({ MANAGER: 1, TEAMLEAD: 1, EMPLOYEE: 2 });
    }
    expect((await ask(users.admin, "Show all people in BI/Copilot")).message).toContain("1. jayakumarj — Manager — BI/Copilot");
  });

  test("a role without a department lists that role in every department the user may see (no 'which department?')", async () => {
    const r = await ask(users.admin, "show team lead");
    expect(r.message).not.toMatch(/Which department/);
    expect(r.data.people.title).toBe("Team Leads in all departments");
    expect(names(r).sort()).toEqual(["Pavithran M:Team Lead", "Tina Lead:Team Lead"]);
    expect(r.data.people.total).toBe(2);
    const managers = await ask(users.admin, "list all managers across departments");
    expect(names(managers).sort()).toEqual(["Mark Manager:Manager", "jayakumarj:Manager"].sort());
  });

  test("with neither a role nor a department it still asks which department", async () => {
    const r = await ask(users.admin, "show people");
    expect(r.message).toMatch(/^Which department do you mean\?/);
  });
});

describe("counts, names, or both", () => {
  test("count only: the exact count and no names", async () => {
    for (const q of ["How many employees are in BI/Copilot?", "Count the employees in BI/Copilot", "What is the total number of employees in BI/Copilot?"]) {
      const r = await ask(users.admin, q);
      expect({ q, mode: r.data.people.mode, total: r.data.people.total }).toEqual({ q, mode: "count", total: 2 });
      expect(r.message).toBe("Employees in BI/Copilot\nTotal employees: 2");
      expect(r.data.people.departments[0].members).toBeUndefined();
    }
  });

  test("count and names: the count above the names, and they always agree", async () => {
    for (const q of ["Give me the employee count and names in BI/Copilot", "How many employees work in BI/Copilot? Show their names.", "Count the employees in BI/Copilot and list them"]) {
      const r = await ask(users.admin, q);
      expect(r.data.people.mode).toBe("both");
      expect(r.message).toBe("Employees in BI/Copilot\nTotal employees: 2\n1. Kamalesh M — Employee — BI/Copilot\n2. srihari — Employee — BI/Copilot");
      expect(names(r)).toHaveLength(r.data.people.total);
    }
  });

  test("the same for Team Leads, Managers, Admins and everyone", async () => {
    expect((await ask(users.admin, "How many team leads are in BI/Copilot?")).message).toBe("Team Leads in BI/Copilot\nTotal team leads: 1");
    const mgr = await ask(users.admin, "Give me the number and names of managers in BI/Copilot");
    expect(mgr.message).toBe("Managers in BI/Copilot\nTotal managers: 1\n1. jayakumarj — Manager — BI/Copilot");
    expect((await ask(users.admin, "Count all admins")).message).toBe("Administrators\nTotal administrators: 2");
    const everyone = await ask(users.admin, "How many people are in BI/Copilot, including every role?");
    expect(everyone.message).toBe("People in BI/Copilot\nTotal people: 4 (1 manager, 1 team lead, 2 employees)");
  });

  test("Administrators: names for an Admin; refused for everyone else, with nothing revealed", async () => {
    const r = await ask(users.admin, "Show all admins");
    expect(r.data.people.admins.members.map((m) => m.name).sort()).toEqual(["Ada Admin", "Other Admin"]);
    expect(r.data.people.admins.total).toBe(2);
    for (const who of [mgrBI, users.tlD1, users.empA]) {
      const denied = await ask(who, "who are the admin users?");
      expect(denied.error.code).toBe("CHAT_ACCESS_DENIED");
      expect(JSON.stringify(denied)).not.toMatch(/Ada Admin|Other Admin/);
    }
  });
});

describe("department-wise summaries", () => {
  // What each department really has, from the same rule the application uses.
  const expected = () =>
    Object.fromEntries(
      db.departments.map((d) => [d.name, d.users.filter((u) => u.isActive && u.role.name === "EMPLOYEE").length])
    );

  test("employee counts for every department match the data", async () => {
    for (const q of ["Show employee counts for every department", "Show the employee count in every department"]) {
      const r = await ask(users.admin, q);
      const got = Object.fromEntries(r.data.people.departments.map((d) => [d.name, d.total]));
      expect({ q, got }).toEqual({ q, got: expected() });
      expect(r.data.people.total).toBe(Object.values(expected()).reduce((a, b) => a + b, 0));
      expect(r.message).toContain(`Total employees: ${r.data.people.total}`);
    }
  });

  test("counts with names for every department", async () => {
    const r = await ask(users.admin, "Tell me the total employees in each department along with their names");
    expect(r.data.people.mode).toBe("both");
    for (const d of r.data.people.departments) expect(d.members).toHaveLength(d.total);
    expect(r.message).toContain("BI/Copilot: 2 employees");
  });

  test("a role breakdown per department", async () => {
    const r = await ask(users.admin, "Give me a department-wise breakdown of employees, team leads and managers");
    expect(r.data.people.breakdown).toBe(true);
    const bi = r.data.people.departments.find((d) => d.name === "BI/Copilot");
    expect(bi).toMatchObject({ total: 4, counts: { MANAGER: 1, TEAMLEAD: 1, EMPLOYEE: 2 } });
    expect(r.message).toContain("• BI/Copilot: 4 (1 manager, 1 team lead, 2 employees)");
  });
});

describe("authorization", () => {
  test("a Manager sees only their own departments, whatever the question says", async () => {
    const own = await ask(mgrBI, "Show employee counts in every department");
    expect(own.data.people.departments.map((d) => d.name)).toEqual(["BI/Copilot"]);
    expect((await ask(mgrBI, "show team lead")).data.people.departments.map((d) => d.name)).toEqual(["BI/Copilot"]);
    const other = await ask(mgrBI, "Show employees in IT Support");
    expect(other.error.code).toBe("CHAT_ACCESS_DENIED");
    expect(JSON.stringify(other)).not.toMatch(/Alice|Bob|Tina/);
  });

  test("a Team Lead sees only their department", async () => {
    const r = await ask(users.tlD1, "how many employees do we have");
    expect(r.data.people.departments.map((d) => d.name)).toEqual(["IT Support"]);
    expect(JSON.stringify(r)).not.toMatch(/Kamalesh|srihari|Dan Finance/);
  });

  test("an Employee cannot list people by rephrasing", async () => {
    for (const q of ["Show employees in BI/Copilot", "how many employees are in IT Support?", "show team lead", "list everyone in IT Support"]) {
      const r = await ask(users.empA, q);
      expect({ q, code: r.error?.code }).toEqual({ q, code: "CHAT_ACCESS_DENIED" });
      expect(JSON.stringify(r)).not.toMatch(/Kamalesh|srihari|Bob Employee|Tina Lead/);
    }
  });
});

describe("edge cases", () => {
  test("wording: case, singular and plural", async () => {
    for (const q of ["SHOW TEAM LEADS IN bi/copilot", "show team lead in BI/Copilot", "List Team Leads in BI/Copilot"]) {
      expect({ q, people: names(await ask(users.admin, q)) }).toEqual({ q, people: ["Pavithran M:Team Lead"] });
    }
  });

  test("nobody of that role: a count of zero and no names", async () => {
    const r = await ask(users.admin, "How many managers are in IT Support?");
    expect(r.message).toBe("No Managers were found in the IT Support department. Total managers: 0.");
    expect(r.data.people.total).toBe(0);
  });

  test("an unknown department is said, never replaced by another one", async () => {
    const r = await ask(users.admin, "Show employees in Narnia");
    expect(r.message).toMatch(/^I couldn't find a department called "Narnia"\./);
    expect(r.data.people).toBeUndefined();
  });

  test("two different people with the same name are two people", async () => {
    db.departments.find((d) => d.id === BI.id).users.push({ id: "u_srihari2", name: "srihari", isActive: true, role: { name: "EMPLOYEE" } });
    const r = await ask(users.admin, "How many employees are in BI/Copilot?");
    expect(r.data.people.total).toBe(3);
  });

  test("a long list is shortened for display, but the total is the real total", async () => {
    const big = db.departments.find((d) => d.id === BI.id);
    for (let i = 0; i < 118; i += 1) big.users.push({ id: `u_bulk${i}`, name: `Bulk Person ${String(i).padStart(3, "0")}`, isActive: true, role: { name: "EMPLOYEE" } });
    const r = await ask(users.admin, "Give me the employee count and names in BI/Copilot");
    expect(r.data.people.total).toBe(120);
    expect(r.data.people.departments[0].members).toHaveLength(100);
    expect(r.message).toContain("Total employees: 120");
    expect(r.message).toContain("…and 20 more");
  });
});

describe("how the question is read", () => {
  test.each([
    ["show team lead", { roleFilters: ["TEAMLEAD"], mode: "list" }],
    ["show employees in HR", { roleFilters: ["EMPLOYEE"], mode: "list" }],
    ["show all people in BI/Copilot", { roleFilters: [], mode: "list" }],
    ["how many employees are in Cloud?", { roleFilters: ["EMPLOYEE"], mode: "count" }],
    ["give me the employee count and names in BI/Copilot", { roleFilters: ["EMPLOYEE"], mode: "both" }],
    ["count all admins", { roleFilters: ["ADMIN"], mode: "count" }],
    ["show employee counts for every department", { roleFilters: ["EMPLOYEE"], mode: "count", all: true }],
    ["give me a department-wise breakdown of employees, team leads and managers", { mode: "count", all: true, breakdown: true }],
  ])("%s", (q, expected) => {
    const r = classify(q, "ADMIN");
    expect(r.intent).toBe("people_directory");
    expect(r.params).toMatchObject(expected);
  });

  test("ticket and report questions are not taken for people questions", () => {
    expect(classify("show team lead tickets", "MANAGER").intent).not.toBe("people_directory");
    expect(classify("how many users by role", "ADMIN").intent).toBe("users_by_role");
    expect(classify("which department has the most open tickets", "ADMIN").intent).toBe("tickets_by_department");
  });
});
