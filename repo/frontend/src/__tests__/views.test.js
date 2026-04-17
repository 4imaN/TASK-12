/**
 * Vue view rendering tests — verifies that views render correctly,
 * display expected elements, and handle user interaction.
 *
 * Uses minimal API stubs (not behavioral mocks) since views import
 * the API module and cannot render without it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Minimal API stub — returns empty data so views can render
vi.mock('../utils/api.js', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} })
  }
}));
vi.mock('../utils/cache.js', () => ({
  normalizeSearchKey: (p) => JSON.stringify(p),
  getCachedSearch: vi.fn().mockResolvedValue(null),
  setCachedSearch: vi.fn(),
  clearAllSearches: vi.fn()
}));
vi.mock('../utils/deviceFingerprint.js', () => ({
  generateDeviceFingerprint: vi.fn(async () => 'test-fp')
}));

beforeEach(() => setActivePinia(createPinia()));

const stubs = { StatusBadge: true, AlertBanner: true, StationAutocomplete: true, 'router-link': { template: '<a><slot/></a>' } };

// ── LoginPage ────────────────────────────────────────────────

describe('LoginPage', () => {
  it('renders username, password inputs and Sign In button', async () => {
    const { default: C } = await import('../views/LoginPage.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs: { ...stubs, AlertBanner: true } } });
    expect(w.find('input[placeholder="Enter username"]').exists()).toBe(true);
    expect(w.find('input[placeholder="Enter password"]').exists()).toBe(true);
    expect(w.text()).toContain('Sign In');
  });
});

// ── TripSearch ───────────────────────────────────────────────

describe('TripSearch', () => {
  it('renders search hero and form controls', async () => {
    const { default: C } = await import('../views/TripSearch.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Find Your Train');
    expect(w.find('.search-btn').exists()).toBe(true);
    expect(w.find('input[placeholder="MM/DD/YYYY"]').exists()).toBe(true);
  });

  it('has seat class dropdown with options', async () => {
    const { default: C } = await import('../views/TripSearch.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Economy');
    expect(w.text()).toContain('Business');
  });

  it('has sort chips', async () => {
    const { default: C } = await import('../views/TripSearch.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Departure');
    expect(w.text()).toContain('Price');
  });
});

// ── ScheduleList ─────────────────────────────────────────────

describe('ScheduleList', () => {
  it('renders heading and status filter', async () => {
    const { default: C } = await import('../views/ScheduleList.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Schedules');
    expect(w.find('select').exists()).toBe(true);
  });
});

// ── InventoryDashboard ───────────────────────────────────────

describe('InventoryDashboard', () => {
  it('renders dashboard cards', async () => {
    const { default: C } = await import('../views/InventoryDashboard.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Inventory Dashboard');
    expect(w.text()).toContain('Total Items');
  });
});

// ── ItemList ─────────────────────────────────────────────────

describe('ItemList', () => {
  it('renders heading and New Item button', async () => {
    const { default: C } = await import('../views/ItemList.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Inventory Items');
    expect(w.findAll('button').some(b => b.text().includes('New Item'))).toBe(true);
  });
});

// ── MovementList ─────────────────────────────────────────────

describe('MovementList', () => {
  it('renders heading and New Movement button', async () => {
    const { default: C } = await import('../views/MovementList.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Inventory Movements');
    expect(w.findAll('button').some(b => b.text().includes('New Movement'))).toBe(true);
  });
});

// ── StockCountList ───────────────────────────────────────────

describe('StockCountList', () => {
  it('renders heading and New Count button', async () => {
    const { default: C } = await import('../views/StockCountList.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Stock Counts');
    expect(w.findAll('button').some(b => b.text().includes('New Count'))).toBe(true);
  });
});

// ── ApprovalList ─────────────────────────────────────────────

describe('ApprovalList', () => {
  it('renders heading', async () => {
    const { default: C } = await import('../views/ApprovalList.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    await new Promise(r => setTimeout(r, 50));
    expect(w.text()).toContain('Approval');
  });
});

// ── AuditLog ─────────────────────────────────────────────────

describe('AuditLog', () => {
  it('renders heading and filter inputs', async () => {
    const { default: C } = await import('../views/AuditLog.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Audit Log');
    expect(w.text()).toContain('Backtracking');
  });
});

// ── UserManagement ───────────────────────────────────────────

describe('UserManagement', () => {
  it('renders heading and New User button', async () => {
    const { default: C } = await import('../views/UserManagement.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('User Management');
    expect(w.findAll('button').some(b => b.text().includes('New User'))).toBe(true);
  });
});

// ── BackupDashboard ──────────────────────────────────────────

describe('BackupDashboard', () => {
  it('renders heading', async () => {
    const { default: C } = await import('../views/BackupDashboard.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Backup');
  });
});

// ── DataQuality ──────────────────────────────────────────────

describe('DataQuality', () => {
  it('renders heading', async () => {
    const { default: C } = await import('../views/DataQuality.vue');
    const w = mount(C, { global: { plugins: [createPinia()], stubs } });
    expect(w.text()).toContain('Data Quality');
  });
});

// ── Components ───────────────────────────────────────────────

describe('AlertBanner', () => {
  it('renders message', async () => {
    const { default: C } = await import('../components/AlertBanner.vue');
    const w = mount(C, { props: { type: 'success', message: 'Test msg', show: true } });
    expect(w.text()).toContain('Test msg');
  });

  it('applies type class', async () => {
    const { default: C } = await import('../components/AlertBanner.vue');
    const w = mount(C, { props: { type: 'danger', message: 'Error', show: true } });
    expect(w.find('.alert-danger').exists()).toBe(true);
  });

  it('hidden when show is false', async () => {
    const { default: C } = await import('../components/AlertBanner.vue');
    const w = mount(C, { props: { type: 'info', message: 'X', show: false } });
    expect(w.find('.alert').exists()).toBe(false);
  });
});

describe('StatusBadge', () => {
  it('renders with correct class', async () => {
    const { default: C } = await import('../components/StatusBadge.vue');
    const w = mount(C, { props: { status: 'published' } });
    expect(w.find('.badge-published').exists()).toBe(true);
  });

  it('shows label when provided', async () => {
    const { default: C } = await import('../components/StatusBadge.vue');
    const w = mount(C, { props: { status: 'draft', label: 'Draft Version' } });
    expect(w.text()).toContain('Draft Version');
  });
});
