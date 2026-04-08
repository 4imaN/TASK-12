import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../utils/api.js', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), patch: vi.fn() }
}));

import InventoryDashboard from '../../views/InventoryDashboard.vue';
import { useInventoryStore } from '../../stores/inventory.js';

function mountDash() {
  return mount(InventoryDashboard, {
    global: { plugins: [createPinia()], stubs: { 'router-link': { template: '<a><slot/></a>' } } }
  });
}

describe('InventoryDashboard', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders heading', async () => {
    const wrapper = mountDash();
    await new Promise(r => setTimeout(r, 50));
    expect(wrapper.text()).toContain('Inventory Dashboard');
  });

  it('shows summary cards', async () => {
    const wrapper = mountDash();
    await new Promise(r => setTimeout(r, 50));
    expect(wrapper.text()).toContain('Total Items');
    expect(wrapper.text()).toContain('Low Stock Alerts');
  });

  it('shows quick action links', async () => {
    const wrapper = mountDash();
    await new Promise(r => setTimeout(r, 50));
    expect(wrapper.text()).toContain('New Movement');
    expect(wrapper.text()).toContain('Stock Count');
  });

  it('displays alert count from store', async () => {
    const wrapper = mountDash();
    const store = useInventoryStore();
    store.alerts = [{ type: 'low_stock', item_name: 'Water', on_hand: 5, reorder_point: 20 }];
    store.items = [{ id: 1 }, { id: 2 }];
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('2'); // total items
  });

  it('shows active alerts section', async () => {
    const wrapper = mountDash();
    await new Promise(r => setTimeout(r, 50));
    expect(wrapper.text()).toContain('Active Alerts');
  });
});
