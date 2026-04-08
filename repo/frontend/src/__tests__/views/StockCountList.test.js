import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../utils/api.js', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn().mockResolvedValue({ data: { id: 1 } }), patch: vi.fn().mockResolvedValue({ data: {} }) }
}));

import StockCountList from '../../views/StockCountList.vue';
import { useInventoryStore } from '../../stores/inventory.js';

function mountCounts() {
  return mount(StockCountList, {
    global: { plugins: [createPinia()], stubs: { StatusBadge: true, AlertBanner: true } }
  });
}

describe('StockCountList', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders heading', async () => {
    const wrapper = mountCounts();
    await new Promise(r => setTimeout(r, 50));
    expect(wrapper.text()).toContain('Stock Counts');
  });

  it('has new count button', () => {
    const wrapper = mountCounts();
    expect(wrapper.findAll('button').some(b => b.text().includes('New Count'))).toBe(true);
  });

  it('shows stock count table', async () => {
    const wrapper = mountCounts();
    const store = useInventoryStore();
    store.stockCounts = [
      { id: 1, station_id: 1, station_name: 'NYC', status: 'open', counted_by_name: 'host1', started_at: '2026-04-01T10:00:00Z' }
    ];
    await wrapper.vm.$nextTick();
    expect(wrapper.find('table').exists()).toBe(true);
  });

  it('shows finalize button for open counts', async () => {
    const wrapper = mountCounts();
    const store = useInventoryStore();
    store.stockCounts = [
      { id: 1, station_id: 1, status: 'open', counted_by_name: 'host1', started_at: '2026-04-01T10:00:00Z' }
    ];
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('button').some(b => b.text().includes('Finalize'))).toBe(true);
  });

  it('shows empty state when no counts', async () => {
    const wrapper = mountCounts();
    const store = useInventoryStore();
    store.stockCounts = [];
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('No stock counts');
  });
});
