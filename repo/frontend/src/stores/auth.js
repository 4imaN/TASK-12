import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '../utils/api.js';
import { generateDeviceFingerprint } from '../utils/deviceFingerprint.js';
import { clearAllSearches } from '../utils/cache.js';

// One-time cleanup: remove legacy localStorage token if present
try { localStorage.removeItem('railops_token'); } catch { /* SSR safety */ }

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null);
  const loading = ref(false);
  const error = ref(null);
  const deviceChallenge = ref(false);
  const pendingLogin = ref(null);

  // Auth state is determined by server session (cookie), reflected by user object
  const isAuthenticated = computed(() => !!user.value);
  const role = computed(() => user.value?.role || 'guest');
  const isHost = computed(() => role.value === 'host' || role.value === 'platform_ops');
  const isPlatformOps = computed(() => role.value === 'platform_ops');

  async function login(username, password) {
    loading.value = true;
    error.value = null;
    deviceChallenge.value = false;
    try {
      const fp = await generateDeviceFingerprint();
      const res = await api.post('/auth/login', { username, password, deviceFingerprint: fp });
      // Cookie is set by the server response (HttpOnly). We just store the user object.
      user.value = res.data.user;
      return { success: true };
    } catch (e) {
      // Handle session cap exceeded (409)
      if (e.status === 409 && e.data?.error?.code === 'SESSION_CAP_EXCEEDED') {
        error.value = e.data.error.message;
        throw e;
      }
      // Handle device verification (403) — not a real error, it's a challenge
      if (e.status === 403 && e.data?.error?.code === 'DEVICE_VERIFICATION_REQUIRED') {
        deviceChallenge.value = true;
        pendingLogin.value = {
          username,
          password,
          deviceFingerprint: await generateDeviceFingerprint(),
          sessionToken: e.data.error.sessionToken
        };
        return { needsVerification: true };
      }
      error.value = e.data?.error?.message || e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function verifyDevice(code) {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.post('/auth/verify-device', {
        code,
        sessionToken: pendingLogin.value?.sessionToken,
        deviceFingerprint: pendingLogin.value?.deviceFingerprint
      });
      // Cookie set by server. Store user.
      user.value = res.data.user;
      deviceChallenge.value = false;
      pendingLogin.value = null;
      return { success: true };
    } catch (e) {
      error.value = e.data?.error?.message || e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function fetchMe() {
    try {
      const res = await api.get('/auth/me');
      user.value = res.data;
    } catch {
      user.value = null;
    }
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch { /* ignore — cookie will be cleared by server */ }
    user.value = null;
    await clearAllSearches();
  }

  async function checkSession() {
    // Always verify with server — cookie is opaque to JS
    await fetchMe();
  }

  return {
    user, loading, error, deviceChallenge, pendingLogin,
    isAuthenticated, role, isHost, isPlatformOps,
    login, verifyDevice, fetchMe, logout, checkSession
  };
});
