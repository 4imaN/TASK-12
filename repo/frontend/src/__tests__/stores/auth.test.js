import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../../stores/auth.js';

// Mock the api module
vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

// Mock device fingerprint (now async)
vi.mock('../../utils/deviceFingerprint.js', () => ({
  generateDeviceFingerprint: vi.fn(() => Promise.resolve('mock-fingerprint'))
}));

// Mock cache utilities
vi.mock('../../utils/cache.js', () => ({
  clearAllSearches: vi.fn(() => Promise.resolve())
}));

// Mock localStorage (for one-time cleanup verification)
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; })
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('auth store — cookie-based session', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('has correct initial state with no user', () => {
    const auth = useAuthStore();
    expect(auth.user).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.loading).toBe(false);
    expect(auth.error).toBeNull();
  });

  it('store does NOT expose a token ref', () => {
    const auth = useAuthStore();
    expect(auth.token).toBeUndefined();
  });

  it('login sets user on success (no localStorage write)', async () => {
    const { api } = await import('../../utils/api.js');
    api.post.mockResolvedValueOnce({
      data: {
        token: 'server-sets-cookie-not-used-by-client',
        user: { id: 1, username: 'admin', role: 'platform_ops' }
      }
    });

    const auth = useAuthStore();
    const result = await auth.login('admin', 'admin123');

    expect(result).toEqual({ success: true });
    expect(auth.user).toEqual({ id: 1, username: 'admin', role: 'platform_ops' });
    expect(auth.isAuthenticated).toBe(true);
    // No localStorage write
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it('logout clears user (no localStorage dependency)', async () => {
    const { api } = await import('../../utils/api.js');
    api.post.mockResolvedValueOnce({
      data: { user: { id: 1, username: 'admin', role: 'platform_ops' } }
    });

    const auth = useAuthStore();
    await auth.login('admin', 'admin123');
    expect(auth.isAuthenticated).toBe(true);

    api.post.mockResolvedValueOnce({});
    await auth.logout();

    expect(auth.user).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
  });

  it('checkSession calls /auth/me to verify cookie session', async () => {
    const { api } = await import('../../utils/api.js');
    api.get.mockResolvedValueOnce({
      data: { id: 1, username: 'admin', role: 'platform_ops' }
    });

    const auth = useAuthStore();
    await auth.checkSession();

    expect(api.get).toHaveBeenCalledWith('/auth/me');
    expect(auth.user).toEqual({ id: 1, username: 'admin', role: 'platform_ops' });
    expect(auth.isAuthenticated).toBe(true);
  });

  it('checkSession clears user if session is invalid', async () => {
    const { api } = await import('../../utils/api.js');
    api.get.mockRejectedValueOnce(new Error('Unauthorized'));

    const auth = useAuthStore();
    await auth.checkSession();

    expect(auth.user).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
  });

  it('role computed returns guest when no user', () => {
    const auth = useAuthStore();
    expect(auth.role).toBe('guest');
  });

  it('isHost is true for host role', async () => {
    const { api } = await import('../../utils/api.js');
    api.post.mockResolvedValueOnce({
      data: { user: { id: 2, username: 'host1', role: 'host' } }
    });

    const auth = useAuthStore();
    await auth.login('host1', 'host123');

    expect(auth.role).toBe('host');
    expect(auth.isHost).toBe(true);
    expect(auth.isPlatformOps).toBe(false);
  });

  it('isPlatformOps is true for platform_ops role', async () => {
    const { api } = await import('../../utils/api.js');
    api.post.mockResolvedValueOnce({
      data: { user: { id: 1, username: 'admin', role: 'platform_ops' } }
    });

    const auth = useAuthStore();
    await auth.login('admin', 'admin123');

    expect(auth.role).toBe('platform_ops');
    expect(auth.isPlatformOps).toBe(true);
    expect(auth.isHost).toBe(true);
  });

  it('login handles 403 device verification as challenge, not error', async () => {
    const { api } = await import('../../utils/api.js');
    const err = new Error('Device verification required');
    err.status = 403;
    err.data = { error: { code: 'DEVICE_VERIFICATION_REQUIRED', sessionToken: 'pending-tok' } };
    api.post.mockRejectedValueOnce(err);

    const auth = useAuthStore();
    const result = await auth.login('user', 'pass');

    expect(result).toEqual({ needsVerification: true });
    expect(auth.deviceChallenge).toBe(true);
    expect(auth.pendingLogin).toBeTruthy();
    expect(auth.pendingLogin.sessionToken).toBe('pending-tok');
  });

  it('login sets error on session cap exceeded (409)', async () => {
    const { api } = await import('../../utils/api.js');
    const err = new Error('Session limit reached');
    err.status = 409;
    err.data = { error: { code: 'SESSION_CAP_EXCEEDED', message: 'Session limit reached (2 active). Log out of another session or contact Platform Operations for an exception.', sessionCapExceeded: true } };
    api.post.mockRejectedValueOnce(err);

    const auth = useAuthStore();
    await expect(auth.login('user', 'pass')).rejects.toThrow();

    expect(auth.error).toBe('Session limit reached (2 active). Log out of another session or contact Platform Operations for an exception.');
    expect(auth.deviceChallenge).toBe(false);
  });

  it('store never writes tokens to localStorage', async () => {
    const { api } = await import('../../utils/api.js');
    api.post.mockResolvedValueOnce({
      data: { user: { id: 1, username: 'admin', role: 'platform_ops' } }
    });

    const auth = useAuthStore();
    await auth.login('admin', 'admin123');

    // Verify no setItem was called for auth tokens
    const tokenWrites = localStorageMock.setItem.mock.calls.filter(c => c[0] === 'railops_token');
    expect(tokenWrites).toHaveLength(0);
  });
});
