const { ChatError, CODES } = require("../chatbot.errors");
const { recordChatAudit } = require("../chatbot.audit");
const { validateInput } = require("./validate");
const { toolAllowed } = require("../permissions");
const ticketTools = require("./ticketTools");
const infoTools = require("./infoTools");
const reportTools = require("./reportTools");
const selfTools = require("./selfTools");

// Allow-list of chatbot tools. The language model never chooses from this
// list and never receives a database handle: our deterministic intent router
// picks a tool, and runTool() validates input, executes with the TRUSTED
// context (authenticated scope), and returns a restricted DTO.
const REGISTRY = new Map([...infoTools.tools, ...ticketTools.tools, ...reportTools.tools, ...selfTools.tools].map((t) => [t.name, t]));

function listToolDefinitions() {
  return [...REGISTRY.values()].map((t) => ({ name: t.name, description: t.description }));
}

// ctx: { scope (from roleScope.resolveRoleScope), conversationId }
async function runTool(name, ctx, rawInput = {}) {
  const tool = REGISTRY.get(name);
  if (!tool) throw new ChatError(CODES.UNSUPPORTED_INTENT, { internal: `unknown tool ${name}` });

  const toolCtx = {
    scope: ctx.scope,
    audit: (action, resourceType, resourceId, result) =>
      recordChatAudit({ userId: ctx.scope.userId, conversationId: ctx.conversationId, action, resourceType, resourceId, result }),
  };

  // Deny by default: the caller's (server-derived) permissions must cover this tool
  // BEFORE any data is touched. Each tool then re-checks scope on the rows it loads.
  if (!toolAllowed(name, ctx.scope.role, ctx.scope.permissions)) {
    await toolCtx.audit("TOOL_PERMISSION_DENIED", "Tool", name, "DENIED");
    throw new ChatError(CODES.ACCESS_DENIED, { internal: `permission denied for ${name}` });
  }

  const input = validateInput(tool.inputSchema, rawInput);
  try {
    return await tool.run(toolCtx, input);
  } catch (err) {
    if (err instanceof ChatError) throw err;
    // Anything else (Prisma, programming error) is an internal failure: log
    // server-side, show the user a generic message.
    console.error(`[chatbot] tool ${name} failed: ${err.code || err.name}: ${err.message}`);
    throw new ChatError(CODES.DATABASE_ERROR, { internal: err.message });
  }
}

module.exports = { runTool, listToolDefinitions, REGISTRY };
