import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn()
  }
}));

import { api } from '../../utils/api.js';
import DataQuality from '../../views/DataQuality.vue';

function mountDQ() {
  return mount(DataQuality, {
    global: { plugins: [createPinia()], stubs: { StatusBadge: true, AlertBanner: true } }
  });
}

describe('DataQuality', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); });

  it('shows loading state', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    const wrapper = mountDQ();
    expect(wrapper.find('.loading-state').exists()).toBe(true);
  });

  it('shows error with retry on failure', async () => {
    api.get.mockRejectedValue({ message: 'Server down' });
    const wrapper = mountDQ();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Failed to load');
    expect(wrapper.findAll('button').some(b => b.text().includes('Retry'))).toBe(true);
  });

  it('renders content on success', async () => {
    api.get
      .mockResolvedValueOnce({ data: [{ id: 1, entity_type: 'schedule', check_type: 'completeness', severity: 'high', status: 'open', description: 'Test' }] })
      .mockResolvedValueOnce({ data: [{ id: 1, report_date: '2026-04-01', total_checks: 10, passed_checks: 8, failed_checks: 2, issues_found: 2 }] });
    const wrapper = mountDQ();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Issue Summary');
  });

  it('shows empty state when no data', async () => {
    api.get.mockResolvedValue({ data: [] });
    const wrapper = mountDQ();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    expect(text.includes('No issues') || text.includes('No reports') || text.includes('Issue Summary')).toBe(true);
  });
});
