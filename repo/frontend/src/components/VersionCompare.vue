<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal" style="max-width: 1000px">
      <div class="modal-header">
        <h2>Version Comparison</h2>
        <button class="modal-close" @click="$emit('close')">&times;</button>
      </div>
      <div v-if="loading" class="loading-state"><span class="spinner"></span> Loading comparison...</div>
      <div v-else-if="diff" class="compare-grid">
        <div class="compare-header">
          <div class="compare-col"><strong>Version {{ diff.v1?.version_number }}</strong> <StatusBadge :status="diff.v1?.status || 'draft'" /></div>
          <div class="compare-col"><strong>Version {{ diff.v2?.version_number }}</strong> <StatusBadge :status="diff.v2?.status || 'draft'" /></div>
        </div>

        <!-- Trainset -->
        <div v-if="diff.changes?.trainset" class="compare-row diff-changed">
          <div class="compare-col">Trainset: {{ diff.v1?.trainset || 'None' }}</div>
          <div class="compare-col">Trainset: {{ diff.v2?.trainset || 'None' }}</div>
        </div>

        <!-- Stops -->
        <h4 class="mt-2 mb-1">Stops</h4>
        <div v-for="stop in diff.stops || []" :key="stop.key" class="compare-row" :class="diffClass(stop.change)">
          <div class="compare-col">
            <template v-if="stop.v1">{{ stop.v1.sequence }}. {{ stop.v1.station }} — Dep: {{ formatDt(stop.v1.departure_at) }}</template>
            <template v-else><em>—</em></template>
          </div>
          <div class="compare-col">
            <template v-if="stop.v2">{{ stop.v2.sequence }}. {{ stop.v2.station }} — Dep: {{ formatDt(stop.v2.departure_at) }}</template>
            <template v-else><em>—</em></template>
          </div>
        </div>

        <!-- Seat Classes -->
        <h4 class="mt-2 mb-1">Seat Classes</h4>
        <div v-for="sc in diff.seatClasses || []" :key="sc.key" class="compare-row" :class="diffClass(sc.change)">
          <div class="compare-col">
            <template v-if="sc.v1">{{ sc.v1.class_code }}: {{ sc.v1.capacity }} seats @ ${{ sc.v1.fare }}</template>
            <template v-else><em>—</em></template>
          </div>
          <div class="compare-col">
            <template v-if="sc.v2">{{ sc.v2.class_code }}: {{ sc.v2.capacity }} seats @ ${{ sc.v2.fare }}</template>
            <template v-else><em>—</em></template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useScheduleStore } from '../stores/schedules.js';
import StatusBadge from './StatusBadge.vue';

const props = defineProps({
  scheduleId: { type: [Number, String], required: true },
  versionId1: { type: [Number, String], required: true },
  versionId2: { type: [Number, String], required: true }
});
defineEmits(['close']);

const store = useScheduleStore();
const diff = ref(null);
const loading = ref(true);

function diffClass(change) {
  if (change === 'added') return 'diff-added';
  if (change === 'removed') return 'diff-removed';
  if (change === 'changed') return 'diff-changed';
  return '';
}

function formatDt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

onMounted(async () => {
  try {
    diff.value = await store.compareVersions(props.scheduleId, props.versionId1, props.versionId2);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.compare-grid { font-size: 0.875rem; }
.compare-header, .compare-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid var(--color-border); }
.compare-header { font-weight: 600; background: var(--color-bg); padding: 0.75rem 0.5rem; border-radius: var(--radius); }
.compare-col { padding: 0 0.5rem; }
</style>
