// In-memory stand-in for the Prisma client, used ONLY by tests. It implements
// just the query operators the chatbot (and ticket.service's scope functions)
// emit — AND/OR, equality, in, not, contains (case-insensitive), gte/lt — so
// the REAL authorization `where` clauses are evaluated, not mocked away.

let counter = 0;
const newId = () => `c${String(++counter).padStart(24, "0")}`;

const db = {};
function reset(seed = {}) {
  counter = 0;
  Object.assign(db, {
    tickets: [],
    priorities: [],
    departments: [],
    access: [],
    users: [],
    roles: [],
    pending: [],
    auditLogs: [],
    conversations: [],
    messages: [],
    feedback: [],
    audit: [],
    notifications: [],
    drafts: [],
    draftFiles: [],
    ...seed,
  });
}
reset();

const isDate = (v) => v instanceof Date;
const norm = (v) => (isDate(v) ? v.getTime() : v);

function matchField(value, cond) {
  if (cond === null) return value === null || value === undefined;
  if (cond && typeof cond === "object" && !isDate(cond)) {
    if ("in" in cond && !cond.in.includes(value)) return false;
    if ("not" in cond && (cond.not === null ? value === null || value === undefined : norm(value) === norm(cond.not))) return false;
    if ("equals" in cond) {
      const same = cond.mode === "insensitive" ? String(value ?? "").toLowerCase() === String(cond.equals).toLowerCase() : norm(value) === norm(cond.equals);
      if (!same) return false;
    }
    if ("contains" in cond && !String(value ?? "").toLowerCase().includes(String(cond.contains).toLowerCase())) return false;
    if ("startsWith" in cond && !String(value ?? "").startsWith(cond.startsWith)) return false;
    if ("gte" in cond && !(norm(value) >= norm(cond.gte))) return false;
    if ("lt" in cond && !(norm(value) < norm(cond.lt))) return false;
    if ("gt" in cond && !(norm(value) > norm(cond.gt))) return false;
    // Nested relation filter, e.g. { user: { isActive: true } }.
    const OPS = ["in", "not", "equals", "contains", "startsWith", "gte", "lt", "gt"];
    if (!OPS.some((k) => k in cond)) return value && typeof value === "object" ? matches(value, cond) : false;
    return true;
  }
  return norm(value) === norm(cond);
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return [].concat(cond).every((c) => matches(row, c));
    if (key === "OR") return cond.some((c) => matches(row, c));
    if (key === "NOT") return ![].concat(cond).some((c) => matches(row, c));
    // Prisma relation filter on the user -> department-access rows.
    if (key === "departmentAccess") return db.access.filter((a) => a.userId === row.id).some((a) => matches(a, cond.some));
    return matchField(row[key], cond);
  });
}

function orderRows(rows, orderBy) {
  if (!orderBy) return rows;
  const [[field, dir]] = Object.entries(orderBy);
  return [...rows].sort((a, b) => (norm(a[field]) > norm(b[field]) ? 1 : -1) * (dir === "desc" ? -1 : 1));
}

function project(row, select) {
  if (!select) return { ...row };
  const out = {};
  for (const [key, spec] of Object.entries(select)) {
    if (key === "_count") {
      out._count = Object.fromEntries(Object.keys(spec.select).map((k) => [k, row[`${k}Count`] ?? 0]));
    } else if (spec === true) {
      out[key] = row[key];
    } else {
      const rel = row[key];
      if (Array.isArray(rel)) {
        let rows = rel.filter((r) => matches(r, spec.where));
        rows = orderRows(rows, spec.orderBy);
        if (spec.take) rows = rows.slice(0, spec.take);
        out[key] = rows.map((r) => project(r, spec.select));
      } else {
        out[key] = rel ? project(rel, spec.select) : rel ?? null;
      }
    }
  }
  return out;
}

// A draft with its attachment METADATA (never the bytes), like the real `select`.
const withFiles = (d) => ({ ...d, attachments: db.draftFiles.filter((f) => f.draftId === d.id).map(({ id, fileName, mimeType, size, createdAt }) => ({ id, fileName, mimeType, size, createdAt })) });

const prisma = {
  // The dashboard's time-series charts use raw SQL; the regression tests compare its counts, not the charts.
  $queryRaw: async () => [],
  ticket: {
    findFirst: async ({ where, select }) => {
      const r = db.tickets.find((t) => matches(t, where));
      return r ? project(r, select) : null;
    },
    findUnique: async ({ where, select }) => {
      const r = db.tickets.find((t) => matches(t, where));
      return r ? project(r, select) : null;
    },
    findMany: async ({ where, select, orderBy, take, skip = 0 }) => {
      let rows = orderRows(db.tickets.filter((t) => matches(t, where)), orderBy);
      rows = rows.slice(skip);
      if (take) rows = rows.slice(0, take);
      return rows.map((r) => project(r, select));
    },
    count: async ({ where }) => db.tickets.filter((t) => matches(t, where)).length,
    groupBy: async ({ by, where }) => {
      const groups = new Map();
      for (const t of db.tickets.filter((x) => matches(x, where))) {
        const k = by.map((f) => t[f]).join("|");
        groups.set(k, { ...Object.fromEntries(by.map((f) => [f, t[f]])), _count: { _all: (groups.get(k)?._count._all || 0) + 1 } });
      }
      return [...groups.values()];
    },
  },
  priority: { findMany: async () => orderRowsByLevel(db.priorities), findUnique: async ({ where }) => db.priorities.find((p) => p.id === where.id) || null },
  department: {
    findUnique: async ({ where, select }) => {
      const d = db.departments.find((x) => x.id === where.id);
      return d ? project(d, select) : null;
    },
    findMany: async ({ where, select, orderBy } = {}) => orderRows(db.departments.filter((d) => matches(d, where)), orderBy).map((d) => project(d, select)) },
  userDepartmentAccess: {
    findMany: async ({ where }) => db.access.filter((a) => matches(a, where)).map((a) => ({ departmentId: a.departmentId })),
    findUnique: async ({ where }) => {
      const k = where.userId_departmentId;
      return db.access.find((a) => a.userId === k.userId && a.departmentId === k.departmentId) || null;
    },
    findFirst: async ({ where, include }) => {
      const a = db.access.find((x) => matches(x, where));
      if (!a) return null;
      return include?.department ? { ...a, department: { name: db.departments.find((d) => d.id === a.departmentId)?.name } } : { ...a };
    },
    count: async ({ where }) => db.access.map(withUser).filter((a) => matches(a, where)).length,
  },
  user: {
    findUnique: async ({ where, select }) => {
      const u = db.users.find((x) => (where.id ? x.id === where.id : String(x.email).toLowerCase() === String(where.email).toLowerCase()));
      return u ? project(u, select) : null;
    },
    findMany: async ({ where, select, take }) => {
      let rows = db.users.filter((u) => matches(u, where));
      if (take) rows = rows.slice(0, take);
      return rows.map((r) => project(r, select));
    },
    count: async ({ where } = {}) => db.users.filter((u) => matches(u, where)).length,
    groupBy: async ({ by, where }) => {
      const groups = new Map();
      for (const u of db.users.filter((x) => matches(x, where))) {
        const k = by.map((f) => u[f]).join("|");
        groups.set(k, { ...Object.fromEntries(by.map((f) => [f, u[f]])), _count: { _all: (groups.get(k)?._count._all || 0) + 1 } });
      }
      return [...groups.values()];
    },
  },
  role: { findMany: async () => db.roles.map((r) => ({ ...r })) },
  auditLog: { create: async ({ data }) => { db.auditLogs.push({ id: newId(), ...data }); } },
  chatPendingAction: {
    create: async ({ data }) => {
      const row = { id: newId(), status: "PENDING", resultMessage: null, createdAt: new Date(), resolvedAt: null, ...data };
      db.pending.push(row);
      return { ...row };
    },
    findUnique: async ({ where }) => {
      const r = db.pending.find((p) => p.id === where.id);
      return r ? { ...r } : null;
    },
    findFirst: async ({ where, orderBy }) => {
      const rows = orderRows(db.pending.filter((p) => matches(p, where)), orderBy);
      return rows[0] ? { ...rows[0] } : null;
    },
    updateMany: async ({ where, data }) => {
      const rows = db.pending.filter((p) => matches(p, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    update: async ({ where, data }) => Object.assign(db.pending.find((p) => p.id === where.id), data),
  },
  chatConversation: {
    create: async ({ data }) => {
      const row = { id: newId(), status: "ACTIVE", createdAt: new Date(), lastMessageAt: new Date(), ...data };
      db.conversations.push(row);
      return row;
    },
    findUnique: async ({ where }) => db.conversations.find((c) => c.id === where.id) || null,
    update: async ({ where, data }) => Object.assign(db.conversations.find((c) => c.id === where.id), data),
    findMany: async ({ where, orderBy, take }) => {
      let rows = orderRows(db.conversations.filter((c) => matches(c, where)), orderBy);
      if (take) rows = rows.slice(0, take);
      return rows;
    },
    delete: async ({ where }) => {
      const i = db.conversations.findIndex((c) => c.id === where.id);
      const [row] = db.conversations.splice(i, 1);
      db.messages = db.messages.filter((m) => m.conversationId !== where.id);
      return row;
    },
  },
  chatMessage: {
    create: async ({ data }) => {
      const row = { id: newId(), createdAt: new Date(Date.now() + counter), errorCode: null, intent: null, structuredPayload: null, ...data };
      db.messages.push(row);
      return row;
    },
    findMany: async ({ where, orderBy, take }) => {
      let rows = orderRows(db.messages.filter((m) => matches(m, where)), orderBy);
      if (take) rows = rows.slice(0, take);
      return rows;
    },
    findFirst: async ({ where, orderBy }) => {
      const rows = orderRows(db.messages.filter((m) => matches(m, where)), orderBy);
      return rows[0] || null;
    },
    findUnique: async ({ where }) => {
      const m = db.messages.find((x) => x.id === where.id);
      if (!m) return null;
      const conversation = db.conversations.find((c) => c.id === m.conversationId);
      return { ...m, conversation: { userId: conversation.userId } };
    },
  },
  chatTicketDraft: {
    create: async ({ data }) => {
      const row = { id: newId(), status: "ACTIVE", step: "TITLE", createdAt: new Date(), updatedAt: new Date(), ...data };
      db.drafts.push(row);
      return withFiles(row);
    },
    findFirst: async ({ where, orderBy } = {}) => {
      const rows = orderRows(db.drafts.filter((d) => matches(d, where)), orderBy);
      return rows[0] ? withFiles(rows[0]) : null;
    },
    findUnique: async ({ where }) => {
      const d = db.drafts.find((x) => x.id === where.id);
      return d ? withFiles(d) : null;
    },
    update: async ({ where, data }) => {
      const d = db.drafts.find((x) => x.id === where.id);
      Object.assign(d, data, { updatedAt: new Date() });
      return withFiles(d);
    },
    updateMany: async ({ where, data }) => {
      const rows = db.drafts.filter((d) => matches(d, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
  },
  chatDraftAttachment: {
    create: async ({ data }) => {
      const row = { id: newId(), createdAt: new Date(Date.now() + counter), ...data };
      db.draftFiles.push(row);
      return row;
    },
    findMany: async ({ where }) => db.draftFiles.filter((f) => matches(f, where)),
    delete: async ({ where }) => {
      const i = db.draftFiles.findIndex((f) => f.id === where.id);
      return db.draftFiles.splice(i, 1)[0];
    },
    deleteMany: async ({ where }) => {
      const keep = db.draftFiles.filter((f) => !matches(f, where));
      const count = db.draftFiles.length - keep.length;
      db.draftFiles = keep;
      return { count };
    },
  },
  notification: {
    findMany: async ({ where, orderBy, take } = {}) => {
      let rows = orderRows(db.notifications.filter((n) => matches(n, where)), orderBy);
      if (take) rows = rows.slice(0, take);
      return rows.map((n) => ({ ...n, ticket: n.ticketId ? (() => { const t = db.tickets.find((x) => x.id === n.ticketId); return t ? { id: t.id, ticketNumber: t.ticketNumber, title: t.title } : null; })() : null }));
    },
    count: async ({ where } = {}) => db.notifications.filter((n) => matches(n, where)).length,
    updateMany: async ({ where, data }) => {
      const rows = db.notifications.filter((n) => matches(n, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    deleteMany: async ({ where }) => {
      const keep = db.notifications.filter((n) => !matches(n, where));
      const count = db.notifications.length - keep.length;
      db.notifications = keep;
      return { count };
    },
  },
  chatFeedback: {
    findMany: async ({ where, orderBy, take } = {}) => {
      let rows = orderRows(db.feedback.filter((f) => matches(f, where)), orderBy);
      if (take) rows = rows.slice(0, take);
      return rows;
    },
    upsert: async ({ where, update, create }) => {
      const { messageId, userId } = where.messageId_userId;
      const existing = db.feedback.find((f) => f.messageId === messageId && f.userId === userId);
      if (existing) return Object.assign(existing, update);
      const row = { id: newId(), createdAt: new Date(), ...create };
      db.feedback.push(row);
      return row;
    },
  },
  chatAuditEvent: {
    create: async ({ data }) => {
      db.audit.push({ id: newId(), createdAt: new Date(), ...data });
    },
  },
};

const withUser = (a) => ({ ...a, user: db.users.find((u) => u.id === a.userId) });

function orderRowsByLevel(rows) {
  return [...rows].sort((a, b) => a.level - b.level);
}

module.exports = { ...prisma, __db: db, __reset: reset, __newId: newId };
