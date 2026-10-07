const common = require("./common/articles");
const employee = require("./employee/articles");
const teamLead = require("./team-lead/articles").articles;
const manager = require("./manager/articles");
const admin = require("./admin/articles");

// De-duplicate by id (manager re-uses the shared agent articles).
const BY_ID = new Map();
for (const a of [...common, ...employee, ...teamLead, ...manager, ...admin]) {
  if (!BY_ID.has(a.id)) BY_ID.set(a.id, a);
}
const ARTICLES = [...BY_ID.values()].filter((a) => a.active);

function visibleTo(a, roleName) {
  return a.roles.includes("ALL") || a.roles.includes(roleName);
}

function getArticle(id, roleName) {
  const a = BY_ID.get(id);
  return a && a.active && visibleTo(a, roleName) ? a : null;
}

// Keyword scoring over ONLY articles the caller's role may see — an Employee
// can never match (or be told the existence of) an admin article.
function searchArticles(query, roleName, limit = 3) {
  const q = String(query || "").toLowerCase();
  const scored = [];
  for (const a of ARTICLES) {
    if (!visibleTo(a, roleName)) continue;
    let score = 0;
    // Squared length: one specific phrase ("update my profile") outweighs
    // several generic words ("profile", "my profile").
    for (const k of a.keywords) if (q.includes(k.toLowerCase())) score += k.length ** 2;
    if (score) scored.push({ a, score });
  }
  return scored.sort((x, y) => y.score - x.score).slice(0, limit).map((s) => s.a);
}

// Same matching as searchArticles, but returns the score so callers can judge
// how reliable the match is.
function searchArticlesScored(query, roleName, limit = 3) {
  const q = String(query || "").toLowerCase();
  const scored = [];
  for (const a of ARTICLES) {
    if (!visibleTo(a, roleName)) continue;
    let score = 0;
    for (const k of a.keywords) if (q.includes(k.toLowerCase())) score += k.length ** 2;
    if (score) scored.push({ article: a, score });
  }
  return scored.sort((x, y) => y.score - x.score).slice(0, limit);
}

function articlesForRole(roleName) {
  return ARTICLES.filter((a) => visibleTo(a, roleName));
}

module.exports = { getArticle, searchArticles, searchArticlesScored, articlesForRole, ARTICLES };
