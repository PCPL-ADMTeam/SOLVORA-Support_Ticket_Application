// TICKET_COMMENT_ADDED recipients (recipientBuilder.js#buildCommentRecipients)
// and the shared address resolution in notification.service.js#notify /
// email.service.js#sendMail. Prisma, the department-access lookups, the
// Graph transport and templates are all mocked — no DB, no real email.
jest.mock("../../config/prisma", () => ({
  ticketCC: { findMany: jest.fn() },
  user: { findUnique: jest.fn() },
  notification: { create: jest.fn() },
}));
jest.mock("../userDepartmentAccess.service", () => ({
  getActiveDepartmentTeamLeads: jest.fn(),
  getActiveDepartmentManagers: jest.fn(),
}));

const prisma = require("../../config/prisma");
const departmentAccess = require("../userDepartmentAccess.service");
const { buildCommentRecipients, buildAssignedOrCommentRecipients } = require("../../utils/recipientBuilder");

const REQ = "requester";
const ASG = "assignee";
const TL1 = "tl-1";
const TL2 = "tl-2";
const MGR1 = "mgr-1";
const MGR2 = "mgr-2";
const CC1 = "cc-1";
const CC2 = "cc-2";

function setup({ teamLeads = [TL1, TL2], managers = [MGR1, MGR2], cc = [CC1, CC2] } = {}) {
  departmentAccess.getActiveDepartmentTeamLeads.mockResolvedValue(teamLeads.map((id) => ({ id })));
  departmentAccess.getActiveDepartmentManagers.mockResolvedValue(managers.map((id) => ({ id })));
  prisma.ticketCC.findMany.mockResolvedValue(cc.map((userId) => ({ userId })));
}

const ticket = (overrides = {}) => ({ id: "t1", requesterId: REQ, assigneeId: ASG, toDepartmentId: "dept", ...overrides });

describe("buildCommentRecipients", () => {
  beforeEach(() => jest.clearAllMocks());

  test("1. assigned ticket: To = the assignee", async () => {
    setup();
    const { userIds } = await buildCommentRecipients(ticket());
    expect(userIds).toEqual([ASG]);
  });

  test("2. assigned ticket: CC = Team Leads + Managers + requester + Custom CC", async () => {
    setup();
    const { ccUserIds } = await buildCommentRecipients(ticket());
    expect(ccUserIds.sort()).toEqual([REQ, TL1, TL2, MGR1, MGR2, CC1, CC2].sort());
  });

  test("3. unassigned ticket: To = the requester", async () => {
    setup();
    const { userIds } = await buildCommentRecipients(ticket({ assigneeId: null }));
    expect(userIds).toEqual([REQ]);
  });

  test("4. unassigned ticket: CC = Team Leads + Managers + Custom CC (requester not duplicated)", async () => {
    setup();
    const { ccUserIds } = await buildCommentRecipients(ticket({ assigneeId: null }));
    expect(ccUserIds.sort()).toEqual([TL1, TL2, MGR1, MGR2, CC1, CC2].sort());
  });

  test("5. no Team Leads: Managers and Custom CC kept", async () => {
    setup({ teamLeads: [] });
    const { userIds, ccUserIds } = await buildCommentRecipients(ticket({ assigneeId: null }));
    expect(userIds).toEqual([REQ]);
    expect(ccUserIds.sort()).toEqual([MGR1, MGR2, CC1, CC2].sort());
  });

  test("6. no Managers: Team Leads and Custom CC kept", async () => {
    setup({ managers: [] });
    const { ccUserIds } = await buildCommentRecipients(ticket());
    expect(ccUserIds.sort()).toEqual([REQ, TL1, TL2, CC1, CC2].sort());
  });

  test("no department mapping and no Custom CC: still sends To the primary recipient", async () => {
    setup({ teamLeads: [], managers: [], cc: [] });
    expect(await buildCommentRecipients(ticket({ assigneeId: null }))).toEqual({ userIds: [REQ], ccUserIds: [] });
    expect(await buildCommentRecipients(ticket())).toEqual({ userIds: [ASG], ccUserIds: [REQ] });
  });

  test("7/8. duplicates across groups collapse, and the To user is never also in CC", async () => {
    // Assignee is also a Team Lead and a Custom CC; requester is also a Custom CC.
    setup({ teamLeads: [TL1, ASG], managers: [MGR1, TL1], cc: [ASG, REQ, CC1] });
    const { userIds, ccUserIds } = await buildCommentRecipients(ticket());
    expect(userIds).toEqual([ASG]);
    expect(ccUserIds).not.toContain(ASG);
    expect(new Set(ccUserIds).size).toBe(ccUserIds.length);
    expect(ccUserIds.sort()).toEqual([REQ, TL1, MGR1, CC1].sort());
  });

  test("unassigned: requester who is also a Team Lead / Custom CC appears only in To", async () => {
    setup({ teamLeads: [REQ, TL1], cc: [REQ] });
    const { userIds, ccUserIds } = await buildCommentRecipients(ticket({ assigneeId: null }));
    expect(userIds).toEqual([REQ]);
    expect(ccUserIds).not.toContain(REQ);
  });

  test("9. no assignee and no requester: empty To (notify() will log and skip)", async () => {
    setup();
    const { userIds } = await buildCommentRecipients(ticket({ assigneeId: null, requesterId: null }));
    expect(userIds).toEqual([]);
  });

  test("12. TICKET_ASSIGNED/REASSIGNED builder is unchanged (assignee-only To)", async () => {
    setup();
    expect((await buildAssignedOrCommentRecipients(ticket({ assigneeId: null }))).userIds).toEqual([]);
    const assigned = await buildAssignedOrCommentRecipients(ticket());
    expect(assigned.userIds).toEqual([ASG]);
    expect(assigned.ccUserIds.sort()).toEqual([REQ, TL1, TL2, MGR1, MGR2, CC1, CC2].sort());
  });
});

describe("notify() — address resolution, dedupe, failures", () => {
  let notificationService;
  let emailService;

  beforeAll(() => {
    jest.doMock("../email.service", () => ({ sendMail: jest.fn(), resolveUserEmail: jest.fn() }));
    jest.doMock("../emailTemplate.service", () => ({ renderTemplate: jest.fn().mockResolvedValue({ subject: "S", body: "B" }) }));
    jest.doMock("../blobStorage.service", () => ({ downloadBlobBuffer: jest.fn() }));
    notificationService = require("../notification.service");
    emailService = require("../email.service");
  });

  const ADDR = {
    [ASG]: "Assignee@Example.com",
    [REQ]: "requester@example.com",
    [TL1]: "assignee@example.com", // same mailbox as the assignee, different case
    [MGR1]: "manager@example.com",
    [CC1]: "MANAGER@example.com", // duplicate of the manager, different case
    [CC2]: "not-an-email",
    [MGR2]: "",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ name: "Someone" });
    prisma.notification.create.mockResolvedValue({});
    emailService.resolveUserEmail.mockImplementation(async (id) => ADDR[id] ?? null);
    emailService.sendMail.mockResolvedValue(undefined);
  });

  test("dedupes case-insensitively, keeps To out of CC, drops empty/invalid addresses", async () => {
    await notificationService.notify({
      eventKey: "TICKET_COMMENT_ADDED",
      userIds: [ASG],
      ccUserIds: [REQ, TL1, MGR1, CC1, CC2, MGR2],
      ticketId: "t1",
      ticket: { id: "t1" },
    });
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
    const { to, cc } = emailService.sendMail.mock.calls[0][0];
    expect(to).toEqual(["Assignee@Example.com"]);
    expect(cc).toEqual(["requester@example.com", "manager@example.com"]);
    // In-app bell row only for the To recipient (unchanged behavior).
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  test("9. missing primary address: no email sent, warning logged, no throw", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      notificationService.notify({ eventKey: "TICKET_COMMENT_ADDED", userIds: [CC2], ccUserIds: [MGR1], ticketId: "t1", ticket: { id: "t1" } })
    ).resolves.toBeUndefined();
    expect(emailService.sendMail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no valid To address"));
    warn.mockRestore();
  });

  test("10. transport failure is logged and never thrown (comment already saved)", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    emailService.sendMail.mockRejectedValue(new Error("Graph down"));
    await expect(
      notificationService.notify({ eventKey: "TICKET_COMMENT_ADDED", userIds: [REQ], ccUserIds: [MGR1], ticketId: "t1", ticket: { id: "t1" } })
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[notifications] Failed to email"), "Graph down");
    error.mockRestore();
  });
});

describe("email.service sendMail — Graph transport error", () => {
  test("10. a Graph failure is logged, not thrown", async () => {
    jest.resetModules();
    jest.doMock("axios", () => ({ post: jest.fn().mockRejectedValue(Object.assign(new Error("boom"), { response: { data: { error: { message: "Mailbox unavailable" } } } })) }));
    jest.doMock("../entra.service", () => ({ isConfigured: () => true, getAccessToken: jest.fn().mockResolvedValue("token") }));
    jest.doMock("../../config/env", () => ({ cloudready: { mailbox: "helpdesk@example.com" } }));
    const realEmailService = jest.requireActual("../email.service");
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(realEmailService.sendMail({ to: ["a@example.com"], subject: "S", html: "B" })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Microsoft Graph sendMail failed"), "Mailbox unavailable");
    error.mockRestore();
  });
});
