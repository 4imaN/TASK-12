<template>
  <div class="page">
    <div class="container">
      <div class="page-header">
        <h1>Inventory Dashboard</h1>
        <p>Overview of onboard supply management</p>
      </div>

      <div class="grid grid-3 mb-2">
        <div class="card">
          <div class="card-header">Total Items</div>
          <div class="stat-value">{{ invStore.items.length }}</div>
          <router-link to="/inventory/items" class="btn btn-outline btn-sm mt-1">View Items</router-link>
        </div>
        <div class="card">
          <div class="card-header">Low Stock Alerts</div>
          <div class="stat-value stock-low">{{ lowStockCount }}</div>
          <router-link to="/inventory/items" class="btn btn-outline btn-sm mt-1">View Alerts</router-link>
        </div>
        <div class="card">
          <div class="card-header">Quick Actions</div>
          <div class="btn-group" style="flex-direction:column">
            <router-link to="/inventory/movements" class="btn btn-accent btn-sm">New Movement</router-link>
            <router-link to="/inventory/stock-counts" class="btn btn-outline btn-sm">Stock Count</router-link>
          </div>
        </div>
      </div>

      <!-- Recent Alerts -->
      <div class="card">
        <div class="card-header">Active Alerts</div>
        <div v-if="!invStore.alerts.length" class="empty-state"><p>No active alerts</p></div>
        <div v-else>
          <div v-for="alert in invStore.alerts" :key="alert.id" class="alert" :class="alert.type === 'low_stock' ? 'alert-warning' : 'alert-danger'">
            <strong>{{ alert.item_name || alert.sku }}</strong> —
            <template v-if="alert.type === 'low_stock'">
              On-hand ({{ alert.on_hand }}) below reorder point ({{ alert.reorder_point }})
            </template>
            <template v-else>
              Count variance: {{ alert.variance_quantity }} units / ${{ Number(alert.variance_cost || 0).toFixed(2) }}
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useInventoryStore } from '../stores/inventory.js';

const invStore = useInventoryStore();

const lowStockCount = computed(() => invStore.alerts.filter(a => a.type === 'low_stock').length);

onMounted(async () => {
  await Promise.all([invStore.fetchItems(), invStore.fetchAlerts()]);
});
</script>

<style scoped>
.stat-value { font-size: 2rem; font-weight: 700; color: var(--color-primary); }
</style>
