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
import BackupDashboard from '../../views/BackupDashboard.vue';

function mountBackup() {
  return mount(BackupDashboard, {
    global: { plugins: [createPinia()], stubs: { StatusBadge: true, AlertBanner: true } }
  });
}

describe('BackupDashboard', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); });

  it('shows loading state', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    const wrapper = mountBackup();
    expect(wrapper.find('.loading-state').exists()).toBe(true);
  });

  it('shows error with retry on failure', async () => {
    api.get.mockRejectedValue({ message: 'Disk error' });
    const wrapper = mountBackup();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Failed to load');
    expect(wrapper.findAll('button').some(b => b.text().includes('Retry'))).toBe(true);
  });

  it('renders content on success', async () => {
    api.get
      .mockResolvedValueOnce({ data: { backup_path: '/backups' } })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });
    const wrapper = mountBackup();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Backup Configuration');
  });

  it('has manual backup button', async () => {
    api.get.mockResolvedValue({ data: {} });
    const wrapper = mountBackup();
    await new Promise(r => setTimeout(r, 50));
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('button').some(b => b.text().includes('Backup'))).toBe(true);
  });
});
