const { normalize, levenshteinDistance, findMatchingStations } = require('../backend/src/utils/fuzzyMatch');

describe('normalize', () => {
  test('lowercases input', () => {
    expect(normalize('NEW YORK')).toBe('new york');
  });

  test('trims whitespace', () => {
    expect(normalize('  boston  ')).toBe('boston');
  });

  test('removes accents', () => {
    expect(normalize('Montréal')).toBe('montreal');
  });

  test('collapses multiple spaces', () => {
    expect(normalize('new   york   penn')).toBe('new york penn');
  });

  test('handles empty string', () => {
    expect(normalize('')).toBe('');
  });

  test('handles null/undefined', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('levenshteinDistance', () => {
  test('identical strings return 0', () => {
    expect(levenshteinDistance('boston', 'boston')).toBe(0);
  });

  test('single character difference returns 1', () => {
    expect(levenshteinDistance('boston', 'bostom')).toBe(1);
  });

  test('transposition returns 2', () => {
    expect(levenshteinDistance('boston', 'bosotn')).toBe(2);
  });

  test('completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });

  test('empty vs non-empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });
});

describe('findMatchingStations', () => {
  const stations = [
    { id: 1, code: 'NYC', name: 'New York Penn', name_normalized: 'new york penn', aliases: [{ alias_normalized: 'ny penn' }, { alias_normalized: 'penn station' }] },
    { id: 2, code: 'BOS', name: 'Boston South', name_normalized: 'boston south', aliases: [{ alias_normalized: 'bos' }, { alias_normalized: 'south station' }] },
    { id: 3, code: 'WAS', name: 'Washington Union', name_normalized: 'washington union', aliases: [{ alias_normalized: 'dc' }, { alias_normalized: 'union station dc' }] },
    { id: 4, code: 'CHI', name: 'Chicago Union', name_normalized: 'chicago union', aliases: [{ alias_normalized: 'chi town' }] },
    { id: 5, code: 'PHL', name: 'Philadelphia 30th Street', name_normalized: 'philadelphia 30th street', aliases: [{ alias_normalized: 'philly' }] }
  ];

  test('exact match on code', () => {
    const results = findMatchingStations('NYC', stations);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(1);
  });

  test('exact match on normalized name', () => {
    const results = findMatchingStations('Boston South', stations);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(2);
  });

  test('prefix match', () => {
    const results = findMatchingStations('new york', stations);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(1);
  });

  test('alias match', () => {
    const results = findMatchingStations('philly', stations);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(5);
  });

  test('alias match on dc', () => {
    const results = findMatchingStations('dc', stations);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(3);
  });

  test('fuzzy match with typo (levenshtein <= 2)', () => {
    // 'bos' is Levenshtein distance 0 from alias 'bos' for Boston
    const results = findMatchingStations('bso', stations);
    // 'bso' is Levenshtein distance 1 from 'bos' (alias)
    expect(results.length).toBeGreaterThan(0);
  });

  test('no match returns empty array', () => {
    const results = findMatchingStations('zzzzzzzzz', stations);
    expect(results).toEqual([]);
  });

  test('empty query returns empty', () => {
    const results = findMatchingStations('', stations);
    expect(results).toEqual([]);
  });
});
