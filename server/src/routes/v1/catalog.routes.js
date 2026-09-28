const { Router } = require("express");
const { priorities } = require("../../controllers/catalog.controller");
const authenticate = require("../../middleware/auth");
const requireRole = require("../../middleware/rbac");
const validate = require("../../middleware/validate");
const { priorityValidator } = require("../../validators/catalog.validator");

const priorityRouter = Router();
priorityRouter.use(authenticate);
priorityRouter.get("/", priorities.list); // readable by everyone (ticket form needs it)
priorityRouter.use(requireRole("ADMIN"));
priorityRouter.post("/", priorityValidator, validate, priorities.create);
priorityRouter.patch("/:id", priorityValidator, validate, priorities.update);

module.exports = { priorityRouter };
