// One-time data upgrade: inserts the new {{assignmentCommentSection}}
// placeholder into the LIVE TICKET_ASSIGNED EmailTemplate row's body — this
// template was customized by an Admin beyond the JS-file defaults (see
// emailTemplateDefaults.js's own doc comment), so simply reseeding wouldn't
// reach it. Idempotent (skips if the placeholder is already present) and
// narrow: it only inserts one line at a known, stable anchor (right after
// the "Ticket Details" box closes, before the next paragraph) — every other
// byte of the existing custom template is left untouched.
//
// Run once: node prisma/addAssignmentCommentPlaceholder.js
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const ANCHOR = "    </table>\n  </div>\n\n  <p";
const REPLACEMENT = "    </table>\n  </div>\n\n  {{assignmentCommentSection}}\n\n  <p";

async function main() {
  const existing = await prisma.emailTemplate.findUnique({ where: { eventKey: "TICKET_ASSIGNED" } });
  if (!existing) {
    console.log("[skip] TICKET_ASSIGNED: no row found");
    return;
  }
  if (existing.body.includes("{{assignmentCommentSection}}")) {
    console.log("[skip] TICKET_ASSIGNED: placeholder already present");
    return;
  }
  if (!existing.body.includes(ANCHOR)) {
    console.log("[skip] TICKET_ASSIGNED: expected anchor not found — template structure differs from what this script expects; insert {{assignmentCommentSection}} manually via the Email Templates admin UI instead.");
    return;
  }
  const updatedBody = existing.body.replace(ANCHOR, REPLACEMENT);
  await prisma.emailTemplate.update({ where: { eventKey: "TICKET_ASSIGNED" }, data: { body: updatedBody } });
  console.log("[updated] TICKET_ASSIGNED: {{assignmentCommentSection}} inserted");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
