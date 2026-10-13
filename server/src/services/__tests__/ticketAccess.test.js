// Unit tests for utils/ticketAccess.js — the pure ticket-scope and
// access-level rules (no Prisma, no DB). DB-backed behavior of the same
// rules is covered by ticketAccess.integration.test.js.
const {
  scopeWhereForTab,
  scopeWhereForUser,
  departmentScopeWhere,
  resolveTicketAccess,
  canViewTicket,
  canParticipate,
} = require("../../utils/ticketAccess");

const DEPT_A = "dept-a";
const DEPT_B = "dept-b";

const employee = (id, departmentId = DEPT_A) => ({ id, departmentId, role: { name: "EMPLOYEE" } });
const teamLead = (id) => ({ id, departmentId: null, role: { name: "TEAMLEAD" } });
const manager = (id) => ({ id, departmentId: null, role: { name: "MANAGER" } });
const admin = { id: "admin", departmentId: null, role: { name: "ADMIN" } };

const ticket = (overrides = {}) => ({ id: "t1", requesterId: "req", assigneeId: "asg", toDepartmentId: DEPT_A, ...overrides });

describe("scopeWhereForTab — Employee Ticket Log tabs", () => {
  const me = employee("me");

  test("Raised By Me (created) = requesterId only", () => {
    expect(scopeWhereForTab(me, "created")).toEqual({ requesterId: "me" });
  });

  test("Assigned To Me (assigned) = assigneeId only", () => {
    expect(scopeWhereForTab(me, "assigned")).toEqual({ assigneeId: "me" });
  });

  test("Department Tickets = the employee's own server-side department", () => {
    expect(scopeWhereForTab(me, "department")).toEqual({ toDepartmentId: DEPT_A });
  });

  test("Department Tickets for an employee without a department matches nothing", () => {
    expect(scopeWhereForTab(employee("x", null), "department")).toEqual({ id: "" });
  });

  test("default (no scope) is unchanged: raised OR assigned, one query", () => {
    expect(scopeWhereForTab(me, undefined)).toEqual({ OR: [{ requesterId: "me" }, { assigneeId: "me" }] });
  });

  test("department scope for MANAGER/TEAMLEAD is their normal UserDepartmentAccess scope", () => {
    expect(scopeWhereForTab(teamLead("tl"), "department", [DEPT_A])).toEqual(scopeWhereForUser(teamLead("tl"), [DEPT_A]));
    expect(departmentScopeWhere(manager("m"), [])).toEqual({ id: "" });
  });

  test("ADMIN department/default scope is unrestricted (unchanged)", () => {
    expect(scopeWhereForTab(admin, "department")).toEqual({});
    expect(scopeWhereForTab(admin, undefined)).toEqual({});
  });

  test("authorized (global search) adds department + Custom CC for an employee", () => {
    expect(scopeWhereForTab(me, "authorized")).toEqual({
      OR: [
        { OR: [{ requesterId: "me" }, { assigneeId: "me" }] },
        { toDepartmentId: DEPT_A },
        { ccUsers: { some: { userId: "me" } } },
      ],
    });
  });
});

describe("resolveTicketAccess — access levels", () => {
  test("requester and assignee keep full access", () => {
    expect(resolveTicketAccess(employee("req", DEPT_B), ticket())).toBe("full");
    expect(resolveTicketAccess(employee("asg", DEPT_B), ticket())).toBe("full");
  });

  test("employee in the ticket's department (not requester/assignee) is a participant", () => {
    expect(resolveTicketAccess(employee("other", DEPT_A), ticket())).toBe("participant");
  });

  test("employee in another department with no relationship has no access", () => {
    expect(resolveTicketAccess(employee("other", DEPT_B), ticket())).toBeNull();
  });

  test("Custom CC grants participant access, only when the server says so", () => {
    expect(resolveTicketAccess(employee("cc", DEPT_B), ticket(), { isCcUser: true })).toBe("participant");
    expect(resolveTicketAccess(employee("cc", DEPT_B), ticket(), { isCcUser: false })).toBeNull();
  });

  test("CC never downgrades a stronger relationship (requester who is also CC'd)", () => {
    expect(resolveTicketAccess(employee("req", DEPT_B), ticket(), { isCcUser: true })).toBe("full");
  });

  test("Team Lead / Manager: full only for their UserDepartmentAccess departments (unchanged)", () => {
    expect(resolveTicketAccess(teamLead("tl"), ticket(), { userDepartmentIds: [DEPT_A] })).toBe("full");
    expect(resolveTicketAccess(teamLead("tl"), ticket(), { userDepartmentIds: [DEPT_B] })).toBeNull();
    expect(resolveTicketAccess(manager("m"), ticket(), { userDepartmentIds: [DEPT_A, DEPT_B] })).toBe("full");
  });

  test("Team Lead / Manager are never department 'participants' via legacy departmentId", () => {
    const tl = { ...teamLead("tl"), departmentId: DEPT_A };
    expect(resolveTicketAccess(tl, ticket(), { userDepartmentIds: [] })).toBeNull();
  });

  test("Manager CC'd on another department's ticket is a participant, not full", () => {
    expect(resolveTicketAccess(manager("m"), ticket(), { userDepartmentIds: [DEPT_B], isCcUser: true })).toBe("participant");
  });

  test("Manager/Team Lead requester read exception is preserved (view only)", () => {
    const access = resolveTicketAccess(manager("req"), ticket(), { userDepartmentIds: [DEPT_B] });
    expect(access).toBe("requester-read");
    expect(canViewTicket(access)).toBe(true);
    expect(canParticipate(access)).toBe(false);
  });

  test("ADMIN always full (unchanged)", () => {
    expect(resolveTicketAccess(admin, ticket())).toBe("full");
  });

  test("view/participate helpers", () => {
    expect(canViewTicket(null)).toBe(false);
    expect(canParticipate(null)).toBe(false);
    expect(canViewTicket("participant")).toBe(true);
    expect(canParticipate("participant")).toBe(true);
    expect(canParticipate("full")).toBe(true);
  });
});
