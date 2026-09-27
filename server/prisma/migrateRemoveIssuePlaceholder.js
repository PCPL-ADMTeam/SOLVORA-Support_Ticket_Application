// One-time data upgrade: swaps the old "{{issue}}"-placeholder row for a
// "Problem Summary" ({{problemSummary}}) row in every ticket-lifecycle
// EmailTemplate body that still has its original seeded content — mirrors
// migrateEmailTemplatesToHtml.js's own "never touch an Admin-customized row"
// safety rule. Never touches eventKey/isActive/subject (subjects are now
// generated centrally regardless of what's stored — see
// emailTemplate.service.js#buildTicketEmailSubject) — only `body`, and only
// when it still exactly matches the known pre-upgrade HTML default.
//
// Run once: node prisma/migrateRemoveIssuePlaceholder.js
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { emailTemplateDefaults } = require("./emailTemplateDefaults");

const prisma = new PrismaClient();

const BUTTON =
  '<a href="{{ticketLink}}" style="display:inline-block;padding:12px 20px;background:#b43d35;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-family:Arial,Helvetica,sans-serif;font-size:14px;">View Ticket</a>';

function row(label, value) {
  return `<tr><td style="padding:4px 16px 4px 0;color:#666;font-size:13px;">${label}</td><td style="padding:4px 0;font-weight:600;font-size:13px;">${value}</td></tr>`;
}

function wrap(intro, rowsHtml, extraHtml = "") {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#1a1a1a;">
  <p style="margin:0 0 12px;">Hello {{recipientName}},</p>
  <p style="margin:0 0 16px;color:#444;">${intro}</p>
  <table style="border-collapse:collapse;margin-bottom:16px;">${rowsHtml}</table>
  ${extraHtml}<p style="margin:20px 0;">${BUTTON}</p>
  <p style="color:#888;font-size:12px;margin-top:24px;">Regards,<br>Support Team</p>
</div>`;
}

// The exact pre-upgrade bodies (still using the {{issue}} placeholder) for
// every event this upgrade touches — used ONLY to detect "still the
// original seed, safe to upgrade" vs. "an Admin already edited this."
const legacyIssueBodies = {
  TICKET_CREATED: wrap(
    "A new support ticket has been raised for the {{department}} department and needs your review and assignment.",
    row("Ticket", "{{ticketNumber}}") + row("Title", "{{title}}") + row("Department", "{{department}}") + row("Issue", "{{issue}}") + row("Priority", "{{priority}}") + row("Status", "{{status}}") + row("Requester", "{{requesterName}}"),
  ),
  TICKET_ASSIGNED: wrap(
    "Ticket {{ticketNumber}} has been assigned to {{assigneeName}}.",
    row("Ticket", "{{ticketNumber}}") + row("Title", "{{title}}") + row("Department", "{{department}}") + row("Issue", "{{issue}}") + row("Priority", "{{priority}}") + row("Status", "{{status}}") + row("Manager", "{{managerName}}"),
  ),
  TICKET_SELF_ASSIGNED: wrap(
    "Your support ticket has been assigned to {{assigneeName}}, who will be handling the ticket.",
    row("Ticket", "{{ticketNumber}}") + row("Title", "{{title}}") + row("Department", "{{department}}") + row("Issue", "{{issue}}") + row("Priority", "{{priority}}") + row("Status", "{{status}}") + row("Assignee", "{{assigneeName}}"),
  ),
  TICKET_REASSIGNED: wrap(
    "Ticket {{ticketNumber}} has been reassigned to {{assigneeName}}.",
    row("Ticket", "{{ticketNumber}}") + row("Title", "{{title}}") + row("Department", "{{department}}") + row("Issue", "{{issue}}") + row("Priority", "{{priority}}") + row("Status", "{{status}}") + row("Manager", "{{managerName}}"),
  ),
  TICKET_UPDATED: wrap(
    "The requester has updated the details of a ticket you're handling.",
    row("Ticket", "{{ticketNumber}}") + row("Title", "{{title}}") + row("Department", "{{department}}") + row("Issue", "{{issue}}") + row("Priority", "{{priority}}") + row("Status", "{{status}}") + row("Updated by", "{{requesterName}}"),
  ),
  TICKET_DEPARTMENT_TRANSFERRED: wrap(
    "This ticket has been transferred to your department and needs review.",
    row("Ticket", "{{ticketNumber}}") + row("Title", "{{title}}") + row("Old Department", "{{oldDepartment}}") + row("New Department", "{{department}}") + row("Issue", "{{issue}}") + row("Priority", "{{priority}}") + row("Status", "{{status}}") + row("Requester", "{{requesterName}}") + row("Manager", "{{managerName}}") + row("Transfer Reason", "{{transferReason}}"),
  ),
};

async function main() {
  for (const eventKey of Object.keys(legacyIssueBodies)) {
    const existing = await prisma.emailTemplate.findUnique({ where: { eventKey } });
    if (!existing) {
      console.log(`[skip] ${eventKey}: no row found`);
      continue;
    }
    if (existing.body !== legacyIssueBodies[eventKey]) {
      console.log(`[skip] ${eventKey}: body doesn't match the pre-upgrade default — looks Admin-customized, leaving it untouched`);
      continue;
    }
    const def = emailTemplateDefaults.find((d) => d.eventKey === eventKey);
    await prisma.emailTemplate.update({ where: { eventKey }, data: { body: def.body } });
    console.log(`[updated] ${eventKey}: Issue row replaced with Problem Summary`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
