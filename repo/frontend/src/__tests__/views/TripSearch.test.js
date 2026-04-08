import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { results: [] } }),
    post: vi.fn().mockResolvedValue({ data: {} })
  }
}));

vi.mock('../../utils/cache.js', () => ({
  getCachedSearch: vi.fn().mockResolvedValue(null),
  setCachedSearch: vi.fn().mockResolvedValue(undefined),
  normalizeSearchKey: vi.fn((p) => JSON.stringify(p)),
  clearExpiredSearches: vi.fn(),
  clearAllSearches: vi.fn()
}));

import TripSearch from '../../views/TripSearch.vue';
import { useSearchStore } from '../../stores/search.js';

function mountSearch() {
  return mount(TripSearch, {
    global: {
      plugins: [createPinia()],
      stubs: { StationAutocomplete: true, StatusBadge: true }
    }
  });
}

describe('TripSearch - Page Flow', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders hero with search form', async () => {
    const wrapper = mountSearch();
    expect(wrapper.find('.search-hero').exists()).toBe(true);
    expect(wrapper.text()).toContain('Find Your Train');
  });

  it('has origin and destination inputs', () => {
    const wrapper = mountSearch();
    // StationAutocomplete is stubbed, but the stubs should exist
    const stubs = wrapper.findAllComponents({ name: 'StationAutocomplete' });
    expect(stubs.length).toBe(2); // origin + destination
  });

  it('has date input with MM/DD/YYYY placeholder', () => {
    const wrapper = mountSearch();
    const dateInput = wrapper.find('input[placeholder="MM/DD/YYYY"]');
    expect(dateInput.exists()).toBe(true);
  });

  it('has seat class dropdown', () => {
    const wrapper = mountSearch();
    const select = wrapper.find('select');
    expect(select.exists()).toBe(true);
    expect(wrapper.text()).toContain('Economy');
    expect(wrapper.text()).toContain('Business');
    expect(wrapper.text()).toContain('First Class');
  });

  it('has sort chips for departure, duration, price', () => {
    const wrapper = mountSearch();
    expect(wrapper.text()).toContain('Departure');
    expect(wrapper.text()).toContain('Duration');
    expect(wrapper.text()).toContain('Price');
  });

  it('date input accepts text input', async () => {
    const wrapper = mountSearch();
    const dateInput = wrapper.find('input[placeholder="MM/DD/YYYY"]');
    await dateInput.setValue('04/10/2026');
    expect(dateInput.element.value).toBe('04/10/2026');
  });

  it('has swap stations button', () => {
    const wrapper = mountSearch();
    const swapBtn = wrapper.find('.swap-btn');
    expect(swapBtn.exists()).toBe(true);
  });

  it('renders trip results when available', async () => {
    const wrapper = mountSearch();
    const store = useSearchStore();
    store.results = [
      {
        versionId: 1, routeName: 'Express', trainsetCode: 'ACELA',
        origin: { stationName: 'NYC', departureAt: '2026-04-10T08:00:00Z' },
        destination: { stationName: 'WAS', arrivalAt: '2026-04-10T11:00:00Z' },
        durationMinutes: 180,
        seatClasses: [{ classCode: 'ECO', className: 'Economy', fare: 49, capacity: 200, isAvailable: true }]
      }
    ];
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.trip-card').exists()).toBe(true);
    expect(wrapper.text()).toContain('Economy');
    expect(wrapper.text()).toContain('$49');
  });

  it('search button exists and is clickable', () => {
    const wrapper = mountSearch();
    const searchBtn = wrapper.find('.search-btn');
    expect(searchBtn.exists()).toBe(true);
  });
});
