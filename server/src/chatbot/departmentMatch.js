// Finds which department(s) a free-text question refers to, tolerating small
// typos ("BI/copiot" -> "BI/Copilot"). Pure function: it only compares the
// user's own message against the department names passed in.

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Allowed typos grow with name length; very short names (HR, IT) must match exactly.
const tolerance = (len) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

function matchDepartments(message, names) {
  const words = String(message).toLowerCase().split(/\s+/).map(norm).filter(Boolean);
  // Every run of 1-3 consecutive words, joined ("bi copilot" -> "bicopilot").
  const grams = new Set();
  for (let i = 0; i < words.length; i += 1) {
    let g = "";
    for (let n = 0; n < 3 && i + n < words.length; n += 1) {
      g += words[i + n];
      grams.add(g);
    }
  }
  return names.filter((name) => {
    const target = norm(name);
    if (!target) return false;
    for (const g of grams) {
      if (g === target) return true;
      if (Math.abs(g.length - target.length) <= 2 && target.length > 3 && editDistance(g, target) <= tolerance(target.length)) return true;
    }
    return false;
  });
}

module.exports = { matchDepartments };
