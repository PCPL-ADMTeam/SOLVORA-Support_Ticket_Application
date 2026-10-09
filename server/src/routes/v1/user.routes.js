const { Router } = require("express");
const userController = require("../../controllers/user.controller");
const authenticate = require("../../middleware/auth");
const requireRole = require("../../middleware/rbac");
const validate = require("../../middleware/validate");
const {
  createUserValidator,
  updateUserValidator,
  updateProfileValidator,
} = require("../../validators/user.validator");

const router = Router();
router.use(authenticate);

// Any authenticated user can update their own profile.
router.patch("/me/profile", updateProfileValidator, validate, userController.updateProfile);

// Any authenticated role — an EMPLOYEE raising a ticket needs to search
// coworkers to add as Custom CC, not just MANAGER/TEAMLEAD/ADMIN.
router.get("/search", userController.searchEmployees);

// The logged-in MANAGER/TEAMLEAD's own accessible departments
// (UserDepartmentAccess) — powers the Dashboard/Tickets "All Departments ▾"
// dropdown (a TEAMLEAD's list always has exactly one entry). Any
// authenticated role may call this; a non-management role simply gets an
// empty list (mirrors listAssignableEmployees' own "no access -> []" pattern).
router.get("/me/department-access", userController.myDepartmentAccess);

// MANAGER/TEAMLEAD use this to populate the actual assign/reassign picker;
// ADMIN also needs it for the read-only Assignee FILTER on the All Tickets
// page (AllTicketsPage.jsx) — merely being able to list eligible employees
// is not itself an "assign" action (that power is enforced separately, at
// updateTicket/bulkUpdate, where Admin is rejected regardless of what this
// endpoint returns), so Admin keeps this pre-existing read capability.
// EMPLOYEE gets only their own department's people, for the Department
// Tickets Assignee filter (see user.service.js#listAssignableEmployees).
router.get("/assignable-agents", requireRole("ADMIN", "MANAGER", "TEAMLEAD", "EMPLOYEE"), userController.assignableEmployees);

// Everything else is Admin-only user management.
router.use(requireRole("ADMIN"));

// Admin Users "Department Access" dialog: load a specific Manager/Team
// Lead's current grants, then save a full replacement set — role-aware
// (MAX_TEAMLEADS_PER_DEPARTMENT and "exactly one department for a TEAMLEAD"
// are enforced server-side inside userDepartmentAccess.service.js).
router.get("/:id/department-access", userController.getDepartmentAccess);
router.put("/:id/department-access", userController.replaceDepartmentAccess);

// CloudReady/Entra corporate directory — for mapping a Helpdesk EMPLOYEE to
// their Entra account. Placed before "/:id" so "entra-directory" isn't
// swallowed by that param route.
router.get("/entra-directory", userController.entraDirectory);

router.get("/", userController.list);
router.get("/:id", userController.getById);
router.post("/", createUserValidator, validate, userController.create);
router.patch("/:id", updateUserValidator, validate, userController.update);
router.delete("/:id", userController.deactivate);

// Real hard delete. Kept as a distinct path from "/:id" above (which is
// already the existing deactivate/soft-delete action) so neither behavior
// has to change.
router.delete("/:id/permanent", userController.remove);

module.exports = router;
