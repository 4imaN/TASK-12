<template>
  <div class="search-page">
    <!-- Hero Section -->
    <div class="search-hero">
      <div class="hero-bg">
        <div class="train-scene">
          <!-- Rails -->
          <svg class="train-svg" viewBox="0 0 1200 200" preserveAspectRatio="none">
            <!-- Track bed -->
            <rect x="0" y="155" width="1200" height="4" fill="rgba(255,255,255,0.08)" rx="2"/>
            <rect x="0" y="165" width="1200" height="4" fill="rgba(255,255,255,0.08)" rx="2"/>
            <!-- Ties -->
            <g fill="rgba(255,255,255,0.04)">
              <rect v-for="i in 30" :key="i" :x="i * 40" y="148" width="8" height="28" rx="1"/>
            </g>
            <!-- Train silhouette -->
            <g class="train-silhouette" fill="rgba(255,255,255,0.06)">
              <rect x="100" y="100" width="280" height="52" rx="8"/>
              <rect x="82" y="108" width="30" height="38" rx="12"/>
              <rect x="380" y="105" width="180" height="47" rx="6"/>
              <rect x="560" y="105" width="180" height="47" rx="6"/>
              <rect x="740" y="105" width="180" height="47" rx="6"/>
              <!-- Windows -->
              <rect x="130" y="112" width="20" height="14" rx="3" fill="rgba(99,179,237,0.12)"/>
              <rect x="160" y="112" width="20" height="14" rx="3" fill="rgba(99,179,237,0.12)"/>
              <rect x="200" y="112" width="20" height="14" rx="3" fill="rgba(99,179,237,0.1)"/>
              <rect x="240" y="112" width="20" height="14" rx="3" fill="rgba(99,179,237,0.08)"/>
              <rect x="280" y="112" width="20" height="14" rx="3" fill="rgba(99,179,237,0.08)"/>
              <rect x="320" y="112" width="20" height="14" rx="3" fill="rgba(99,179,237,0.06)"/>
              <rect x="400" y="115" width="16" height="12" rx="2" fill="rgba(99,179,237,0.08)"/>
              <rect x="425" y="115" width="16" height="12" rx="2" fill="rgba(99,179,237,0.08)"/>
              <rect x="450" y="115" width="16" height="12" rx="2" fill="rgba(99,179,237,0.06)"/>
              <rect x="475" y="115" width="16" height="12" rx="2" fill="rgba(99,179,237,0.06)"/>
              <rect x="500" y="115" width="16" height="12" rx="2" fill="rgba(99,179,237,0.05)"/>
              <rect x="525" y="115" width="16" height="12" rx="2" fill="rgba(99,179,237,0.05)"/>
              <!-- Wheels -->
              <circle cx="150" cy="155" r="8" fill="rgba(255,255,255,0.08)"/>
              <circle cx="200" cy="155" r="8" fill="rgba(255,255,255,0.08)"/>
              <circle cx="320" cy="155" r="8" fill="rgba(255,255,255,0.08)"/>
              <circle cx="370" cy="155" r="8" fill="rgba(255,255,255,0.07)"/>
              <circle cx="430" cy="155" r="7" fill="rgba(255,255,255,0.06)"/>
              <circle cx="530" cy="155" r="7" fill="rgba(255,255,255,0.06)"/>
              <circle cx="610" cy="155" r="7" fill="rgba(255,255,255,0.05)"/>
              <circle cx="710" cy="155" r="7" fill="rgba(255,255,255,0.05)"/>
              <circle cx="810" cy="155" r="7" fill="rgba(255,255,255,0.04)"/>
              <circle cx="880" cy="155" r="7" fill="rgba(255,255,255,0.04)"/>
            </g>
            <!-- Headlight glow -->
            <ellipse cx="82" cy="125" rx="40" ry="20" fill="rgba(99,179,237,0.04)"/>
          </svg>
        </div>
      </div>
      <div class="hero-content">
        <h1>Find Your Train</h1>
        <p>Search published rail schedules across the network</p>

        <div class="search-card">
          <form @submit.prevent="doSearch" class="search-form">
            <div class="search-fields">
              <div class="field-group origin-field">
                <label>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="10" stroke-dasharray="4 4"/></svg>
                  From
                </label>
                <StationAutocomplete v-model="filters.origin" placeholder="Origin station" @select="s => filters.originId = s.id" />
              </div>

              <button type="button" class="swap-btn" @click="swapStations" title="Swap">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              </button>

              <div class="field-group dest-field">
                <label>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  To
                </label>
                <StationAutocomplete v-model="filters.destination" placeholder="Destination station" @select="s => filters.destinationId = s.id" />
              </div>

              <div class="field-group date-field">
                <label>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Date
                </label>
                <input v-model="filters.date" type="text" class="form-control" placeholder="MM/DD/YYYY" />
              </div>

              <div class="field-group class-field">
                <label>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                  Class
                </label>
                <select v-model="filters.seatClass" class="form-control">
                  <option value="">Any</option>
                  <option value="economy">Economy</option>
                  <option value="business">Business</option>
                  <option value="first">First Class</option>
                </select>
              </div>

              <button type="submit" class="search-btn" :disabled="searchStore.loading">
                <span v-if="searchStore.loading" class="spinner"></span>
                <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </button>
            </div>
          </form>

          <div class="sort-bar">
            <span class="sort-label">Sort by</span>
            <button v-for="opt in sortOptions" :key="opt.value"
              :class="['sort-chip', { active: filters.sort === opt.value }]"
              @click="filters.sort = opt.value; sortResults()">
              {{ opt.label }}
            </button>
            <button class="sort-chip order-chip" @click="toggleOrder(); sortResults()">
              {{ filters.order === 'asc' ? '↑' : '↓' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="results-section">
      <div class="results-container">

        <!-- Hot Searches -->
        <div v-if="!searchStore.results.length && searchStore.hotSearches.length && !searchStore.loading && !searched" class="hot-section">
          <h3>Popular Routes</h3>
          <div class="hot-chips">
            <button v-for="hs in searchStore.hotSearches" :key="hs.id" class="hot-chip" @click="applyHotSearch(hs)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              {{ hs.origin }} → {{ hs.destination }}
            </button>
          </div>
        </div>

        <!-- Loading -->
        <div v-if="searchStore.loading" class="loading-state">
          <span class="spinner"></span> Searching trips...
        </div>

        <!-- Error -->
        <div v-if="searchStore.error && !searchStore.loading" class="alert alert-danger">
          {{ searchStore.error }}
        </div>

        <!-- Results -->
        <div v-else-if="searchStore.results.length" class="results-list">
          <div class="results-count">{{ searchStore.results.length }} trip{{ searchStore.results.length > 1 ? 's' : '' }} found</div>

          <div v-for="trip in searchStore.results" :key="trip.versionId" class="trip-card">
            <div class="trip-route">
              <div class="trip-endpoint">
                <div class="trip-time">{{ formatTime(trip.origin?.departureAt) }}</div>
                <div class="trip-station-name">{{ trip.origin?.stationName }}</div>
              </div>

              <div class="trip-journey">
                <div class="journey-line">
                  <div class="line-dot"></div>
                  <div class="line-track"></div>
                  <div class="line-label">{{ formatDuration(trip.durationMinutes) }}</div>
                  <div class="line-track"></div>
                  <div class="line-dot"></div>
                </div>
              </div>

              <div class="trip-endpoint trip-endpoint-right">
                <div class="trip-time">{{ formatTime(trip.destination?.arrivalAt) }}</div>
                <div class="trip-station-name">{{ trip.destination?.stationName }}</div>
              </div>

              <div class="trip-meta">
                <span class="trip-trainset">{{ trip.trainsetCode || trip.routeName }}</span>
              </div>
            </div>

            <div class="trip-fares">
              <div v-for="sc in trip.seatClasses" :key="sc.classCode" class="fare-chip"
                :class="{ unavailable: !sc.isAvailable }">
                <span class="fare-class">{{ sc.className }}</span>
                <span class="fare-price">${{ Number(sc.fare).toFixed(0) }}</span>
                <span class="fare-seats">{{ sc.isAvailable ? `${sc.capacity} left` : 'Full' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else-if="searched" class="empty-results">
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </div>
          <h3>No matches&mdash;try nearby dates</h3>
          <p>Try adjusting your filters or check nearby dates</p>
          <div v-if="searchStore.nearbySuggestions.length" class="nearby-section">
            <span class="nearby-label">Try these dates:</span>
            <div class="nearby-chips">
              <button v-for="date in searchStore.nearbySuggestions" :key="typeof date === 'object' ? date.date : date" class="nearby-chip" @click="searchNearbyDate(date)">
                {{ typeof date === 'object' ? date.date : date }}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useSearchStore } from '../stores/search.js';
import StationAutocomplete from '../components/StationAutocomplete.vue';

const searchStore = useSearchStore();
const searched = ref(false);

const filters = ref({
  origin: '', destination: '', date: '', seatClass: '',
  sort: 'departure', order: 'asc', originId: null, destinationId: null
});

const sortOptions = [
  { value: 'departure', label: 'Departure' },
  { value: 'duration', label: 'Duration' },
  { value: 'price', label: 'Price' }
];

function formatTime(dt) {
  if (!dt) return '--:--';
  return new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(mins) {
  if (!mins) return 'Direct';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function toggleOrder() {
  filters.value.order = filters.value.order === 'asc' ? 'desc' : 'asc';
}

function swapStations() {
  const tmp = filters.value.origin;
  filters.value.origin = filters.value.destination;
  filters.value.destination = tmp;
  const tmpId = filters.value.originId;
  filters.value.originId = filters.value.destinationId;
  filters.value.destinationId = tmpId;
}

async function doSearch() {
  if (filters.value.date && !/^\d{2}\/\d{2}\/\d{4}$/.test(filters.value.date)) {
    searchStore.error = 'Date must be in MM/DD/YYYY format';
    return;
  }
  searched.value = true;
  await searchStore.searchTrips(filters.value);
}

function sortResults() {
  if (!searchStore.results.length) return;
  const s = filters.value.sort;
  const desc = filters.value.order === 'desc';
  searchStore.results.sort((a, b) => {
    let cmp = 0;
    if (s === 'departure') {
      cmp = new Date(a.origin?.departureAt || 0) - new Date(b.origin?.departureAt || 0);
    } else if (s === 'duration') {
      cmp = (a.durationMinutes || 0) - (b.durationMinutes || 0);
    } else if (s === 'price') {
      const aMin = a.seatClasses?.length ? Math.min(...a.seatClasses.map(c => c.fare)) : Infinity;
      const bMin = b.seatClasses?.length ? Math.min(...b.seatClasses.map(c => c.fare)) : Infinity;
      cmp = aMin - bMin;
    }
    return desc ? -cmp : cmp;
  });
  // Trigger reactivity
  searchStore.results = [...searchStore.results];
}

function clearFilters() {
  filters.value = { origin: '', destination: '', date: '', seatClass: '', sort: 'departure', order: 'asc', originId: null, destinationId: null };
  searched.value = false;
  searchStore.results = [];
}

function applyHotSearch(hs) {
  filters.value.origin = hs.origin;
  filters.value.destination = hs.destination;
  doSearch();
}

function searchNearbyDate(date) {
  filters.value.date = typeof date === 'object' ? date.date : date;
  doSearch();
}

onMounted(() => searchStore.fetchHotSearches());
</script>

<style scoped>
.search-hero {
  position: relative;
  padding: 3rem 1.5rem 5rem;
  overflow: hidden;
}
.hero-bg {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, #0f2027 0%, #1a365d 50%, #2c5282 100%);
  overflow: hidden;
}
.hero-bg::after {
  content: '';
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 30% 60%, rgba(66,153,225,0.1) 0%, transparent 70%),
    radial-gradient(ellipse at 80% 30%, rgba(99,179,237,0.06) 0%, transparent 60%);
}
.train-scene {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 200px;
  pointer-events: none;
}
.train-svg {
  width: 100%;
  height: 100%;
}
.train-silhouette {
  animation: trainDrift 60s linear infinite;
}
@keyframes trainDrift {
  0% { transform: translateX(0); }
  50% { transform: translateX(20px); }
  100% { transform: translateX(0); }
}
.hero-content {
  position: relative; z-index: 1;
  max-width: 900px; margin: 0 auto; text-align: center;
}
.hero-content h1 {
  font-size: 2rem; font-weight: 800; color: #fff;
  letter-spacing: -0.5px; margin-bottom: 0.4rem;
}
.hero-content > p {
  color: rgba(255,255,255,0.6); font-size: 0.95rem; margin-bottom: 2rem;
}
.search-card {
  background: rgba(255,255,255,0.97);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  padding: 1.5rem;
}
.search-fields {
  display: flex; align-items: flex-end; gap: 0.5rem; flex-wrap: wrap;
}
.field-group {
  flex: 1; min-width: 140px;
}
.field-group label {
  display: flex; align-items: center; gap: 0.3rem;
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.5px; color: #718096; margin-bottom: 0.35rem;
}
.origin-field, .dest-field { min-width: 180px; }
.date-field { min-width: 130px; }
.class-field { min-width: 110px; }
.swap-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 50%; border: 1.5px solid #e2e8f0;
  background: #fff; color: #4a5568; cursor: pointer; margin-bottom: 2px;
  transition: all 0.2s; flex-shrink: 0;
}
.swap-btn:hover { background: #ebf8ff; border-color: #4299e1; color: #4299e1; }
.search-btn {
  display: flex; align-items: center; justify-content: center;
  width: 48px; height: 42px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #4299e1, #3182ce);
  color: #fff; cursor: pointer; flex-shrink: 0;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(66,153,225,0.3);
}
.search-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(66,153,225,0.4); }
.search-btn:disabled { opacity: 0.5; }
.sort-bar {
  display: flex; align-items: center; gap: 0.4rem; margin-top: 1rem;
  padding-top: 1rem; border-top: 1px solid #edf2f7;
}
.sort-label { font-size: 0.75rem; color: #a0aec0; font-weight: 600; margin-right: 0.25rem; }
.sort-chip {
  padding: 0.3rem 0.7rem; border-radius: 50px; border: 1px solid #e2e8f0;
  background: #fff; font-size: 0.75rem; font-weight: 600; color: #718096;
  cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.sort-chip:hover { border-color: #4299e1; color: #4299e1; }
.sort-chip.active { background: #ebf8ff; border-color: #4299e1; color: #2b6cb0; }
.order-chip { font-size: 0.85rem; padding: 0.25rem 0.5rem; }

.results-section { max-width: 900px; margin: -2rem auto 2rem; padding: 0 1.5rem; position: relative; z-index: 2; }
.results-count { font-size: 0.8rem; color: #718096; font-weight: 600; margin-bottom: 0.75rem; }

.trip-card {
  background: #fff; border-radius: 14px; padding: 1.25rem 1.5rem;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.03);
  margin-bottom: 0.75rem; border: 1px solid #edf2f7;
  transition: all 0.2s;
}
.trip-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-1px); }
.trip-route { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.trip-endpoint { min-width: 80px; }
.trip-endpoint-right { text-align: right; }
.trip-time { font-size: 1.35rem; font-weight: 800; color: #1a202c; letter-spacing: -0.5px; }
.trip-station-name { font-size: 0.78rem; color: #718096; font-weight: 500; }
.trip-journey { flex: 1; padding: 0 0.5rem; }
.journey-line {
  display: flex; align-items: center; gap: 0; position: relative;
}
.line-dot { width: 8px; height: 8px; border-radius: 50%; background: #4299e1; flex-shrink: 0; }
.line-track { flex: 1; height: 2px; background: #cbd5e0; position: relative; }
.line-track::after {
  content: ''; position: absolute; top: 0; left: 0; height: 100%;
  width: 100%; background: repeating-linear-gradient(90deg, #cbd5e0 0, #cbd5e0 6px, transparent 6px, transparent 10px);
}
.line-label {
  position: absolute; top: -18px; left: 50%; transform: translateX(-50%);
  font-size: 0.68rem; font-weight: 600; color: #a0aec0; white-space: nowrap;
  background: #fff; padding: 0 0.3rem;
}
.trip-meta { flex-shrink: 0; }
.trip-trainset {
  font-size: 0.7rem; font-weight: 600; color: #4a5568;
  background: #edf2f7; padding: 0.25rem 0.6rem; border-radius: 50px;
}
.trip-fares { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.fare-chip {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.5rem 0.85rem; background: #f7fafc; border: 1px solid #edf2f7;
  border-radius: 10px; font-size: 0.8rem; transition: all 0.15s;
}
.fare-chip:hover { border-color: #4299e1; }
.fare-chip.unavailable { opacity: 0.5; }
.fare-class { font-weight: 600; color: #4a5568; }
.fare-price { font-weight: 800; color: #2b6cb0; font-size: 0.95rem; }
.fare-seats { font-size: 0.7rem; color: #a0aec0; }

.hot-section { margin-bottom: 1.5rem; }
.hot-section h3 { font-size: 0.85rem; font-weight: 700; color: #4a5568; margin-bottom: 0.6rem; }
.hot-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.hot-chip {
  display: flex; align-items: center; gap: 0.3rem;
  padding: 0.4rem 0.8rem; border-radius: 50px; border: 1px solid #e2e8f0;
  background: #fff; font-size: 0.78rem; font-weight: 500; color: #4a5568;
  cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.hot-chip:hover { border-color: #4299e1; color: #2b6cb0; background: #ebf8ff; }

.empty-results { text-align: center; padding: 3rem 1rem; }
.empty-icon { color: #cbd5e0; margin-bottom: 1rem; }
.empty-results h3 { font-size: 1.15rem; color: #4a5568; margin-bottom: 0.3rem; }
.empty-results p { color: #a0aec0; font-size: 0.9rem; }
.nearby-section { margin-top: 1.5rem; }
.nearby-label { font-size: 0.8rem; font-weight: 600; color: #718096; display: block; margin-bottom: 0.5rem; }
.nearby-chips { display: flex; gap: 0.4rem; justify-content: center; flex-wrap: wrap; }
.nearby-chip {
  padding: 0.4rem 0.85rem; border-radius: 50px; border: 1px solid #e2e8f0;
  background: #fff; font-size: 0.8rem; font-weight: 600; color: #4299e1;
  cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.nearby-chip:hover { background: #ebf8ff; border-color: #4299e1; }
</style>
