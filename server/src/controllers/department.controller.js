// Controllers for Department + its per-department Issue list — the ticket
// form's To Department / Manager / Issue dropdowns. Grouped together since
// Issue only ever exists scoped to a Department, same pairing style as
// catalog.controller.js (Priority).
const departmentService = require("../services/department.service");
const issueService = require("../services/issue.service");
const userDepartmentAccessService = require("../services/userDepartmentAccess.service");

const departments = {
  list: async (_req, res) => res.json({ success: true, data: await departmentService.listDepartments() }),
  create: async (req, res) => {
    const department = await departmentService.createDepartment(req.user.id, req.body);
    res.status(201).json({ success: true, data: department });
  },
  update: async (req, res) => {
    const department = await departmentService.updateDepartment(req.user.id, req.params.id, req.body);
    res.json({ success: true, data: department });
  },
  remove: async (req, res) => {
    await departmentService.deleteDepartment(req.user.id, req.params.id);
    res.json({ success: true, message: "Department deleted" });
  },
  // Department Details reloads its whole department list after every
  // mutation (see DepartmentDetailsPage.jsx's existing onChanged=load
  // pattern) — these just confirm success; the caller re-fetches via
  // GET /departments as it already does. Split into Managers vs Team Leads
  // per the final role rules: a MANAGER may be added to any number of
  // departments (addManagerDepartmentAccess), a TEAMLEAD is instead SET onto
  // this one department, replacing any other department they might have had
  // (setTeamLeadDepartment) — both enforce the calling user's actual role
  // server-side, never trusting which button the frontend happened to call.
  addManager: async (req, res) => {
    await userDepartmentAccessService.addManagerDepartmentAccess(req.user.id, req.body.managerId, req.params.id);
    res.status(201).json({ success: true, message: "Manager access granted" });
  },
  removeManager: async (req, res) => {
    await userDepartmentAccessService.removeUserDepartmentAccess(req.user.id, req.params.managerId, req.params.id);
    res.json({ success: true, message: "Manager access removed" });
  },
  setTeamLead: async (req, res) => {
    await userDepartmentAccessService.setTeamLeadDepartment(req.user.id, req.body.teamLeadId, req.params.id);
    res.status(201).json({ success: true, message: "Team Lead assigned" });
  },
  removeTeamLead: async (req, res) => {
    await userDepartmentAccessService.removeUserDepartmentAccess(req.user.id, req.params.teamLeadId, req.params.id);
    res.json({ success: true, message: "Team Lead access removed" });
  },
};

const issues = {
  create: async (req, res) => {
    const issue = await issueService.createIssue(req.user.id, req.body);
    res.status(201).json({ success: true, data: issue });
  },
  update: async (req, res) => {
    const issue = await issueService.updateIssue(req.user.id, req.params.id, req.body);
    res.json({ success: true, data: issue });
  },
  remove: async (req, res) => {
    await issueService.deleteIssue(req.user.id, req.params.id);
    res.json({ success: true, message: "Issue deleted" });
  },
};

module.exports = { departments, issues };
