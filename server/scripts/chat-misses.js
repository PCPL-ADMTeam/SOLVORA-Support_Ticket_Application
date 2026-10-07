#!/usr/bin/env node
// Lists questions the assistant could not answer well, most frequent first, as ready-to-fill
// corpus entries for src/chatbot/__tests__/corpus/phrasings.json.
//
//   npm run chat:misses              last 30 days
//   npm run chat:misses -- --days 7
//
// Read-only. Text is redacted (emails / long numbers masked). Fill in "expect" with what the
// assistant SHOULD have understood, then add the entry to the corpus and make the test pass.

const { collectMisses } = require("../src/chatbot/misses");
const prisma = require("../src/config/prisma");

const i = process.argv.indexOf("--days");
const days = i > -1 ? Number(process.argv[i + 1]) || 30 : 30;

collectMisses({ days, limit: 50 })
  .then(({ misses }) => {
    if (!misses.length) return console.log(`No misses in the last ${days} days.`);
    console.log(JSON.stringify(misses.map((m) => ({ role: m.roles[0] || "ADMIN", text: m.text, seen: m.count, why: m.reasons.join(", "), expect: { intent: "FILL_ME_IN", params: {} } })), null, 2));
  })
  .catch((e) => {
    console.error(`chat:misses failed: ${e.code || e.name}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
