/**
 * Router configuration tests — validates route definitions without mocks.
 * Tests the route table structure, auth metadata, and role restrictions.
 */
import { describe, it, expect, vi } from 'vitest';

// Minimal auth store mock — only needed for router module loading, not for API calls
vi.mock('../stores/auth.js', () => ({
  useAuthStore: vi.fn(() => ({
    user: null,
    isAuthenticated: false,
    role: 'guest',
    checkSession: vi.fn()
  }))
}));

const { default: router } = await import('../router/index.js');

describe('Route definitions', () => {
  const routes = router.getRoutes();
  const findRoute = (path) => routes.find(r => r.path === path);

  it('has public /search route without auth requirement', () => {
    const route = findRoute('/search');
    expect(route).toBeDefined();
    expect(route.meta.requiresAuth).toBeFalsy();
  });

  it('has public /login route without auth requirement', () => {
    const route = findRoute('/login');
    expect(route).toBeDefined();
    expect(route.meta.requiresAuth).toBeFalsy();
  });

  it('has auth-required /schedules route for host and platform_ops', () => {
    const route = findRoute('/schedules');
    expect(route).toBeDefined();
    expect(route.meta.requiresAuth).toBe(true);
    expect(route.meta.roles).toContain('host');
    expect(route.meta.roles).toContain('platform_ops');
  });

  it('has auth-required /inventory route', () => {
    const route = findRoute('/inventory');
    expect(route).toBeDefined();
    expect(route.meta.requiresAuth).toBe(true);
  });

  it('has platform_ops-only /approvals route', () => {
    const route = findRoute('/approvals');
    expect(route).toBeDefined();
    expect(route.meta.roles).toContain('platform_ops');
    expect(route.meta.roles).not.toContain('host');
  });

  it('has platform_ops-only /audit route', () => {
    const route = findRoute('/audit');
    expect(route).toBeDefined();
    expect(route.meta.roles).toContain('platform_ops');
  });

  it('has platform_ops-only /admin/users route', () => {
    const route = findRoute('/admin/users');
    expect(route).toBeDefined();
    expect(route.meta.roles).toContain('platform_ops');
  });

  it('has platform_ops-only /backups route', () => {
    const route = findRoute('/backups');
    expect(route).toBeDefined();
    expect(route.meta.requiresAuth).toBe(true);
  });

  it('has /data-quality route requiring auth', () => {
    const route = findRoute('/data-quality');
    expect(route).toBeDefined();
    expect(route.meta.requiresAuth).toBe(true);
  });
});
