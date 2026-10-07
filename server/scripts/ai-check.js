#!/usr/bin/env node
// Manual setup / deployment check for the OpenRouter models.
//
//   npm run ai:check                 verify the configured intent + summary models
//   npm run ai:check -- --candidates list catalog models that meet the intent-model requirements
//
// It reads the PUBLIC model catalog (no API key is sent or printed), so run it
// before choosing OPENROUTER_INTENT_MODEL / OPENROUTER_SUMMARY_MODEL. It never
// changes configuration and never calls a model.

const env = require("../src/config/env");
const ModelCapabilityService = require("../src/chatbot/providers/modelCapabilityService");
const { evaluate, metaFor } = ModelCapabilityService;
const { aiStatus, summaryUsable } = require("../src/chatbot/interpretation/aiConfig");

const svc = new ModelCapabilityService({ config: env.ai });
const o = env.ai.openrouter;

const perMillion = (v) => (v === undefined || v === null ? "?" : `$${(Number(v) * 1e6).toFixed(2)}`);

async function candidates() {
  const catalog = await svc.fetchCatalog();
  const ok = catalog
    .map((e) => ({ e, r: evaluate(metaFor(e), { requireStructured: true, maxOutputTokens: o.maxOutputTokens }) }))
    // Dynamic routers ("openrouter/auto", negative placeholder prices) pick the model per request:
    // not suitable where you must control which provider sees your data.
    .filter((x) => x.r.usable && Number(x.e.pricing?.prompt || 0) >= 0 && !/^(openrouter\/|~)/.test(x.e.id))
    .sort((a, b) => Number(a.e.pricing?.prompt || 0) - Number(b.e.pricing?.prompt || 0));
  console.log(`${ok.length} of ${catalog.length} catalog models meet the intent-model requirements (text in/out, structured outputs, context >= 8000, not expired).`);
  console.log("Cheapest first. Price is per 1M tokens (input / output). Check data-handling terms before use.\n");
  for (const { e, r } of ok.slice(0, 40)) {
    const free = /:free$/.test(e.id) ? "  [free tier: usually retains/uses prompts; not for production ticket data]" : "";
    console.log(`${e.id.padEnd(52)} ctx ${String(r.contextLength).padStart(8)}  in ${perMillion(e.pricing?.prompt).padStart(7)}  out ${perMillion(e.pricing?.completion).padStart(7)}${free}`);
  }
  console.log("\nPut your choice in server/.env as OPENROUTER_INTENT_MODEL (and optional *_FALLBACK_MODELS), then run `npm run ai:check` again.");
}

function printModels(title, list) {
  console.log(`\n${title}`);
  if (!list.length) return console.log("  (none configured)");
  for (const r of list) {
    console.log(`  ${r.usable ? "OK  " : "FAIL"} ${r.id}${r.usable ? "" : `  -> ${r.problems.join(", ")}`}${r.found ? `  (context ${r.contextLength}, structured outputs: ${r.structuredOutputs ? "yes" : "no"}, tools: ${r.tools ? "yes" : "no"})` : ""}`);
  }
}

(async () => {
  try {
    if (process.argv.includes("--candidates")) return await candidates();

    const status = aiStatus(env.ai);
    console.log(`AI interpretation enabled : ${env.ai.enabled}`);
    console.log(`AI provider               : ${env.ai.provider}`);
    console.log(`OpenRouter API key set    : ${Boolean(o.apiKey) && o.apiKey !== "your_server_side_key"}`);
    console.log(`Intent interpretation     : ${status.usable ? "configured" : `not usable (${status.reason}${status.errors ? `: ${status.errors.join("; ")}` : ""})`}`);
    console.log(`Summary model             : ${summaryUsable(env.ai) ? "configured" : "not configured (rule-built answers are used)"}`);

    const report = await svc.check();
    if (!report.catalogReachable) {
      console.log("\nCould not read the OpenRouter model catalog (network?). Nothing was verified.");
      process.exitCode = 2;
      return;
    }
    printModels("Intent model + fallbacks (structured output required: " + o.requireStructuredOutput + ")", report.intent);
    printModels("Summary model + fallbacks", report.summary);

    const bad = [...report.intent, ...report.summary].filter((r) => !r.usable);
    if (!report.intent.length) console.log("\nNo OPENROUTER_INTENT_MODEL set: AI interpretation stays off and the rule engine handles everything. Run with --candidates to see options.");
    if (bad.length) {
      console.log("\nSome configured models do not meet the requirements. They will NOT be used and nothing falls back to a different model automatically.");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`ai:check failed: ${err.code || err.message}`);
    process.exitCode = 2;
  }
})();
