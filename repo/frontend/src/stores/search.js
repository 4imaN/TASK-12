import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../utils/api.js';
import { getCachedSearch, setCachedSearch, normalizeSearchKey } from '../utils/cache.js';

export const useSearchStore = defineStore('search', () => {
  const results = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const hotSearches = ref([]);
  const nearbySuggestions = ref([]);
  const lastFilters = ref({});

  async function searchTrips(filters) {
    loading.value = true;
    error.value = null;
    nearbySuggestions.value = [];
    lastFilters.value = filters;

    const cacheKey = normalizeSearchKey(filters);

    // Check cache first
    const cached = await getCachedSearch(cacheKey);
    if (cached) {
      results.value = cached.results || [];
      nearbySuggestions.value = cached.nearbySuggestions || [];
      loading.value = false;
      return;
    }

    try {
      const params = new URLSearchParams();
      if (filters.origin) params.set('origin', filters.origin);
      if (filters.destination) params.set('destination', filters.destination);
      if (filters.date) params.set('date', filters.date);
      if (filters.seatClass) params.set('seatClass', filters.seatClass);
      if (filters.sort) params.set('sort', filters.sort);
      if (filters.order) params.set('order', filters.order);

      const res = await api.get(`/trips/search?${params.toString()}`);
      results.value = res.data?.results || [];
      nearbySuggestions.value = res.data?.nearbySuggestions || [];

      // Cache the results
      await setCachedSearch(cacheKey, {
        results: results.value,
        nearbySuggestions: nearbySuggestions.value
      });
    } catch (e) {
      error.value = e.data?.error?.message || e.message;
      results.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function fetchHotSearches() {
    const CACHE_KEY = 'hot-searches';
    const HOT_SEARCHES_TTL = 10 * 60 * 1000; // 10 minutes

    // Try reading from cache first
    const cached = await getCachedSearch(CACHE_KEY);
    if (cached) {
      hotSearches.value = cached;
      return;
    }

    try {
      const res = await api.get('/trips/hot-searches');
      const data = res.data?.results || res.data || [];
      hotSearches.value = data;
      // Store in cache with 10-minute TTL
      await setCachedSearch(CACHE_KEY, data, HOT_SEARCHES_TTL);
    } catch {
      // On fetch failure, fall back to expired cached data if available
      try {
        const { openDB } = await import('idb');
        const db = await openDB('railops-cache', 1);
        const entry = await db.get('searches', CACHE_KEY);
        if (entry && entry.data) {
          hotSearches.value = entry.data;
          return;
        }
      } catch {
        // IndexedDB read failed too
      }
      hotSearches.value = [];
    }
  }

  return { results, loading, error, hotSearches, nearbySuggestions, lastFilters, searchTrips, fetchHotSearches };
});
