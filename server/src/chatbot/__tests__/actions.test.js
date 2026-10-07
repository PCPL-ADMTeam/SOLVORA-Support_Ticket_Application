jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

const ApiError = require("../../utils/ApiError");
const departmentService = require("../../services/department.service");
const userService = require("../../services/user.service");
const accessService = require("../../services/userDepartmentAccess.service");
const ticketService = require("../../services/ticket.service");
const service = require("../chatbot.service");
const { users, D1, D2, ticket, seedDefault, prismaMock } = require("../testkit/fixtures");

// Remember the one-time proof (token + conversation) the preview returns, the way the browser does.
const proofs = new Map();
const ask = async (user, message, conversationId) => {
  const r = await service.sendMessage(user, { message, conversationId });
  if (r.data?.pendingAction) proofs.set(r.data.pendingAction.id, { token: r.data.pendingAction.confirmationToken, conversationId: r.conversationId });
  return r;
};
const confirmP = (user, id) => service.confirmAction(user, id, proofs.get(id));
const cancelP = (user, id) => service.cancelAction(user, id, proofs.get(id));
const pendingRows = () => prismaMock.__db.pending;
let spies;

beforeEach(() => {
  seedDefault();
  spies = {
    createDepartment: jest.spyOn(departmentService, "createDepartment").mockResolvedValue({}),
    updateDepartment: jest.spyOn(departmentService, "updateDepartment").mockResolvedValue({}),
    addManager: jest.spyOn(accessService, "addManagerDepartmentAccess").mockResolvedValue({}),
    setTeamLead: jest.spyOn(accessService, "setTeamLeadDepartment").mockResolvedValue({}),
    removeAccess: jest.spyOn(accessService, "removeUserDepartmentAccess").mockResolvedValue(undefined),
    deactivate: jest.spyOn(userService, "deactivateUser").mockResolvedValue({}),
    updateUser: jest.spyOn(userService, "updateUser").mockResolvedValue({}),
    updateTicket: jest.spyOn(ticketService, "updateTicket").mockResolvedValue({}),
  };
});
afterEach(() => jest.restoreAllMocks());

const noServiceCalled = () => Object.values(spies).forEach((s) => expect(s).not.toHaveBeenCalled());

describe("preview first, execute only on confirmation", () => {
  test("asking for a change only PREPARES it: nothing is executed", async () => {
    const r = await ask(users.admin, "Create new department Legal");
    expect(r.intent).toBe("admin_action");
    expect(r.error).toBeNull();
    expect(r.data.pendingAction).toMatchObject({ title: "Create department", summary: 'Create the department "Legal".' });
    expect(r.data.pendingAction.impact.length).toBeGreaterThan(0);
    expect(r.message).toMatch(/Nothing has been changed yet/);
    expect(pendingRows()).toHaveLength(1);
    expect(pendingRows()[0].status).toBe("PENDING");
    noServiceCalled();
  });

  test("typing 'yes' / 'confirm' in chat never executes anything", async () => {
    const r = await ask(users.admin, "Create new department Legal");
    for (const msg of ["yes", "confirm", "yes, do it", "Confirm create department Legal"]) await ask(users.admin, msg, r.conversationId);
    noServiceCalled();
    expect(pendingRows().filter((p) => p.status === "EXECUTED")).toHaveLength(0);
  });

  test("confirming executes through the existing service exactly once, as the admin, and reports the real result", async () => {
    const r = await ask(users.admin, "Create new department Legal");
    const id = r.data.pendingAction.id;
    const out = await confirmP(users.admin, id);
    expect(out).toMatchObject({ status: "EXECUTED", message: 'Department "Legal" was created.' });
    expect(spies.createDepartment).toHaveBeenCalledTimes(1);
    expect(spies.createDepartment).toHaveBeenCalledWith(users.admin.id, { name: "Legal" });

    const again = await confirmP(users.admin, id);
    expect(again.status).toBe("EXECUTED");
    expect(spies.createDepartment).toHaveBeenCalledTimes(1); // no double execution
    expect(prismaMock.__db.audit.map((a) => a.action)).toEqual(expect.arrayContaining(["ACTION_PROPOSED", "ACTION_EXECUTED"]));
    expect(prismaMock.__db.auditLogs.some((a) => a.action === "CHATBOT_ACTION_EXECUTED" && a.userId === users.admin.id)).toBe(true);
    // The result is also saved to the conversation transcript.
    const convo = await service.getConversation(users.admin, r.conversationId);
    expect(convo.messages.at(-1)).toMatchObject({ intent: "action_result", text: 'Department "Legal" was created.' });
  });

  test("cancel discards it; a later confirm does nothing", async () => {
    const id = (await ask(users.admin, "Create new department Legal")).data.pendingAction.id;
    expect((await cancelP(users.admin, id)).status).toBe("CANCELLED");
    expect((await confirmP(users.admin, id)).status).toBe("CANCELLED");
    noServiceCalled();
  });

  test("an expired proposal cannot be confirmed", async () => {
    const id = (await ask(users.admin, "Create new department Legal")).data.pendingAction.id;
    pendingRows()[0].expiresAt = new Date(Date.now() - 1000);
    expect((await confirmP(users.admin, id)).status).toBe("EXPIRED");
    noServiceCalled();
  });

  test("concurrent confirmations execute once", async () => {
    const id = (await ask(users.admin, "Create new department Legal")).data.pendingAction.id;
    const results = await Promise.all([confirmP(users.admin, id), confirmP(users.admin, id)]);
    expect(spies.createDepartment).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status).sort()).toContain("EXECUTED");
  });
});

describe("who may do this", () => {
  test.each(["employee", "team lead", "manager"])("%s cannot even prepare admin-only changes", async (who) => {
    const user = { employee: users.empA, "team lead": users.tlD1, manager: users.mgrD2 }[who];
    for (const msg of ["Create new department Legal", "Deactivate user Ravi Kumar", "Change role of Ravi Kumar to Manager", "rename user Ravi Kumar to Ravi K", "add employee Jane Doe jane@powercen.com to Finance", "Assign John Manager as Manager for Finance"]) {
      const r = await ask(user, msg);
      expect(r.error.code).toBe("CHAT_ACCESS_DENIED");
      expect(r.data.pendingAction).toBeUndefined();
    }
    expect(pendingRows()).toHaveLength(0);
    noServiceCalled();
  });

  test("a pending action belongs to the admin who asked: another admin and non-admins cannot confirm or cancel it", async () => {
    const id = (await ask(users.admin, "Create new department Legal")).data.pendingAction.id;
    await expect(confirmP(users.admin2, id)).rejects.toMatchObject({ code: "CHAT_ACTION_NOT_FOUND" });
    await expect(cancelP(users.admin2, id)).rejects.toMatchObject({ code: "CHAT_ACTION_NOT_FOUND" });
    // Someone else's proposal is simply "not found" to them (ownership is checked before anything else).
    await expect(confirmP(users.empA, id)).rejects.toMatchObject({ code: "CHAT_ACTION_NOT_FOUND" });
    await expect(confirmP(users.tlD1, id)).rejects.toMatchObject({ code: "CHAT_ACTION_NOT_FOUND" });
    noServiceCalled();
    expect(pendingRows()[0].status).toBe("PENDING");
    expect(prismaMock.__db.audit.some((a) => a.action === "ACTION_ACCESS_DENIED" && a.result === "DENIED")).toBe(true);
  });

  test("an admin who is demoted after proposing cannot confirm (role is re-read per request)", async () => {
    const id = (await ask(users.admin, "Create new department Legal")).data.pendingAction.id;
    const demoted = { ...users.admin, role: { name: "EMPLOYEE", label: "Employee" } };
    await expect(confirmP(demoted, id)).rejects.toMatchObject({ code: "CHAT_ACCESS_DENIED" });
    noServiceCalled();
  });
});

describe("each action calls the existing service with resolved ids", () => {
  const run = async (msg) => {
    const r = await ask(users.admin, msg);
    expect(r.error).toBeNull();
    return confirmP(users.admin, r.data.pendingAction.id);
  };

  test("rename department", async () => {
    const out = await run("Rename department Finance to Accounts");
    expect(spies.updateDepartment).toHaveBeenCalledWith(users.admin.id, D2.id, { name: "Accounts" });
    expect(out.message).toBe('Department "Finance" was renamed to "Accounts".');
  });

  test("assign manager (typo-tolerant department, partial user name)", async () => {
    await run("Assign John Manager as Manager for finance department");
    expect(spies.addManager).toHaveBeenCalledWith(users.admin.id, users.john.id, D2.id);
  });

  test("assign team lead", async () => {
    prismaMock.__db.access = prismaMock.__db.access.filter((a) => a.userId !== users.tl2.id); // free a slot
    await run("Assign Free Lead as team lead of IT Support");
    expect(spies.setTeamLead).toHaveBeenCalledWith(users.admin.id, users.tlFree.id, D1.id);
  });

  test("remove manager / team lead", async () => {
    await run("Remove Mark Manager as manager of Finance");
    expect(spies.removeAccess).toHaveBeenCalledWith(users.admin.id, users.mgrD2.id, D2.id);
    await run("Remove Tina Lead as team lead of IT Support");
    expect(spies.removeAccess).toHaveBeenLastCalledWith(users.admin.id, users.tlD1.id, D1.id);
  });

  test("deactivate and activate user", async () => {
    await run("Deactivate user Ravi Kumar");
    expect(spies.deactivate).toHaveBeenCalledWith(users.admin.id, users.ravi.id);
    await run("Activate Dormant Dan");
    expect(spies.updateUser).toHaveBeenCalledWith(users.admin.id, users.dormant.id, { isActive: true });
  });

  test("change role and move department", async () => {
    await run("Change role of Ravi Kumar to Team Lead");
    expect(spies.updateUser).toHaveBeenCalledWith(users.admin.id, users.ravi.id, { roleName: "TEAMLEAD" });
    await run("Move Ravi Kumar to Finance department");
    expect(spies.updateUser).toHaveBeenLastCalledWith(users.admin.id, users.ravi.id, { departmentId: D2.id });
  });

  test("change ticket priority and close ticket (with the admin as the acting user)", async () => {
    prismaMock.__db.priorities.push({ id: "p_crit", name: "Critical", level: 4, color: "#000" });
    await run("Change priority of ticket 2627001 to critical");
    expect(spies.updateTicket).toHaveBeenCalledWith(users.admin, "id_2627001", { priorityId: "p_crit" });
    const out = await run("Close ticket 2627001 reason: duplicate of 2627004");
    expect(spies.updateTicket).toHaveBeenLastCalledWith(users.admin, "id_2627001", { status: "CLOSED", closedReason: "duplicate of 2627004" });
    expect(out.message).toBe("Ticket 2627001 was closed.");
  });
});

describe("validation happens at preview time (no pending action is created)", () => {
  test.each([
    ["Create new department Finance", /already exists/],
    ["Rename department Nowhere to X", /couldn't find a department/],
    ["Deactivate user Nobody Here", /couldn't find a user/],
    ["Deactivate user Ada Admin", /own account/],
    ["Deactivate user Dormant Dan", /already deactivated/],
    ["Activate Ravi Kumar", /already active/],
    ["Assign Ravi Kumar as Manager for Finance", /only Manager users can be assigned/],
    ["Assign Tessa Lead as team lead of Finance", /already Team Lead of IT Support/],
    ["Assign Free Lead as team lead of IT Support", /maximum of 2 Team Leads/],
    ["Assign Mark Manager as Manager for Finance", /already Manager of Finance/],
    ["Remove John Manager as manager of Finance", /not Manager of Finance/],
    ["Change role of Ravi Kumar to Admin", /can't grant the Admin role/],
    ["Change role of Other Admin to Employee", /Admin's role/],
    ["Change role of Ada Admin to Manager", /Admin's role/],
    ["Change role of Ravi Kumar to Employee", /already an Employee/],
    ["Change priority of ticket 2627001 to Urgent", /not a priority/],
    ["Change priority of ticket 2627001 to High", /already has High priority/],
    ["Change priority of ticket 9999999 to Low", /do not have permission to access this ticket, or the ticket could not be found/],
  ])("%s", async (msg, expected) => {
    const r = await ask(users.admin, msg);
    // Preview-time refusals: a validation / role / transition / scope code, never a pending action.
    expect(["CHAT_ACTION_INVALID", "CHAT_INVALID_ROLE_OPERATION", "CHAT_TICKET_NOT_FOUND", "CHAT_INVALID_TICKET_TRANSITION"]).toContain(r.error?.code);
    expect(r.message).toMatch(expected);
    expect(r.data.pendingAction).toBeUndefined();
    expect(pendingRows()).toHaveLength(0);
    noServiceCalled();
  });

  test("ambiguous names can be resolved with an email, which is never echoed back", async () => {
    const amb = await ask(users.admin, "Deactivate user Sam Smith");
    expect(amb.message).toMatch(/Employee, IT Support\)[\s\S]*Employee, Finance\)/);
    expect(amb.message).not.toContain("@example.test");
    const r = await ask(users.admin, "Deactivate user u_samA@example.test");
    expect(r.data.pendingAction.summary).toBe("Deactivate Sam Smith (Employee).");
    expect(JSON.stringify(r)).not.toContain("@example.test");
  });

  test("an already-closed ticket cannot be closed again", async () => {
    prismaMock.__db.tickets.find((t) => t.ticketNumber === "2627004").status = "CLOSED";
    expect((await ask(users.admin, "Close ticket 2627004 reason: x")).message).toMatch(/already closed/);
  });
});

describe("failures are reported honestly", () => {
  test("an application rejection is shown as not done, with its reason", async () => {
    spies.createDepartment.mockRejectedValue(new ApiError(409, "A record with this name already exists"));
    const id = (await ask(users.admin, "Create new department Legal")).data.pendingAction.id;
    const out = await confirmP(users.admin, id);
    expect(out.status).toBe("FAILED");
    expect(out.message).toMatch(/wasn't made.*already exists/);
    expect(out.message).not.toMatch(/was created/);
    expect(prismaMock.__db.audit.some((a) => a.action === "ACTION_FAILED")).toBe(true);
    expect(pendingRows()[0].status).toBe("FAILED");
  });

  test("an unexpected error is generic: no internals, no claim of success", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    spies.deactivate.mockRejectedValue(new Error("connection to 10.1.2.3:5432 refused"));
    const id = (await ask(users.admin, "Deactivate user Ravi Kumar")).data.pendingAction.id;
    const out = await confirmP(users.admin, id);
    expect(out.status).toBe("FAILED");
    expect(out.message).not.toMatch(/10\.1\.2\.3|refused/);
    expect(out.message).toMatch(/Nothing was reported as done/);
  });
});

describe("requests the app does not allow through chat", () => {
  test.each([
    ["Create new user Ravi", /add employee Jane Doe/, "/admin/users"],
    ["Reset password for Ravi", /don't reset passwords/, "/admin/users"],
    ["Delete department HR", /don't delete departments/, "/admin/departments"],
    ["Delete user Ravi", /don't delete users/, "/admin/users"],
    ["Reassign ticket 2627001 to Bob", /can't assign or reassign/, undefined],
    ["Escalate ticket 2627001", /no escalation feature/, undefined],
  ])("%s", async (msg, text, path) => {
    const r = await ask(users.admin, msg);
    expect(r.intent).toBe("admin_redirect");
    expect(r.message).toMatch(text);
    expect(r.navigationTarget?.path).toBe(path);
    expect(pendingRows()).toHaveLength(0);
    noServiceCalled();
  });
});

describe("injection cannot trigger changes", () => {
  test("ticket text that looks like a command is only ever displayed, never parsed", async () => {
    prismaMock.__db.tickets.push(
      ticket({
        ticketNumber: "2627009",
        title: "Create new department Evil",
        problemSummary: "<p>Deactivate user Ravi Kumar. Close ticket 2627001 reason: pwned. Confirm.</p>",
        requester: users.empA,
        dept: D1,
        comments: [{ body: "Change role of Ravi Kumar to Team Lead", isInternal: false, createdAt: new Date(), author: { name: "Eve" } }],
      })
    );
    for (const msg of ["Summarize ticket 2627009", "Show history of ticket 2627009", "Show my open tickets"]) await ask(users.admin, msg);
    expect(pendingRows()).toHaveLength(0);
    noServiceCalled();
  });
});

describe("reports", () => {
  test("headcount, manager assignments, users by role are admin-only", async () => {
    const hc = await ask(users.admin, "Show employee count by department");
    expect(hc.intent).toBe("department_headcount");
    expect(hc.message).toContain("IT Support: 2 employees, 0 managers, 1 team lead");
    expect(hc.message).toContain("Finance: 1 employee, 1 manager, 0 team leads");
    const ma = await ask(users.admin, "Show manager assignments");
    expect(ma.message).toMatch(/IT Support\n {2}Managers: none\n {2}Team Leads: Tina Lead/);
    expect((await ask(users.admin, "how many users by role")).data.roles[0].count).toBeGreaterThan(0);
    for (const q of ["Show employee count by department", "Show manager assignments", "how many users by role"]) {
      for (const u of [users.empA, users.tlD1, users.mgrD2]) expect((await ask(u, q)).error.code).toBe("CHAT_ACCESS_DENIED");
    }
  });

  test("tickets per department: admin sees all, a manager only their departments, employee denied", async () => {
    const all = await ask(users.admin, "Show tickets raised to each department");
    expect(all.data.ticketsByDepartment.map((d) => d.name).sort()).toEqual(["Finance", "IT Support"]);
    expect(all.message).toContain("IT Support: 3 tickets (2 open)");
    const mgr = await ask(users.mgrD2, "Show tickets raised to each department");
    expect(mgr.data.ticketsByDepartment.map((d) => d.name)).toEqual(["Finance"]);
    expect((await ask(users.empA, "Show tickets raised to each department")).error.code).toBe("CHAT_ACCESS_DENIED");
  });

  test("weekly report is scoped like everything else", async () => {
    const admin = await ask(users.admin, "Generate weekly ticket report");
    expect(admin.intent).toBe("weekly_report");
    expect(admin.data.weeklyReport.openNow).toBe(3);
    const mgr = await ask(users.mgrD2, "Generate weekly ticket report");
    expect(mgr.data.weeklyReport.openNow).toBe(1);
    expect((await ask(users.empA, "Generate weekly ticket report")).error.code).toBe("CHAT_ACCESS_DENIED");
  });

  test("SLA breaches are still answered honestly", async () => {
    expect((await ask(users.admin, "Show SLA breaches")).message).toMatch(/doesn't track/);
  });
});

describe("renaming departments and people (phrasing variants)", () => {
  const confirmIt = async (msg) => {
    const r = await ask(users.admin, msg);
    expect(r.error).toBeNull();
    return confirmP(users.admin, r.data.pendingAction.id);
  };

  test.each([
    'change the department "Finance" to Accounts',
    "rename department Finance to Accounts",
    "change the name of department Finance to Accounts",
    "rename Finance department to Accounts",
  ])("department rename: %s", async (msg) => {
    const out = await confirmIt(msg);
    expect(spies.updateDepartment).toHaveBeenCalledWith(users.admin.id, D2.id, { name: "Accounts" });
    expect(out.status).toBe("EXECUTED");
  });

  test.each([
    "rename user Ravi Kumar to Ravi K",
    "change the name of employee Ravi Kumar to Ravi K",
    "change Ravi Kumar's name to Ravi K",
    "rename Ravi Kumar to Ravi K",
  ])("person rename: %s", async (msg) => {
    const out = await confirmIt(msg);
    expect(spies.updateUser).toHaveBeenCalledWith(users.admin.id, users.ravi.id, { name: "Ravi K" });
    expect(out.message).toBe('Ravi Kumar\'s name was changed to "Ravi K".');
  });

  test("the preview says email, login and role are unchanged", async () => {
    const r = await ask(users.admin, "rename user Ravi Kumar to Ravi K");
    expect(r.data.pendingAction.impact.join(" ")).toMatch(/email address, login, role and department do not change/);
    noServiceCalled();
  });

  test("'rename <department> to X' without the word department points to the right phrasing", async () => {
    const r = await ask(users.admin, "rename Finance to Accounts");
    expect(r.error.code).toBe("CHAT_ACTION_INVALID");
    expect(r.message).toMatch(/is a department, not a person.*rename department Finance to/);
    expect(pendingRows()).toHaveLength(0);
  });

  test("same name / unknown person are rejected at preview", async () => {
    expect((await ask(users.admin, "rename user Ravi Kumar to Ravi Kumar")).message).toMatch(/already/);
    expect((await ask(users.admin, "rename user Nobody Here to X")).message).toMatch(/couldn't find a user/);
  });

  test("'create department name X' does not make the word 'name' part of the department", async () => {
    const r = await ask(users.admin, "create department name Maintenance");
    expect(r.data.pendingAction.summary).toBe('Create the department "Maintenance".');
  });

  test("non-admins cannot rename anyone", async () => {
    for (const u of [users.empA, users.tlD1, users.mgrD2]) {
      expect((await ask(u, "rename user Ravi Kumar to Ravi K")).error.code).toBe("CHAT_ACCESS_DENIED");
    }
    noServiceCalled();
  });
});

describe("closing and changing status asks for the explanation the ticket service requires", () => {
  const { parseAction } = require("../intents/actionParser");
  test.each([
    ["Close ticket 2627001", "reason"],
    ["close the status of ticket 2627001", "reason"],
    ["mark ticket 2627001 as closed", "reason"],
    ["set the status of ticket 2627001 to closed", "reason"],
    ["resolve ticket 2627001", "reason"],
    ["put ticket 2627001 on hold", "reason"],
    ["reopen ticket 2627001", "reason"],
  ])("%s asks for the reason first", (text, field) => {
    expect(parseAction(text).missing).toEqual([field]);
  });

  test("the reason can come in the same message or in the next one", () => {
    expect(parseAction("close the status of ticket 2627001 because duplicate")).toMatchObject({ action: "close_ticket", args: { ticket: "2627001", reason: "duplicate" } });
    expect(parseAction("put ticket 2627001 on hold since waiting for the vendor")).toMatchObject({ action: "change_ticket_status", args: { status: "on hold", reason: "waiting for the vendor" } });
    expect(parseAction("start ticket 2627001")).toMatchObject({ action: "change_ticket_status", args: { status: "in progress" } });
  });
});
