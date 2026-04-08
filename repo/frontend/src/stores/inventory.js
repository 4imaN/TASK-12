import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../utils/api.js';

export const useInventoryStore = defineStore('inventory', () => {
  const items = ref([]);
  const movements = ref([]);
  const stockCounts = ref([]);
  const alerts = ref([]);
  const loading = ref(false);
  const error = ref(null);

  // Normalize list responses: backend may return { results: [...] } or plain array
  function extractList(data) {
    if (data?.results && Array.isArray(data.results)) return data.results;
    if (Array.isArray(data)) return data;
    return [];
  }

  async function fetchItems() {
    loading.value = true;
    try {
      const res = await api.get('/inventory/items');
      items.value = extractList(res.data);
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function fetchItem(id) {
    const res = await api.get(`/inventory/items/${id}`);
    return res.data;
  }

  async function createItem(data) {
    const res = await api.post('/inventory/items', data);
    return res.data;
  }

  async function updateItem(id, data) {
    const res = await api.patch(`/inventory/items/${id}`, data);
    return res.data;
  }

  async function fetchMovements(params = {}) {
    loading.value = true;
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await api.get(`/inventory/movements${qs ? '?' + qs : ''}`);
      movements.value = extractList(res.data);
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function createMovement(data) {
    const res = await api.post('/inventory/movements', data);
    await fetchAlerts();
    return res.data;
  }

  async function fetchStockCounts() {
    loading.value = true;
    try {
      const res = await api.get('/inventory/stock-counts');
      stockCounts.value = extractList(res.data);
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function createStockCount(data) {
    const res = await api.post('/inventory/stock-counts', data);
    return res.data;
  }

  async function updateStockCount(id, data) {
    const res = await api.patch(`/inventory/stock-counts/${id}`, data);
    return res.data;
  }

  async function finalizeStockCount(id) {
    const res = await api.post(`/inventory/stock-counts/${id}/finalize`);
    await fetchAlerts();
    return res.data;
  }

  async function fetchAlerts() {
    try {
      const res = await api.get('/inventory/alerts');
      const d = res.data || {};
      if (Array.isArray(d)) {
        alerts.value = d;
      } else {
        alerts.value = [...(d.low_stock || []), ...(d.variance_alerts || d.variance || [])];
      }
    } catch {
      alerts.value = [];
    }
  }

  return {
    items, movements, stockCounts, alerts, loading, error,
    fetchItems, fetchItem, createItem, updateItem,
    fetchMovements, createMovement,
    fetchStockCounts, createStockCount, updateStockCount, finalizeStockCount,
    fetchAlerts
  };
});
