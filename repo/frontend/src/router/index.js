import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const routes = [
  { path: '/', redirect: '/search' },
  { path: '/search', name: 'TripSearch', component: () => import('../views/TripSearch.vue') },
  { path: '/login', name: 'Login', component: () => import('../views/LoginPage.vue') },
  {
    path: '/schedules', name: 'ScheduleList',
    component: () => import('../views/ScheduleList.vue'),
    meta: { requiresAuth: true, roles: ['host', 'platform_ops'] }
  },
  {
    path: '/schedules/new', name: 'ScheduleCreate',
    component: () => import('../views/ScheduleEditor.vue'),
    meta: { requiresAuth: true, roles: ['host', 'platform_ops'] }
  },
  {
    path: '/schedules/:id', name: 'ScheduleDetail',
    component: () => import('../views/ScheduleDetail.vue'),
    meta: { requiresAuth: true, roles: ['host', 'platform_ops'] }
  },
  {
    path: '/schedules/:id/edit', name: 'ScheduleEdit',
    component: () => import('../views/ScheduleEditor.vue'),
    meta: { requiresAuth: true, roles: ['host', 'platform_ops'] }
  },
  {
    path: '/inventory', name: 'InventoryDashboard',
    component: () => import('../views/InventoryDashboard.vue'),
    meta: { requiresAuth: true, roles: ['host', 'platform_ops'] }
  },
  {
    path: '/inventory/items', name: 'ItemList',
    component: () => import('../views/ItemList.vue'),
    meta: { requiresAuth: true, roles: ['host', 'platform_ops'] }
  },
  {
    path: '/inventory/movements', name: 'MovementList',
    component: () => import('../views/MovementList.vue'),
    meta: { requiresAuth: true, roles: ['host', 'platform_ops'] }
  },
  {
    path: '/inventory/stock-counts', name: 'StockCountList',
    component: () => import('../views/StockCountList.vue'),
    meta: { requiresAuth: true, roles: ['host', 'platform_ops'] }
  },
  {
    path: '/approvals', name: 'ApprovalList',
    component: () => import('../views/ApprovalList.vue'),
    meta: { requiresAuth: true, roles: ['platform_ops'] }
  },
  {
    path: '/audit', name: 'AuditLog',
    component: () => import('../views/AuditLog.vue'),
    meta: { requiresAuth: true, roles: ['platform_ops'] }
  },
  {
    path: '/admin/users', name: 'UserManagement',
    component: () => import('../views/UserManagement.vue'),
    meta: { requiresAuth: true, roles: ['platform_ops'] }
  },
  {
    path: '/backups', name: 'BackupDashboard',
    component: () => import('../views/BackupDashboard.vue'),
    meta: { requiresAuth: true, roles: ['platform_ops'] }
  },
  {
    path: '/data-quality', name: 'DataQuality',
    component: () => import('../views/DataQuality.vue'),
    meta: { requiresAuth: true, roles: ['platform_ops'] }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to, from, next) => {
  const auth = useAuthStore();
  // On first navigation or when user is unknown, check server session via cookie
  if (!auth.user) {
    await auth.checkSession();
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return next({ name: 'Login', query: { redirect: to.fullPath } });
  }
  if (to.meta.roles && !to.meta.roles.includes(auth.role)) {
    return next('/search');
  }
  next();
});

export default router;
