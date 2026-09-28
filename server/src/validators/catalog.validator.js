const { body } = require("express-validator");

const priorityValidator = [
  body("name").trim().notEmpty().withMessage("Priority name is required"),
  body("level").isInt({ min: 1 }).withMessage("level must be a positive integer"),
  body("color").optional().isHexColor().withMessage("color must be a hex value, e.g. #FF0000"),
];

module.exports = { priorityValidator };
