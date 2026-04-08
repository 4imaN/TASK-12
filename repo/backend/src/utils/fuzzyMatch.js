/**
 * Fuzzy matching utility for station search.
 * Three-tier: exact -> prefix -> Levenshtein (distance <= 2).
 */

/**
 * Normalize input: lowercase, trim, remove accents/diacritics, collapse whitespace.
 */
function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Search stations with fuzzy matching. Returns results sorted by match quality.
 *
 * @param {string} query - User search input
 * @param {Array} stations - Array of { id, code, name, normalized_name, aliases: [{ alias, normalized_alias }] }
 * @returns {Array} - Matched stations sorted by relevance, each with a `matchScore` (lower is better)
 */
function fuzzyMatchStations(query, stations) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const results = [];

  for (const station of stations) {
    let bestScore = Infinity;
    const normName = station.name_normalized || station.normalized_name || normalize(station.name);
    const normCode = normalize(station.code);

    // Check canonical name
    const nameScore = scoreMatch(normalizedQuery, normName);
    if (nameScore < bestScore) bestScore = nameScore;

    // Check code
    const codeScore = scoreMatch(normalizedQuery, normCode);
    if (codeScore < bestScore) bestScore = codeScore;

    // Check aliases
    if (station.aliases && Array.isArray(station.aliases)) {
      for (const alias of station.aliases) {
        const normAlias = alias.alias_normalized || alias.normalized_alias || normalize(alias.alias);
        const aliasScore = scoreMatch(normalizedQuery, normAlias);
        if (aliasScore < bestScore) bestScore = aliasScore;
      }
    }

    if (bestScore <= 20) {
      results.push({ ...station, matchScore: bestScore });
    }
  }

  results.sort((a, b) => a.matchScore - b.matchScore);
  return results;
}

/**
 * Score a query against a target string.
 * Returns: 0 = exact, 1 = prefix, 2..20 = Levenshtein-based, Infinity = no match.
 */
function scoreMatch(query, target) {
  if (!target) return Infinity;

  // Exact match
  if (query === target) return 0;

  // Prefix match
  if (target.startsWith(query)) return 1;

  // Levenshtein distance
  const dist = levenshtein(query, target);
  if (dist <= 2) return 2 + dist;

  // Also check if the query is a prefix after Levenshtein on the trimmed target
  if (target.length > query.length) {
    const truncated = target.substring(0, query.length);
    const truncDist = levenshtein(query, truncated);
    if (truncDist <= 1) return 5 + truncDist;
  }

  return Infinity;
}

module.exports = { normalize, levenshtein, levenshteinDistance: levenshtein, fuzzyMatchStations, findMatchingStations: fuzzyMatchStations, scoreMatch };
