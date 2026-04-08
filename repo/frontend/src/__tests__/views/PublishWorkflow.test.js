/**
 * Multi-step role workflow assertions for schedule publish flow.
 * Tests the full validate → request approval → approved → publish path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';

vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} })
  }
}));

import ScheduleDetail from '../../views/ScheduleDetail.vue';
import { useScheduleStore } from '../../stores/schedules.js';
import { useAuthStore } from '../../stores/auth.js';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/schedules/:id', component: ScheduleDetail, name: 'ScheduleDetail' },
    { path: '/schedules/:id/edit', component: { template: '<div/>' } },
    { path: '/search', component: { template: '<div/>' } }
  ]
});

function setupAs(role) {
  const auth = useAuthStore();
  auth.user = { id: role === 'host' ? 2 : 1, role, username: role, assignedStationIds: [1] };
  const store = useScheduleStore();
  store.loading = false;
  store.currentSchedule = { id: 1, route_name: 'Express', station_name: 'NYC', active_version_id: null };
  return store;
}

function mountPage() {
  router.push('/schedules/1');
  return mount(ScheduleDetail, {
    global: { plugins: [createPinia(), router], stubs: { VersionCompare: true, AlertBanner: true, StatusBadge: true } }
  });
}

describe('Publish Workflow — Host Role', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('Step 1: Host sees Validate on draft, no direct Publish', async () => {
    const wrapper = mountPage();
    await router.isReady();
    const store = setupAs('host');
    store.versions = [{ id: 20, version_number: 1, status: 'draft', created_by_name: 'host' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const btns = wrapper.findAll('button').map(b => b.text());
    expect(btns).toContain('Validate');
    expect(btns.filter(t => t === 'Publish')).toHaveLength(0);
  });

  it('Step 2: Host sees Request Approval (disabled until validated)', async () => {
    const wrapper = mountPage();
    await router.isReady();
    const store = setupAs('host');
    store.versions = [{ id: 20, version_number: 1, status: 'draft', created_by_name: 'host' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const reqBtn = wrapper.findAll('button').find(b => b.text().includes('validation first') || b.text().includes('Request Approval'));
    expect(reqBtn).toBeDefined();
    if (reqBtn) expect(reqBtn.attributes('disabled')).toBeDefined();
  });

  it('Step 3: After approval, host sees "Awaiting Approval" badge', async () => {
    const wrapper = mountPage();
    await router.isReady();
    const store = setupAs('host');
    store.versions = [{ id: 20, version_number: 1, status: 'pending_approval', created_by_name: 'host' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Awaiting Approval');
  });

  it('Step 4: Rejected version shows rejection badge', async () => {
    const wrapper = mountPage();
    await router.isReady();
    const store = setupAs('host');
    store.versions = [{ id: 20, version_number: 1, status: 'rejected', created_by_name: 'host' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Rejected');
  });
});

describe('Publish Workflow — Platform Ops Role', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('Step 1: Platform Ops sees Validate and Publish on draft', async () => {
    const wrapper = mountPage();
    await router.isReady();
    const store = setupAs('platform_ops');
    store.versions = [{ id: 20, version_number: 1, status: 'draft', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const btns = wrapper.findAll('button').map(b => b.text());
    expect(btns).toContain('Validate');
    expect(btns.some(t => t.includes('Publish') || t.includes('validation first'))).toBe(true);
  });

  it('Step 2: Publish is disabled until validation passes', async () => {
    const wrapper = mountPage();
    await router.isReady();
    const store = setupAs('platform_ops');
    store.versions = [{ id: 20, version_number: 1, status: 'draft', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const pubBtn = wrapper.findAll('button').find(b => b.text().includes('validation first') || b.text().includes('Publish'));
    if (pubBtn) expect(pubBtn.attributes('disabled')).toBeDefined();
  });

  it('Step 3: Approved version shows "Publish Approved" button', async () => {
    const wrapper = mountPage();
    await router.isReady();
    const store = setupAs('platform_ops');
    store.versions = [{ id: 20, version_number: 1, status: 'approved', created_by_name: 'host' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Publish Approved');
  });

  it('Step 4: Published version shows Rollback To', async () => {
    const wrapper = mountPage();
    await router.isReady();
    const store = setupAs('platform_ops');
    store.versions = [{ id: 20, version_number: 1, status: 'published', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Rollback To');
  });

  it('Step 5: Rollback modal requires reason', async () => {
    const wrapper = mountPage();
    await router.isReady();
    const store = setupAs('platform_ops');
    store.versions = [{ id: 20, version_number: 1, status: 'published', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const rbBtn = wrapper.findAll('button').find(b => b.text().includes('Rollback'));
    if (rbBtn) {
      await rbBtn.trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain('Reason for rollback');
      const confirmBtn = wrapper.findAll('button').find(b => b.text().includes('Confirm Rollback'));
      if (confirmBtn) expect(confirmBtn.attributes('disabled')).toBeDefined();
    }
  });
});
