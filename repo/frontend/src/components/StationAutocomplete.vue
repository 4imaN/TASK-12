<template>
  <div class="autocomplete" ref="wrapperRef">
    <div class="input-wrap" :class="{ 'has-selection': selectedStation }">
      <input
        type="text"
        class="form-control"
        :value="modelValue"
        :placeholder="placeholder"
        @input="onInput($event.target.value)"
        @focus="onFocus"
        @blur="onBlur"
        @keydown.down.prevent="highlightNext"
        @keydown.up.prevent="highlightPrev"
        @keydown.enter.prevent="selectHighlighted"
        @keydown.escape="showDropdown = false"
      />
      <span v-if="selectedStation" class="selected-code">{{ selectedStation.code }}</span>
      <button v-if="selectedStation" class="clear-btn" @mousedown.prevent="clearSelection" type="button">&times;</button>
    </div>

    <ul v-if="showDropdown && suggestions.length" class="autocomplete-list">
      <li
        v-for="(s, i) in suggestions" :key="s.id"
        :class="{ highlighted: i === highlightIndex }"
        @mousedown.prevent="selectStation(s)"
      >
        <span class="station-code">{{ s.code }}</span>
        <span class="station-name">{{ s.name }}</span>
        <span class="station-region">{{ s.region }}</span>
      </li>
    </ul>

    <ul v-else-if="showDropdown && searchQuery && !loading && !suggestions.length" class="autocomplete-list">
      <li class="no-results">No stations matching "{{ searchQuery }}"</li>
    </ul>

    <div v-if="showDropdown && loading" class="autocomplete-list">
      <li class="loading-item"><span class="spinner" style="width:14px;height:14px"></span> Searching...</li>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../utils/api.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Station name or code' },
  scope: { type: String, default: '' } // 'network' bypasses host station scoping for route authoring
});
const emit = defineEmits(['update:modelValue', 'select']);

const suggestions = ref([]);
const showDropdown = ref(false);
const highlightIndex = ref(-1);
const wrapperRef = ref(null);
const selectedStation = ref(null);
const searchQuery = ref('');
const loading = ref(false);
let debounceTimer = null;

async function fetchStations(query) {
  if (!query || query.length < 1) { suggestions.value = []; return; }
  loading.value = true;
  try {
    const scopeParam = props.scope ? `&scope=${encodeURIComponent(props.scope)}` : '';
    const res = await api.get(`/stations?q=${encodeURIComponent(query)}${scopeParam}`);
    // Handle both { data: [...] } and { data: { results: [...] } }
    const data = res.data;
    if (Array.isArray(data)) {
      suggestions.value = data;
    } else if (data && Array.isArray(data.results)) {
      suggestions.value = data.results;
    } else {
      suggestions.value = [];
    }
  } catch {
    suggestions.value = [];
  } finally {
    loading.value = false;
  }
}

function onInput(val) {
  emit('update:modelValue', val);
  searchQuery.value = val;
  selectedStation.value = null; // Clear selection when typing
  highlightIndex.value = -1;
  showDropdown.value = true;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fetchStations(val), 150);
}

function onFocus() {
  showDropdown.value = true;
  if (props.modelValue && !suggestions.value.length) {
    fetchStations(props.modelValue);
  }
}

function onBlur() {
  // Delay to allow click on dropdown item before closing
  setTimeout(() => {
    showDropdown.value = false;
    // No auto-select: require explicit selection from dropdown
  }, 200);
}

function selectStation(s) {
  selectedStation.value = s;
  searchQuery.value = s.name;
  emit('update:modelValue', s.name);
  emit('select', s);
  showDropdown.value = false;
  suggestions.value = [];
}

function clearSelection() {
  selectedStation.value = null;
  searchQuery.value = '';
  emit('update:modelValue', '');
  emit('select', null);
  suggestions.value = [];
}

function highlightNext() {
  if (suggestions.value.length === 0) return;
  highlightIndex.value = Math.min(highlightIndex.value + 1, suggestions.value.length - 1);
}

function highlightPrev() {
  highlightIndex.value = Math.max(highlightIndex.value - 1, 0);
}

function selectHighlighted() {
  if (highlightIndex.value >= 0 && suggestions.value[highlightIndex.value]) {
    selectStation(suggestions.value[highlightIndex.value]);
  } else if (suggestions.value.length > 0) {
    selectStation(suggestions.value[0]);
  }
}

function onClickOutside(e) {
  if (wrapperRef.value && !wrapperRef.value.contains(e.target)) {
    showDropdown.value = false;
  }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside));
</script>

<style scoped>
.autocomplete { position: relative; }
.input-wrap { position: relative; }
.input-wrap.has-selection .form-control {
  padding-right: 5.5rem;
  background: #f0f7ff;
  border-color: #90cdf4;
}
.selected-code {
  position: absolute; right: 2rem; top: 50%; transform: translateY(-50%);
  font-size: 0.7rem; font-weight: 700; color: #2b6cb0;
  background: #bee3f8; padding: 0.15rem 0.4rem; border-radius: 4px;
  letter-spacing: 0.5px;
}
.clear-btn {
  position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%);
  background: none; border: none; font-size: 1.1rem; color: #a0aec0;
  cursor: pointer; padding: 0 0.2rem; line-height: 1;
}
.clear-btn:hover { color: #e53e3e; }
.autocomplete-list {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50;
  background: #fff; border: 1px solid #e2e8f0;
  border-radius: 10px; list-style: none;
  max-height: 240px; overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  padding: 0.3rem;
}
.autocomplete-list li {
  padding: 0.55rem 0.75rem; cursor: pointer; font-size: 0.84rem;
  border-radius: 6px; display: flex; align-items: center; gap: 0.6rem;
  transition: background 0.1s;
}
.autocomplete-list li:hover, .autocomplete-list li.highlighted {
  background: #ebf8ff;
}
.station-code {
  font-size: 0.72rem; font-weight: 700; color: #2b6cb0;
  background: #e8f4fd; padding: 0.15rem 0.4rem; border-radius: 4px;
  min-width: 36px; text-align: center; letter-spacing: 0.5px;
}
.station-name { font-weight: 500; color: #2d3748; flex: 1; }
.station-region { font-size: 0.7rem; color: #a0aec0; }
.no-results {
  color: #a0aec0; font-style: italic; cursor: default;
  padding: 0.75rem !important;
}
.no-results:hover { background: transparent !important; }
.loading-item {
  display: flex; align-items: center; gap: 0.5rem;
  color: #a0aec0; cursor: default;
  padding: 0.75rem !important;
}
.loading-item:hover { background: transparent !important; }
</style>
