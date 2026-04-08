import { describe, it, expect, vi } from 'vitest';

// Mock pinia / auth store so the router module can be imported without errors
vi.mock('../stores/auth.js', () => ({
  useAuthStore: vi.fn(() => ({
    user: null,
    isAuthenticated: false,
    role: 'guest',
    checkSession: vi.fn()
  }))
}));

// Dynamically import after mocks are in place
const { default: router } = await import('../router/index.js');

describe('router', () => {
  const routes = router.getRoutes();

  function findRoute(path) {
    return routes.find((r) => r.path === path);
  }

  it('has public routes for search and login', () => {
    const search = findRoute('/search');
    expect(search).toBeDefined();
    expect(search.meta.requiresAuth).toBeFalsy();

    const login = findRoute('/login');
    expect(login).toBeDefined();
    expect(login.meta.requiresAuth).toBeFalsy();
  });

  it('has auth-required routes for schedules', () => {
    const schedules = findRoute('/schedules');
    expect(schedules).toBeDefined();
    expect(schedules.meta.requiresAuth).toBe(true);
  });

  it('has auth-required routes for inventory', () => {
    const inventory = findRoute('/inventory');
    expect(inventory).toBeDefined();
    expect(inventory.meta.requiresAuth).toBe(true);
  });

  it('has platform_ops-only routes for approvals and audit', () => {
    const approvals = findRoute('/approvals');
    expect(approvals).toBeDefined();
    expect(approvals.meta.requiresAuth).toBe(true);
    expect(approvals.meta.roles).toContain('platform_ops');

    const audit = findRoute('/audit');
    expect(audit).toBeDefined();
    expect(audit.meta.requiresAuth).toBe(true);
    expect(audit.meta.roles).toContain('platform_ops');
  });

  it('has platform_ops-only routes for admin users and backups', () => {
    const users = findRoute('/admin/users');
    expect(users).toBeDefined();
    expect(users.meta.requiresAuth).toBe(true);
    expect(users.meta.roles).toContain('platform_ops');

    const backups = findRoute('/backups');
    expect(backups).toBeDefined();
    expect(backups.meta.requiresAuth).toBe(true);
    expect(backups.meta.roles).toContain('platform_ops');
  });

  it('has data-quality route requiring auth', () => {
    const dq = findRoute('/data-quality');
    expect(dq).toBeDefined();
    expect(dq.meta.requiresAuth).toBe(true);
  });
});
