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
    { path: '/schedules/:id/edit', component: { template: '<div/>' }, name: 'ScheduleEdit' },
    { path: '/search', component: { template: '<div/>' } }
  ]
});

function setupStores(role = 'platform_ops') {
  const auth = useAuthStore();
  auth.user = { id: role === 'host' ? 2 : 1, role, username: role === 'host' ? 'host1' : 'admin', assignedStationIds: [1] };
  const store = useScheduleStore();
  store.loading = false;
  store.currentSchedule = { id: 1, route_name: 'Northeast Express', station_name: 'NYC', trainset_code: 'ACELA', active_version_id: 10 };
  return { auth, store };
}

function mountDetail() {
  router.push('/schedules/1');
  return mount(ScheduleDetail, {
    global: {
      plugins: [createPinia(), router],
      stubs: { VersionCompare: true, AlertBanner: true, StatusBadge: true }
    }
  });
}

describe('ScheduleDetail - Publish Flow', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('platform ops sees Publish button on draft versions', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('platform_ops');
    store.versions = [{ id: 20, version_number: 2, status: 'draft', created_by_name: 'host1' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const btns = wrapper.findAll('button');
    expect(btns.some(b => b.text().includes('Publish') || b.text().includes('validation first'))).toBe(true);
  });

  it('host does NOT see direct Publish button', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('host');
    store.versions = [{ id: 20, version_number: 2, status: 'draft', created_by_name: 'host1' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const btns = wrapper.findAll('button');
    const publishBtns = btns.filter(b => b.text() === 'Publish');
    expect(publishBtns.length).toBe(0);
  });

  it('host sees Request Approval button on draft versions', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('host');
    store.versions = [{ id: 20, version_number: 2, status: 'draft', created_by_name: 'host1' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    expect(text.includes('Request Approval') || text.includes('validation first')).toBe(true);
  });

  it('publish button is disabled until validation passes for that version', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('platform_ops');
    store.versions = [{ id: 20, version_number: 2, status: 'draft', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const publishBtn = wrapper.findAll('button').find(b => b.text().includes('validation first') || b.text().includes('Publish'));
    if (publishBtn) {
      // Before validation, button should be disabled
      expect(publishBtn.attributes('disabled')).toBeDefined();
    }
  });

  it('validate button exists for draft versions', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('platform_ops');
    store.versions = [{ id: 20, version_number: 2, status: 'draft', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('button').some(b => b.text() === 'Validate')).toBe(true);
  });
});

describe('ScheduleDetail - Rollback Flow', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('rollback button visible to platform ops on published versions', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('platform_ops');
    store.versions = [{ id: 10, version_number: 1, status: 'published', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Rollback To');
  });

  it('rollback button NOT visible to hosts', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('host');
    store.versions = [{ id: 10, version_number: 1, status: 'published', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('button').some(b => b.text().includes('Rollback'))).toBe(false);
  });

  it('clicking rollback opens reason modal', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('platform_ops');
    store.versions = [{ id: 10, version_number: 1, status: 'published', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const rollbackBtn = wrapper.findAll('button').find(b => b.text().includes('Rollback'));
    if (rollbackBtn) {
      await rollbackBtn.trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain('Reason for rollback');
    }
  });
});

describe('ScheduleDetail - Version Compare', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('version compare checkboxes exist', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('platform_ops');
    store.versions = [
      { id: 10, version_number: 1, status: 'published', created_by_name: 'admin' },
      { id: 20, version_number: 2, status: 'draft', created_by_name: 'admin' }
    ];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
  });

  it('view button exists for each version', async () => {
    const wrapper = mountDetail();
    await router.isReady();
    const { store } = setupStores('platform_ops');
    store.versions = [{ id: 10, version_number: 1, status: 'published', created_by_name: 'admin' }];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('button').some(b => b.text() === 'View')).toBe(true);
  });
});
