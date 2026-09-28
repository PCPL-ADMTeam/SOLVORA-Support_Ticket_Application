const { body } = require("express-validator");

const createDepartmentValidator = [
  body("name").trim().notEmpty().withMessage("Department name is required"),
];

const updateDepartmentValidator = [
  body("name").optional().trim().notEmpty().withMessage("Department name is required"),
];

const issueValidator = [
  body("departmentId").notEmpty().withMessage("Department is required"),
  body("name").trim().notEmpty().withMessage("Issue name is required"),
  body("isOther").optional().isBoolean(),
];

const updateIssueValidator = [
  body("name").optional().trim().notEmpty(),
  body("isActive").optional().isBoolean(),
];

module.exports = { createDepartmentValidator, updateDepartmentValidator, issueValidator, updateIssueValidator };
