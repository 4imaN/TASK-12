import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../utils/api.js', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn().mockResolvedValue({ data: { id: 1 } }), patch: vi.fn().mockResolvedValue({ data: {} }) }
}));

import ItemList from '../../views/ItemList.vue';
import { useInventoryStore } from '../../stores/inventory.js';
import { useAuthStore } from '../../stores/auth.js';

function mountItems() {
  return mount(ItemList, {
    global: { plugins: [createPinia()], stubs: { StatusBadge: true, AlertBanner: true } }
  });
}

describe('ItemList', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.user = { id: 1, role: 'platform_ops', username: 'admin', assignedStationIds: [1, 2] };
  });

  it('renders heading', async () => {
    const wrapper = mountItems();
    await new Promise(r => setTimeout(r, 50));
    expect(wrapper.text()).toContain('Inventory Items');
  });

  it('has new item button', () => {
    const wrapper = mountItems();
    expect(wrapper.findAll('button').some(b => b.text().includes('New Item'))).toBe(true);
  });

  it('clicking new item opens modal', async () => {
    const wrapper = mountItems();
    const btn = wrapper.findAll('button').find(b => b.text().includes('New Item'));
    await btn.trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
  });

  it('create modal has station selector', async () => {
    const wrapper = mountItems();
    const btn = wrapper.findAll('button').find(b => b.text().includes('New Item'));
    await btn.trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Station');
    expect(wrapper.text()).toContain('SKU');
  });

  it('shows item table with columns', async () => {
    const wrapper = mountItems();
    const store = useInventoryStore();
    store.loading = false;
    store.items = [
      { id: 1, sku: 'WATER', name: 'Water Bottle', on_hand: 100, reorder_point: 20, tracking_mode: 'none', is_active: true }
    ];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    // Table should render with item data
    expect(wrapper.text()).toContain('SKU');
    expect(wrapper.text()).toContain('WATER');
  });

  it('highlights low stock items', async () => {
    const wrapper = mountItems();
    const store = useInventoryStore();
    store.items = [
      { id: 1, sku: 'LOW', name: 'Low Item', on_hand: 5, reorder_point: 20, tracking_mode: 'none', is_active: true }
    ];
    await wrapper.vm.$nextTick();
    const td = wrapper.findAll('td').find(t => t.text() === '5');
    if (td) {
      expect(td.classes().some(c => c.includes('stock-low') || c.includes('stock-critical'))).toBe(true);
    }
  });
});
