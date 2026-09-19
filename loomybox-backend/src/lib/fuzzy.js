/**
 * Small dependency-free fuzzy matching helpers, used by GET /api/packages to
 * still surface results for a slightly misspelled search term (e.g.
 * "phtography" should still find "photography"). Not a replacement for a
 * real search engine at scale, but works fine without extra infra.
 */

function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Returns true if `query` plausibly matches `text` — either as a direct
 * substring, or if any word in `text` is within a small edit-distance of
 * any word in `query` (scaled to word length, so short words need an exact
 * or near-exact match while long words tolerate a couple of typos).
 */
function fuzzyIncludes(text, query) {
  if (!text || !query) return false;
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (t.includes(q)) return true;

  const queryWords = q.split(/\s+/).filter(Boolean);
  const textWords = t.split(/\s+/).filter(Boolean);

  return queryWords.some((qw) => {
    if (qw.length < 3) return false; // too short to fuzzy-match reliably
    const tolerance = qw.length <= 5 ? 1 : 2;
    return textWords.some((tw) => levenshtein(qw, tw) <= tolerance);
  });
}

module.exports = { levenshtein, fuzzyIncludes };
