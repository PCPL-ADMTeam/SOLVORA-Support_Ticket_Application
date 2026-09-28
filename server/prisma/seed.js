// Idempotent seed script: safe to re-run. Creates the four system roles,
// a default admin account, sample teams/categories/priorities,
// a few extra users, and a handful of sample tickets to populate the
// dashboard on first run.
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { emailTemplateDefaults } = require("./emailTemplateDefaults");

const prisma = new PrismaClient();

async function upsertRole(name, label) {
  return prisma.role.upsert({ where: { name }, update: {}, create: { name, label } });
}

async function upsertUser({ name, email, password, roleId }) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { name, email, passwordHash, roleId },
  });
}

async function main() {
  console.log("Seeding database...");

  const [adminRole] = await Promise.all([
    upsertRole("ADMIN", "Administrator"),
    upsertRole("MANAGER", "Manager"),
    upsertRole("TEAMLEAD", "Team Lead"),
    upsertRole("EMPLOYEE", "Employee"),
  ]);

  const adminEmail = process.env.SEED_ADMIN_EMAIL || "helpdesk@powercen.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin@12345";
  const admin = await upsertUser({ name: "System Administrator", email: adminEmail, password: adminPassword, roleId: adminRole.id });


  const categoryDefs = [
    { name: "Hardware", children: ["Laptop", "Printer", "Peripherals"] },
    { name: "Software", children: ["Installation", "Licensing", "Bug Report"] },
    { name: "Network", children: ["VPN", "Wi-Fi", "Connectivity"] },
    { name: "Access Request", children: ["New Account", "Permission Change"] },
  ];

  const categories = [];
  for (const def of categoryDefs) {
    // Prisma's compound-unique `where` type rejects `null` for parentId
    // (a known limitation), so top-level categories can't use upsert()
    // directly — fall back to findFirst + create.
    let parent = await prisma.category.findFirst({ where: { name: def.name, parentId: null } });
    if (!parent) {
      parent = await prisma.category.create({ data: { name: def.name } });
    }
    categories.push(parent);
    for (const childName of def.children) {
      await prisma.category.upsert({
        where: { name_parentId: { name: childName, parentId: parent.id } },
        update: {},
        create: { name: childName, parentId: parent.id },
      });
    }
  }

  // Colors are the validated good/warning/serious/critical status steps
  // (see client/src/theme/theme.js STATUS_SCALE) — Low/Medium/High/Critical
  // map naturally onto that fixed, accessibility-checked severity scale.
  const priorityDefs = [
    { name: "Low", level: 1, color: "#0ca30c" },
    { name: "Medium", level: 2, color: "#fab219" },
    { name: "High", level: 3, color: "#ec835a" },
    { name: "Critical", level: 4, color: "#d03b3b" },
  ];

  const priorities = {};
  for (const def of priorityDefs) {
    const priority = await prisma.priority.upsert({
      where: { name: def.name },
      update: { level: def.level, color: def.color },
      create: { name: def.name, level: def.level, color: def.color },
    });
    priorities[def.name] = priority;
  }

  // Departments + their predefined issue lists, powering the ticket form's
  // To Department / Issue dropdowns. Every department gets a trailing
  // "Others" issue (isOther: true) for the custom-issue-text fallback.
  // Hardware covers both hardware AND software support (no separate
  // Software department); Cloud covers both Azure and AWS (no separate
  // Azure/AWS departments) — see server/README or the business rules this
  // taxonomy was defined against.
  const departmentDefs = [
    {
      name: "Hardware",
      issues: [
        "Laptop / Desktop Issue", "Hardware Failure", "Keyboard / Mouse Issue", "Monitor / Display Issue",
        "Printer Issue", "Peripherals Issue", "Software Installation", "Application Access",
        "System Performance", "Network Issue", "Internet Connectivity",
      ],
    },
    {
      name: "HR",
      issues: [
        "Leave Issue", "Attendance Issue", "Payroll Issue", "Employee Information Update",
        "Onboarding Issue", "Offboarding Issue", "Policy Clarification", "Document Request",
      ],
    },
    {
      name: "Administration",
      issues: ["Facility Issue", "Office Equipment", "Access Card", "Transport Issue", "Housekeeping Issue", "Maintenance Issue"],
    },
    {
      name: "BI/Copilot",
      issues: [
        "Power BI Access Request", "Power BI Report Issue", "Dashboard Data Issue", "Data Refresh Issue",
        "Copilot License Request", "Copilot Access Issue", "Copilot Output Issue",
      ],
    },
    {
      name: "M365",
      issues: [
        "Outlook / Email Issue", "Teams Issue", "OneDrive Issue", "SharePoint Issue",
        "Office License Issue", "Calendar / Scheduling Issue",
      ],
    },
    {
      name: "Security",
      issues: [
        "Password Reset", "Account Lockout", "Multi-Factor Authentication Issue", "VPN Issue",
        "Phishing / Suspicious Email", "Antivirus / Malware Alert", "Access / Permission Request",
      ],
    },
    {
      name: "Cloud",
      issues: [
        "Cloud VM / Instance Issue", "Cloud Storage Access", "Cloud Cost / Billing Query",
        "IAM / Access Issue", "Deployment Issue", "Cloud Backup Issue",
      ],
    },
    {
      name: "Sales",
      issues: ["CRM Issue", "Customer Data Issue", "Sales Application Access", "Report Issue", "Customer Support Issue"],
    },
    {
      name: "Operations",
      issues: [
        "Process Issue", "Vendor / Supplier Issue", "Inventory Issue", "Logistics Issue",
        "Compliance Issue", "Documentation Request",
      ],
    },
  ];

  // No separate management users are seeded here — a department's
  // Managers/Team Leads are granted via UserDepartmentAccess, which Admins
  // set up from the Users/Department Details pages after seeding.
  const departments = {};
  for (const def of departmentDefs) {
    const department = await prisma.department.upsert({
      where: { name: def.name },
      update: {},
      create: { name: def.name },
    });
    departments[def.name] = department;

    for (const issueName of def.issues) {
      await prisma.issue.upsert({
        where: { name_departmentId: { name: issueName, departmentId: department.id } },
        update: {},
        create: { name: issueName, departmentId: department.id },
      });
    }
    await prisma.issue.upsert({
      where: { name_departmentId: { name: "Others", departmentId: department.id } },
      update: {},
      create: { name: "Others", departmentId: department.id, isOther: true },
    });
  }



  // Default database-driven email templates — one per ticket lifecycle
  // event key that ticket.service.js/notification.service.js emit. This is
  // the single source of truth for email subject/body content (bodies are
  // HTML with a "View Ticket" button); see emailTemplateDefaults.js for the
  // actual content and emailTemplate.service.js for rendering. `update: {}`
  // is deliberate — re-running seed must never clobber an Admin's edits to
  // an already-existing template.
  for (const def of emailTemplateDefaults) {
    await prisma.emailTemplate.upsert({
      where: { eventKey: def.eventKey },
      update: {},
      create: def,
    });
  }

  console.log("Seed complete.");
  console.log(`  Admin login:           ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
