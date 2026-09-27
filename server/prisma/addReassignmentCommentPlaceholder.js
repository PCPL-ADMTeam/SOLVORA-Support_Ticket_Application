// One-time data upgrade: inserts the SAME {{assignmentCommentSection}}
// placeholder already used by TICKET_ASSIGNED into the LIVE TICKET_REASSIGNED
// EmailTemplate row's body (customized beyond the JS-file defaults, same as
// TICKET_ASSIGNED's row was — see addAssignmentCommentPlaceholder.js, which
// this mirrors exactly). Idempotent (skips if the placeholder is already
// present) and narrow: inserts one line at a known, stable anchor (right
// after the "Ticket Details" box closes, before the next paragraph) —
// every other byte of the existing custom template, including its existing
// Problem Summary row, is left untouched.
//
// Run once: node prisma/addReassignmentCommentPlaceholder.js
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const ANCHOR = "    </table>\n  </div>\n\n  <p";
const REPLACEMENT = "    </table>\n  </div>\n\n  {{assignmentCommentSection}}\n\n  <p";

async function main() {
  const existing = await prisma.emailTemplate.findUnique({ where: { eventKey: "TICKET_REASSIGNED" } });
  if (!existing) {
    console.log("[skip] TICKET_REASSIGNED: no row found");
    return;
  }
  if (existing.body.includes("{{assignmentCommentSection}}")) {
    console.log("[skip] TICKET_REASSIGNED: placeholder already present");
    return;
  }
  if (!existing.body.includes(ANCHOR)) {
    console.log("[skip] TICKET_REASSIGNED: expected anchor not found — template structure differs from what this script expects; insert {{assignmentCommentSection}} manually via the Email Templates admin UI instead.");
    return;
  }
  const updatedBody = existing.body.replace(ANCHOR, REPLACEMENT);
  await prisma.emailTemplate.update({ where: { eventKey: "TICKET_REASSIGNED" }, data: { body: updatedBody } });
  console.log("[updated] TICKET_REASSIGNED: {{assignmentCommentSection}} inserted");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
