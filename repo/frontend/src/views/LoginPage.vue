<template>
  <div class="login-page">
    <div class="login-bg">
      <div class="bg-pattern"></div>
    </div>
    <div class="login-container">
      <div class="login-card">
        <div class="login-header">
          <div class="login-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
            </svg>
          </div>
          <h2>Welcome to RailOps</h2>
          <p>Sign in to your local account</p>
        </div>

        <AlertBanner v-if="auth.error" type="danger" :message="auth.error" @dismiss="auth.error = null" />

        <template v-if="auth.deviceChallenge">
          <div class="alert alert-warning">New device detected. Enter a recovery code to continue.</div>
          <form @submit.prevent="submitVerification">
            <div class="form-group">
              <label>Recovery Code</label>
              <input v-model="recoveryCode" type="text" class="form-control form-control-lg" placeholder="XXXX-XXXX" required />
            </div>
            <button class="btn btn-primary login-submit" :disabled="auth.loading">
              <span v-if="auth.loading" class="spinner"></span> Verify Device
            </button>
          </form>
        </template>

        <template v-else>
          <form @submit.prevent="submitLogin">
            <div class="form-group">
              <label>Username</label>
              <input v-model="username" type="text" class="form-control form-control-lg" placeholder="Enter username" required autocomplete="username" />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input v-model="password" type="password" class="form-control form-control-lg" placeholder="Enter password" required autocomplete="current-password" />
            </div>
            <button class="btn btn-primary login-submit" :disabled="auth.loading">
              <span v-if="auth.loading" class="spinner"></span>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              Sign In
            </button>
          </form>
        </template>

        <div class="login-footer">
          <div class="secure-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Local network only &middot; No internet required
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import AlertBanner from '../components/AlertBanner.vue';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const recoveryCode = ref('');

async function submitLogin() {
  try {
    const result = await auth.login(username.value, password.value);
    if (result?.needsVerification) return;
    router.push(route.query.redirect || '/schedules');
  } catch { /* error handled by store */ }
}

async function submitVerification() {
  try {
    await auth.verifyDevice(recoveryCode.value);
    router.push(route.query.redirect || '/schedules');
  } catch { /* error handled by store */ }
}
</script>

<style scoped>
.login-page {
  min-height: calc(100vh - 60px);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
.login-bg {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, #0f2027 0%, #1a365d 40%, #2c5282 100%);
}
.bg-pattern {
  position: absolute; inset: 0;
  background-image:
    radial-gradient(circle at 20% 50%, rgba(66,153,225,0.08) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(99,179,237,0.06) 0%, transparent 50%),
    radial-gradient(circle at 50% 80%, rgba(49,130,206,0.05) 0%, transparent 50%);
}
.login-container {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  padding: 1.5rem;
}
.login-card {
  background: rgba(255,255,255,0.97);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  padding: 2.5rem 2rem;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1);
}
.login-header { text-align: center; margin-bottom: 2rem; }
.login-icon {
  width: 56px; height: 56px; margin: 0 auto 1rem;
  background: linear-gradient(135deg, #1a365d, #2b6cb0);
  border-radius: 14px; display: flex; align-items: center; justify-content: center;
  color: #fff; box-shadow: 0 4px 12px rgba(26,54,93,0.3);
}
.login-header h2 {
  font-size: 1.4rem; font-weight: 800; color: var(--color-primary);
  letter-spacing: -0.3px; margin-bottom: 0.3rem;
}
.login-header p {
  color: var(--color-text-light); font-size: 0.85rem;
}
.form-control-lg {
  padding: 0.75rem 1rem; font-size: 0.95rem; border-radius: 10px;
}
.login-submit {
  width: 100%; justify-content: center; padding: 0.75rem;
  font-size: 0.95rem; border-radius: 10px; margin-top: 0.5rem;
}
.login-footer {
  margin-top: 1.75rem; text-align: center;
}
.secure-badge {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.72rem; color: var(--color-text-light);
  background: var(--color-bg); padding: 0.4rem 0.8rem; border-radius: 50px;
}
</style>
