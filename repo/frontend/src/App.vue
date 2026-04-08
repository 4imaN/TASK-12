<template>
  <div class="app">
    <header class="app-header">
      <div class="header-inner">
        <router-link to="/search" class="app-logo">
          <span class="logo-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
            </svg>
          </span>
          <span class="logo-text">Rail<span class="logo-accent">Ops</span></span>
        </router-link>

        <nav class="nav-center">
          <router-link to="/search" class="nav-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            Search
          </router-link>
          <template v-if="auth.isHost">
            <router-link to="/schedules" class="nav-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Schedules
            </router-link>
            <router-link to="/inventory" class="nav-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              Inventory
            </router-link>
          </template>
          <template v-if="auth.isPlatformOps">
            <div class="nav-divider"></div>
            <router-link to="/approvals" class="nav-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              Approvals
            </router-link>
            <router-link to="/audit" class="nav-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Audit
            </router-link>
            <router-link to="/admin/users" class="nav-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Users
            </router-link>
            <div class="nav-dropdown" ref="dropdownRef">
              <button class="nav-item nav-more-btn" @click.stop="showMore = !showMore">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                More
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" :style="{ transform: showMore ? 'rotate(180deg)' : '', transition: '0.2s' }"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div v-show="showMore" class="dropdown-menu">
                <router-link to="/backups" class="dropdown-item" @click="showMore = false">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Backups &amp; Recovery
                </router-link>
                <router-link to="/data-quality" class="dropdown-item" @click="showMore = false">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  Data Quality
                </router-link>
              </div>
            </div>
          </template>
        </nav>

        <div class="header-right">
          <template v-if="auth.isAuthenticated">
            <div class="user-pill">
              <div class="user-avatar">{{ initials }}</div>
              <div class="user-info">
                <span class="user-name">{{ auth.user?.display_name || auth.user?.username }}</span>
                <span class="user-role" :class="'role-' + auth.role">{{ roleLabel }}</span>
              </div>
            </div>
            <button class="logout-btn" @click="handleLogout" title="Sign out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </template>
          <template v-else>
            <router-link to="/login" class="login-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              Sign In
            </router-link>
          </template>
        </div>
      </div>
    </header>
    <main class="app-main">
      <router-view />
    </main>
    <footer class="app-footer">
      <span>RailOps Offline Suite</span>
      <span class="footer-dot"></span>
      <span>Local Network</span>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

const auth = useAuthStore();
const router = useRouter();
const showMore = ref(false);
const dropdownRef = ref(null);

function onClickOutside(e) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target)) {
    showMore.value = false;
  }
}
onMounted(() => {
  auth.checkSession();
  document.addEventListener('click', onClickOutside);
});
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside));

const initials = computed(() => {
  const name = auth.user?.display_name || auth.user?.username || '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
});

const roleLabel = computed(() => {
  const r = auth.role;
  if (r === 'platform_ops') return 'Platform Ops';
  if (r === 'host') return 'Station Host';
  return 'Guest';
});

async function handleLogout() {
  await auth.logout();
  router.push('/search');
}
</script>

<style scoped>
.app-header {
  background: linear-gradient(135deg, #0f2027 0%, #1a365d 50%, #203a5c 100%);
  color: #fff;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 12px rgba(0,0,0,0.25);
  border-bottom: 2px solid rgba(255,255,255,0.06);
}
.header-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}
.app-logo {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  text-decoration: none;
  color: #fff;
  flex-shrink: 0;
}
.logo-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: rgba(255,255,255,0.1);
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.15);
}
.logo-text {
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: 0.5px;
}
.logo-accent {
  color: #63b3ed;
}
.nav-center {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
  justify-content: center;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  color: rgba(255,255,255,0.7);
  text-decoration: none;
  font-size: 0.82rem;
  font-weight: 500;
  border-radius: 8px;
  transition: all 0.2s ease;
  white-space: nowrap;
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
}
.nav-item:hover {
  color: #fff;
  background: rgba(255,255,255,0.1);
}
.nav-item.router-link-active, .nav-item.router-link-exact-active {
  color: #fff;
  background: rgba(99,179,237,0.2);
  border-color: rgba(99,179,237,0.3);
}
.nav-divider {
  width: 1px;
  height: 24px;
  background: rgba(255,255,255,0.15);
  margin: 0 0.4rem;
}
.nav-dropdown { position: relative; }
.nav-more-btn {
  font-family: inherit;
}
.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08);
  min-width: 210px;
  padding: 0.4rem;
  z-index: 200;
  animation: dropIn 0.15s ease-out;
}
@keyframes dropIn {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  color: #4a5568;
  text-decoration: none;
  font-size: 0.84rem;
  font-weight: 500;
  border-radius: 8px;
  transition: all 0.15s;
}
.dropdown-item:hover {
  color: #2b6cb0;
  background: #ebf8ff;
  text-decoration: none;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}
.user-pill {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0.8rem 0.3rem 0.3rem;
  background: rgba(255,255,255,0.08);
  border-radius: 50px;
  border: 1px solid rgba(255,255,255,0.1);
}
.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #63b3ed, #4299e1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.5px;
}
.user-info {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.user-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: #fff;
}
.user-role {
  font-size: 0.65rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.role-platform_ops { color: #fbd38d; }
.role-host { color: #90cdf4; }
.role-guest { color: #a0aec0; }
.logout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.6);
  cursor: pointer;
  transition: all 0.2s;
}
.logout-btn:hover {
  background: rgba(229,62,62,0.2);
  border-color: rgba(229,62,62,0.4);
  color: #feb2b2;
}
.login-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1.1rem;
  background: linear-gradient(135deg, #4299e1, #3182ce);
  color: #fff;
  text-decoration: none;
  font-size: 0.82rem;
  font-weight: 600;
  border-radius: 8px;
  transition: all 0.2s;
  border: 1px solid rgba(255,255,255,0.15);
}
.login-btn:hover {
  background: linear-gradient(135deg, #63b3ed, #4299e1);
  text-decoration: none;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(66,153,225,0.3);
}
.app-main {
  min-height: calc(100vh - 60px - 44px);
  background: #f0f4f8;
}
.app-footer {
  background: #1a202c;
  color: rgba(255,255,255,0.4);
  text-align: center;
  padding: 0.75rem;
  font-size: 0.72rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  letter-spacing: 0.3px;
}
.footer-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(255,255,255,0.3);
}
</style>
