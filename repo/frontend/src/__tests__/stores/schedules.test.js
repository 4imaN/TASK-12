import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useScheduleStore } from '../../stores/schedules.js';

vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

describe('schedule store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const store = useScheduleStore();
    expect(store.schedules).toEqual([]);
    expect(store.currentSchedule).toBeNull();
    expect(store.versions).toEqual([]);
    expect(store.currentVersion).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchSchedules populates the schedules list', async () => {
    const { api } = await import('../../utils/api.js');
    const mockSchedules = [
      { id: 1, route_name: 'Northeast Express' },
      { id: 2, route_name: 'Pacific Coast' }
    ];
    api.get.mockResolvedValueOnce({ data: mockSchedules });

    const store = useScheduleStore();
    await store.fetchSchedules();

    expect(api.get).toHaveBeenCalledWith('/schedules');
    expect(store.schedules).toEqual(mockSchedules);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchSchedule sets currentSchedule', async () => {
    const { api } = await import('../../utils/api.js');
    const mockSchedule = { id: 1, route_name: 'Northeast Express', station_name: 'Penn Station' };
    api.get.mockResolvedValueOnce({ data: mockSchedule });

    const store = useScheduleStore();
    const result = await store.fetchSchedule(1);

    expect(api.get).toHaveBeenCalledWith('/schedules/1');
    expect(store.currentSchedule).toEqual(mockSchedule);
    expect(result).toEqual(mockSchedule);
    expect(store.loading).toBe(false);
  });

  it('createSchedule returns new schedule data', async () => {
    const { api } = await import('../../utils/api.js');
    const newSchedule = { id: 3, route_name: 'Mountain Line' };
    api.post.mockResolvedValueOnce({ data: newSchedule });

    const store = useScheduleStore();
    const payload = { route_name: 'Mountain Line', station_id: 5 };
    const result = await store.createSchedule(payload);

    expect(api.post).toHaveBeenCalledWith('/schedules', payload);
    expect(result).toEqual(newSchedule);
  });

  it('fetchVersions populates versions list', async () => {
    const { api } = await import('../../utils/api.js');
    const mockVersions = [
      { id: 10, version_number: 1, status: 'published' },
      { id: 11, version_number: 2, status: 'draft' }
    ];
    api.get.mockResolvedValueOnce({ data: mockVersions });

    const store = useScheduleStore();
    await store.fetchVersions(1);

    expect(api.get).toHaveBeenCalledWith('/schedules/1/versions');
    expect(store.versions).toEqual(mockVersions);
  });

  it('fetchSchedules sets error on failure', async () => {
    const { api } = await import('../../utils/api.js');
    api.get.mockRejectedValueOnce(new Error('Network error'));

    const store = useScheduleStore();
    await store.fetchSchedules();

    expect(store.error).toBe('Network error');
    expect(store.schedules).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it('fetchSchedule sets error on failure', async () => {
    const { api } = await import('../../utils/api.js');
    api.get.mockRejectedValueOnce(new Error('Not found'));

    const store = useScheduleStore();
    await store.fetchSchedule(999);

    expect(store.error).toBe('Not found');
    expect(store.loading).toBe(false);
  });

  it('updateSchedule sends PATCH to /schedules/:id', async () => {
    const { api } = await import('../../utils/api.js');
    const updatedSchedule = { id: 1, route_name: 'Updated Route', station_id: 2 };
    api.patch.mockResolvedValueOnce({ data: updatedSchedule });

    const store = useScheduleStore();
    const result = await store.updateSchedule(1, { route_name: 'Updated Route', station_id: 2 });

    expect(api.patch).toHaveBeenCalledWith('/schedules/1', { route_name: 'Updated Route', station_id: 2 });
    expect(result).toEqual(updatedSchedule);
  });

  it('validateVersion returns validation result', async () => {
    const { api } = await import('../../utils/api.js');
    const validationResult = { valid: true, checks: [{ label: 'All good' }] };
    api.post.mockResolvedValueOnce({ data: validationResult });

    const store = useScheduleStore();
    const result = await store.validateVersion(1, 10);

    expect(api.post).toHaveBeenCalledWith('/schedules/1/versions/10/validate');
    expect(result).toEqual(validationResult);
    expect(store.validationResults).toEqual(validationResult);
  });
});
