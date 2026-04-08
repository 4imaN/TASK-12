/**
 * Schedule version diff unit tests.
 *
 * Tests computeStopDiff and computeClassDiff, with particular focus on
 * repeated-station routes (loop routes where the same station_id appears
 * at multiple stop_sequences).
 */

// Mock database so requiring the schedules module doesn't crash
jest.mock('../backend/src/database/connection', () => {
  const mockDb = jest.fn(() => ({ where: jest.fn().mockReturnThis(), first: jest.fn() }));
  mockDb.raw = jest.fn();
  return mockDb;
});
jest.mock('../backend/src/middleware/auth', () => ({
  authenticate: () => (ctx, next) => next(),
  requireRole: () => (ctx, next) => next()
}));
jest.mock('../backend/src/middleware/errorHandler', () => ({
  createError: (status, code, msg) => { const e = new Error(msg); e.status = status; e.code = code; return e; }
}));
jest.mock('../backend/src/services/auditService', () => ({
  logAudit: jest.fn(),
  auditFromCtx: () => ({ actorId: 1, actorUsername: 'test', ip: '127.0.0.1' })
}));
jest.mock('../backend/src/utils/validators', () => ({
  validateScheduleForPublish: jest.fn()
}));
jest.mock('../backend/src/utils/fuzzyMatch', () => ({
  normalize: jest.fn(s => s),
  findMatchingStations: jest.fn(() => [])
}));

const { _computeStopDiff: computeStopDiff, _computeClassDiff: computeClassDiff } = require('../backend/src/routes/schedules');

describe('computeStopDiff', () => {
  test('detects added stop', () => {
    const v1 = [{ stop_sequence: 1, station_id: 10, departure_at: '08:00', arrival_at: null, platform: '1A' }];
    const v2 = [
      { stop_sequence: 1, station_id: 10, departure_at: '08:00', arrival_at: null, platform: '1A' },
      { stop_sequence: 2, station_id: 20, departure_at: '09:00', arrival_at: '08:55', platform: '2B' }
    ];
    const diff = computeStopDiff(v1, v2);
    expect(diff).toHaveLength(1);
    expect(diff[0].change).toBe('added');
    expect(diff[0].v2.station).toBe(20);
    expect(diff[0].v2.sequence).toBe(2);
  });

  test('detects removed stop', () => {
    const v1 = [
      { stop_sequence: 1, station_id: 10, departure_at: '08:00', arrival_at: null, platform: '1A' },
      { stop_sequence: 2, station_id: 20, departure_at: '09:00', arrival_at: '08:55', platform: null }
    ];
    const v2 = [{ stop_sequence: 1, station_id: 10, departure_at: '08:00', arrival_at: null, platform: '1A' }];
    const diff = computeStopDiff(v1, v2);
    expect(diff).toHaveLength(1);
    expect(diff[0].change).toBe('removed');
    expect(diff[0].v1.station).toBe(20);
  });

  test('detects changed stop (time change)', () => {
    const v1 = [{ stop_sequence: 1, station_id: 10, departure_at: '08:00', arrival_at: null, platform: '1A' }];
    const v2 = [{ stop_sequence: 1, station_id: 10, departure_at: '08:30', arrival_at: null, platform: '1A' }];
    const diff = computeStopDiff(v1, v2);
    expect(diff).toHaveLength(1);
    expect(diff[0].change).toBe('changed');
    expect(diff[0].v1.departure_at).toBe('08:00');
    expect(diff[0].v2.departure_at).toBe('08:30');
  });

  test('detects changed stop (station swap at same sequence)', () => {
    const v1 = [{ stop_sequence: 2, station_id: 10, departure_at: '09:00', arrival_at: '08:55', platform: null }];
    const v2 = [{ stop_sequence: 2, station_id: 30, departure_at: '09:00', arrival_at: '08:55', platform: null }];
    const diff = computeStopDiff(v1, v2);
    expect(diff).toHaveLength(1);
    expect(diff[0].change).toBe('changed');
    expect(diff[0].v1.station).toBe(10);
    expect(diff[0].v2.station).toBe(30);
  });

  test('no diff for identical stops', () => {
    const stops = [
      { stop_sequence: 1, station_id: 10, departure_at: '08:00', arrival_at: null, platform: '1A' },
      { stop_sequence: 2, station_id: 20, departure_at: '09:00', arrival_at: '08:55', platform: null }
    ];
    const diff = computeStopDiff(stops, stops);
    expect(diff).toHaveLength(0);
  });

  test('correctly handles repeated-station loop route (same station_id at multiple sequences)', () => {
    // Route: A(1) → B(2) → C(3) → A(4) — station A appears at sequence 1 and 4
    const v1 = [
      { stop_sequence: 1, station_id: 100, departure_at: '08:00', arrival_at: null, platform: '1' },
      { stop_sequence: 2, station_id: 200, departure_at: '09:00', arrival_at: '08:50', platform: '2' },
      { stop_sequence: 3, station_id: 300, departure_at: '10:00', arrival_at: '09:50', platform: '3' },
      { stop_sequence: 4, station_id: 100, departure_at: null, arrival_at: '10:50', platform: '1' }
    ];
    // v2 changes platform for the RETURN stop at sequence 4 only
    const v2 = [
      { stop_sequence: 1, station_id: 100, departure_at: '08:00', arrival_at: null, platform: '1' },
      { stop_sequence: 2, station_id: 200, departure_at: '09:00', arrival_at: '08:50', platform: '2' },
      { stop_sequence: 3, station_id: 300, departure_at: '10:00', arrival_at: '09:50', platform: '3' },
      { stop_sequence: 4, station_id: 100, departure_at: null, arrival_at: '10:50', platform: '4' }
    ];
    const diff = computeStopDiff(v1, v2);
    // Must detect exactly 1 change — at sequence 4, NOT conflate with sequence 1
    expect(diff).toHaveLength(1);
    expect(diff[0].change).toBe('changed');
    expect(diff[0].v1.sequence).toBe(4);
    expect(diff[0].v1.platform).toBe('1');
    expect(diff[0].v2.platform).toBe('4');
    expect(diff[0].key).toBe('stop-seq-4');
  });

  test('preserves all occurrences of repeated station in diff output', () => {
    // v1: A→B→A  /  v2: A→C→A (middle stop changed from station B to C)
    const v1 = [
      { stop_sequence: 1, station_id: 100, departure_at: '08:00', arrival_at: null, platform: '1' },
      { stop_sequence: 2, station_id: 200, departure_at: '09:00', arrival_at: '08:50', platform: '2' },
      { stop_sequence: 3, station_id: 100, departure_at: null, arrival_at: '09:50', platform: '1' }
    ];
    const v2 = [
      { stop_sequence: 1, station_id: 100, departure_at: '08:00', arrival_at: null, platform: '1' },
      { stop_sequence: 2, station_id: 300, departure_at: '09:00', arrival_at: '08:50', platform: '2' },
      { stop_sequence: 3, station_id: 100, departure_at: null, arrival_at: '09:50', platform: '1' }
    ];
    const diff = computeStopDiff(v1, v2);
    // Only sequence 2 changed (station swap 200→300)
    expect(diff).toHaveLength(1);
    expect(diff[0].change).toBe('changed');
    expect(diff[0].v1.station).toBe(200);
    expect(diff[0].v2.station).toBe(300);
    expect(diff[0].v2.sequence).toBe(2);
  });
});

describe('computeClassDiff', () => {
  test('detects added class', () => {
    const v1 = [{ class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 50, is_available: true }];
    const v2 = [
      { class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 50, is_available: true },
      { class_code: 'BIZ', class_name: 'Business', capacity: 30, fare: 150, is_available: true }
    ];
    const diff = computeClassDiff(v1, v2);
    expect(diff).toHaveLength(1);
    expect(diff[0].change).toBe('added');
    expect(diff[0].v2.class_code).toBe('BIZ');
  });

  test('detects changed class (fare change)', () => {
    const v1 = [{ class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 50, is_available: true }];
    const v2 = [{ class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 75, is_available: true }];
    const diff = computeClassDiff(v1, v2);
    expect(diff).toHaveLength(1);
    expect(diff[0].change).toBe('changed');
    expect(diff[0].v1.fare).toBe(50);
    expect(diff[0].v2.fare).toBe(75);
  });

  test('no diff for identical classes', () => {
    const classes = [{ class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: '50.00', is_available: true }];
    const diff = computeClassDiff(classes, classes);
    expect(diff).toHaveLength(0);
  });
});
