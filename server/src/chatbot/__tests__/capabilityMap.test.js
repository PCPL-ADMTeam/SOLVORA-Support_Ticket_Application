jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// The natural-language variation matrix. Every phrase in capabilityMap.js must resolve to the
// stated intent and filters for EVERY role allowed to use that capability. It also writes
// docs/chatbot-capability-map.md so the map and the documentation cannot drift apart.

const fs = require("fs");
const path = require("path");
const { classify } = require("../intents/router");
const { CAPABILITIES } = require("../capabilityMap");

const rows = [];
for (const cap of CAPABILITIES) for (const ph of cap.phrases) for (const role of cap.roles) rows.push([`${cap.id} / ${role}: ${ph.say}`, cap, ph, role]);

describe("capability map: every phrasing resolves to its intent for every allowed role", () => {
  test("each capability has at least 3 phrasings, and the major ones at least 5", () => {
    for (const cap of CAPABILITIES) expect(cap.phrases.length).toBeGreaterThanOrEqual(3);
    const major = ["DASHBOARD_SUMMARY", "DASHBOARD_COUNT", "RAISED_TICKETS", "ASSIGNED_TICKETS", "TICKET_SEARCH", "TICKET_DETAILS", "TICKET_HISTORY", "TICKET_COMMENTS", "TICKET_ATTACHMENTS", "NOTIFICATION_LIST", "NOTIFICATION_UNREAD"];
    for (const id of major) expect(CAPABILITIES.find((c) => c.id === id).phrases.length).toBeGreaterThanOrEqual(5);
  });

  test.each(rows)("%s", (_name, _cap, ph, role) => {
    const r = classify(ph.say, role);
    expect(r.intent).toBe(ph.intent);
    if (ph.params) expect(r.params).toMatchObject(ph.params);
  });

  afterAll(() => {
    const lines = [
      "# Chatbot capability map",
      "",
      "Generated from `server/src/chatbot/capabilityMap.js` by `capabilityMap.test.js`. Every phrase listed here is tested for every allowed role.",
      "",
    ];
    for (const cap of CAPABILITIES) {
      lines.push(`## ${cap.id}`, "", cap.description, "", `- Roles: ${cap.roles.join(", ")}`, `- Source: ${cap.service}`, `- Details read from the message: ${cap.entities.join(", ") || "none"}`, `- Asks when unclear: ${cap.clarifies}`, "- Example phrasings:");
      for (const ph of cap.phrases) lines.push(`  - \`${ph.say}\` -> \`${ph.intent}\``);
      lines.push("");
    }
    try {
      fs.writeFileSync(path.resolve(__dirname, "../../../../docs/chatbot-capability-map.md"), `${lines.join("\n")}\n`);
    } catch {
      // Documentation output only.
    }
  });
});
