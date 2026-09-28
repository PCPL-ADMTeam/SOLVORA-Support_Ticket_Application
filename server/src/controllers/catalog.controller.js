// Controller for the small admin "catalog" resource: priorities. A thin
// CRUD wrapper around its service.
const priorityService = require("../services/priority.service");

const priorities = {
  list: async (_req, res) => res.json({ success: true, data: await priorityService.listPriorities() }),
  create: async (req, res) => {
    const priority = await priorityService.createPriority(req.user.id, req.body);
    res.status(201).json({ success: true, data: priority });
  },
  update: async (req, res) => {
    const priority = await priorityService.updatePriority(req.user.id, req.params.id, req.body);
    res.json({ success: true, data: priority });
  },
};

module.exports = { priorities };
