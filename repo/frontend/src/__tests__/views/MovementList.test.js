import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} })
  }
}));

import MovementList from '../../views/MovementList.vue';
import { useInventoryStore } from '../../stores/inventory.js';

function mountMovements() {
  return mount(MovementList, {
    global: {
      plugins: [createPinia()],
      stubs: { AlertBanner: true }
    }
  });
}

describe('MovementList - Page Flow', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders the page with heading', async () => {
    const wrapper = mountMovements();
    await new Promise(r => setTimeout(r, 50));
    expect(wrapper.text()).toContain('Inventory Movements');
  });

  it('has new movement button', () => {
    const wrapper = mountMovements();
    expect(wrapper.findAll('button').some(b => b.text().includes('New Movement'))).toBe(true);
  });

  it('has type filter dropdown', () => {
    const wrapper = mountMovements();
    const selects = wrapper.findAll('select');
    expect(selects.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain('Receiving');
    expect(wrapper.text()).toContain('Shipping');
  });

  it('clicking new movement opens modal', async () => {
    const wrapper = mountMovements();
    const btn = wrapper.findAll('button').find(b => b.text().includes('New Movement'));
    await btn.trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.text()).toContain('New Movement');
  });

  it('movement modal has type selector with all movement types', async () => {
    const wrapper = mountMovements();
    const btn = wrapper.findAll('button').find(b => b.text().includes('New Movement'));
    await btn.trigger('click');
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    expect(text).toContain('Receiving');
    expect(text).toContain('Shipping');
    expect(text).toContain('Material Return');
    expect(text).toContain('Customer Return');
  });

  it('has a table for movement history', async () => {
    const wrapper = mountMovements();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('table').exists()).toBe(true);
    expect(wrapper.text()).toContain('Date');
    expect(wrapper.text()).toContain('Type');
  });

  it('shows empty state when no movements', async () => {
    const wrapper = mountMovements();
    const store = useInventoryStore();
    store.loading = false;
    store.movements = [];
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('No movements');
  });
});
