const { apiGet } = require('./setup');

describe('Trip Search API', () => {
  test('GET /api/trips/search with origin+destination returns results', async () => {
    const res = await apiGet('/api/trips/search?origin=New+York&destination=Washington');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.data.results)).toBe(true);
    expect(res.data.data.results.length).toBeGreaterThan(0);
  });

  test('search results have correct structure', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS');
    const trip = res.data.data.results[0];
    expect(trip.routeName).toBeDefined();
    expect(trip.origin.stationName).toBeDefined();
    expect(trip.origin.departureAt).toBeDefined();
    expect(trip.destination.stationName).toBeDefined();
    expect(trip.seatClasses).toBeDefined();
    expect(trip.durationMinutes).toBeDefined();
  });

  test('search by station code works', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS');
    expect(res.status).toBe(200);
    expect(res.data.data.results.length).toBeGreaterThan(0);
  });

  test('search with fuzzy station name works', async () => {
    const res = await apiGet('/api/trips/search?origin=new+york&destination=washington');
    expect(res.status).toBe(200);
    expect(res.data.data.results.length).toBeGreaterThan(0);
  });

  test('sort by price changes order', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&sort=price');
    expect(res.status).toBe(200);
    const results = res.data.data.results;
    if (results.length >= 2) {
      const price0 = Math.min(...results[0].seatClasses.map(s => s.fare));
      const price1 = Math.min(...results[1].seatClasses.map(s => s.fare));
      expect(price0).toBeLessThanOrEqual(price1);
    }
  });

  test('sort by departure returns chronological order', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&sort=departure');
    const results = res.data.data.results;
    if (results.length >= 2) {
      const t0 = new Date(results[0].origin.departureAt).getTime();
      const t1 = new Date(results[1].origin.departureAt).getTime();
      expect(t0).toBeLessThanOrEqual(t1);
    }
  });

  test('search with no matches returns empty results', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&date=01/01/2099');
    expect(res.status).toBe(200);
    expect(res.data.data.results).toHaveLength(0);
  });

  test('search with missing origin returns 400', async () => {
    const res = await apiGet('/api/trips/search?destination=WAS');
    expect(res.status).toBe(400);
  });

  test('search with missing destination returns 400', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC');
    expect(res.status).toBe(400);
  });

  test('search with invalid date format returns 400', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&date=2026-04-10');
    expect(res.status).toBe(400);
  });

  test('search with valid date format works', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&date=04/10/2026');
    expect(res.status).toBe(200);
  });

  test('search with seatClass filter works', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&seatClass=economy');
    expect(res.status).toBe(200);
  });

  test('GET /api/trips/hot-searches returns array', async () => {
    const res = await apiGet('/api/trips/hot-searches');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.data.results || res.data.data)).toBe(true);
  });

  test('hot-searches have origin and destination fields', async () => {
    const res = await apiGet('/api/trips/hot-searches');
    const items = res.data.data.results || res.data.data;
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(item.origin).toBeDefined();
      expect(item.destination).toBeDefined();
    }
  });

  // Date boundary tests
  test('date boundary — invalid month rejected', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&date=13/01/2026');
    expect(res.status).toBe(400);
  });

  test('date boundary — invalid day rejected', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&date=04/32/2026');
    expect(res.status).toBe(400);
  });

  test('date with valid MM/DD/YYYY returns consistent results regardless of timezone', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&date=04/10/2026');
    expect(res.status).toBe(200);
    // All results should have departure on the requested date
    for (const trip of res.data.data.results) {
      if (trip.origin?.departureAt) {
        expect(trip.origin.departureAt).toContain('2026-04-10');
      }
    }
  });

  test('first class filter matches correctly', async () => {
    const res = await apiGet('/api/trips/search?origin=NYC&destination=WAS&seatClass=first');
    expect(res.status).toBe(200);
    // Results should only contain trips with first class
    for (const trip of res.data.data.results) {
      const hasFirst = trip.seatClasses.some(sc =>
        sc.className.toLowerCase().startsWith('first') || sc.classCode.toLowerCase() === 'first'
      );
      expect(hasFirst).toBe(true);
    }
  });
});
