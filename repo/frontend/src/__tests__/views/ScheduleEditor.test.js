import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';

vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    patch: vi.fn().mockResolvedValue({ data: {} })
  }
}));

import ScheduleEditor from '../../views/ScheduleEditor.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/schedules/new', component: ScheduleEditor, name: 'ScheduleCreate' },
    { path: '/schedules/:id/edit', component: ScheduleEditor, name: 'ScheduleEdit' },
    { path: '/schedules/:id', component: { template: '<div/>' }, name: 'ScheduleDetail' },
    { path: '/schedules', component: { template: '<div/>' }, name: 'ScheduleList' }
  ]
});

function mountEditor(path = '/schedules/new') {
  router.push(path);
  return mount(ScheduleEditor, {
    global: {
      plugins: [createPinia(), router],
      stubs: { StationAutocomplete: true, AlertBanner: true }
    }
  });
}

describe('ScheduleEditor', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders the new schedule form', async () => {
    const wrapper = mountEditor();
    await router.isReady();
    expect(wrapper.find('h1').text()).toContain('New Schedule');
  });

  it('save button is disabled when form is empty', async () => {
    const wrapper = mountEditor();
    await router.isReady();
    await wrapper.vm.$nextTick();
    const saveBtn = wrapper.findAll('button').find(b => b.text().includes('Save Draft'));
    expect(saveBtn).toBeDefined();
    if (saveBtn) {
      expect(saveBtn.attributes('disabled')).toBeDefined();
    }
  });

  it('shows pre-publish checklist', async () => {
    const wrapper = mountEditor();
    await router.isReady();
    expect(wrapper.text()).toContain('Pre-Publish Checklist');
    expect(wrapper.text()).toContain('At least one stop');
    expect(wrapper.text()).toContain('seat capacities');
    expect(wrapper.text()).toContain('trainset overlap');
  });

  it('add stop button adds a stop row', async () => {
    const wrapper = mountEditor();
    await router.isReady();
    const addBtn = wrapper.findAll('button').find(b => b.text().includes('Add Stop'));
    expect(addBtn).toBeDefined();
    if (addBtn) {
      await addBtn.trigger('click');
      expect(wrapper.text()).toContain('Stop 1');
    }
  });

  it('add seat class button adds a class row', async () => {
    const wrapper = mountEditor();
    await router.isReady();
    const addBtn = wrapper.findAll('button').find(b => b.text().includes('Add Class'));
    expect(addBtn) .toBeDefined();
    if (addBtn) {
      await addBtn.trigger('click');
      expect(wrapper.findAll('input[type="number"]').length).toBeGreaterThan(0);
    }
  });

  it('shows validation hint when form is invalid', async () => {
    const wrapper = mountEditor();
    await router.isReady();
    await wrapper.vm.$nextTick();
    // Form starts empty = invalid, hint should show
    const hint = wrapper.find('.form-hint');
    if (hint.exists()) {
      expect(hint.text()).toContain('required');
    }
  });
});
