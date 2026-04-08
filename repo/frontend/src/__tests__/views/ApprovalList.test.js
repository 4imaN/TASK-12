import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

import { api } from '../../utils/api.js';
import ApprovalList from '../../views/ApprovalList.vue';

function mountApprovals() {
  return mount(ApprovalList, {
    global: { plugins: [createPinia()], stubs: { StatusBadge: true, AlertBanner: true } }
  });
}

describe('ApprovalList', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); });

  it('shows loading state initially', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    const wrapper = mountApprovals();
    expect(wrapper.find('.loading-state').exists() || wrapper.find('.spinner').exists()).toBe(true);
  });

  it('shows error state on API failure', async () => {
    api.get.mockRejectedValue({ message: 'Network error' });
    const wrapper = mountApprovals();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Failed to load');
  });

  it('shows empty state when no approvals', async () => {
    api.get.mockResolvedValue({ data: [] });
    const wrapper = mountApprovals();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('No pending approvals');
  });

  it('renders approval items from API', async () => {
    api.get.mockResolvedValue({ data: [{ id: 1, schedule_id: 1, schedule_name: 'Express', version_number: 2, status: 'pending', requested_at: '2026-01-01', requested_by_name: 'host1' }] });
    const wrapper = mountApprovals();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Express');
  });

  it('has approve and reject buttons for pending items', async () => {
    api.get.mockResolvedValue({ data: [{ id: 1, schedule_id: 1, version_number: 1, status: 'pending', requested_at: '2026-01-01', requested_by_name: 'host1' }] });
    const wrapper = mountApprovals();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    const btns = wrapper.findAll('button');
    expect(btns.some(b => b.text().includes('Approve'))).toBe(true);
    expect(btns.some(b => b.text().includes('Reject'))).toBe(true);
  });

  it('has retry button on error', async () => {
    api.get.mockRejectedValue({ message: 'fail' });
    const wrapper = mountApprovals();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('button').some(b => b.text().includes('Retry'))).toBe(true);
  });
});
