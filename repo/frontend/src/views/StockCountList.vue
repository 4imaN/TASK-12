<template>
  <div class="page">
    <div class="container">
      <div class="flex-between page-header">
        <div><h1>Stock Counts</h1></div>
        <button class="btn btn-primary" @click="startNewCount">+ New Count</button>
      </div>

      <div v-if="invStore.loading" class="loading-state"><span class="spinner"></span> Loading...</div>

      <!-- Existing Counts -->
      <div class="card mb-2">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>ID</th><th>Station</th><th>Status</th><th>Counted By</th><th>Started</th><th>Finalized</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="sc in invStore.stockCounts" :key="sc.id">
                <td>#{{ sc.id }}</td>
                <td>{{ sc.station_name || sc.station_id }}</td>
                <td><StatusBadge :status="sc.status === 'finalized' ? 'published' : 'draft'" :label="sc.status" /></td>
                <td>{{ sc.counted_by_name || '—' }}</td>
                <td>{{ formatDt(sc.started_at) }}</td>
                <td>{{ sc.finalized_at ? formatDt(sc.finalized_at) : '—' }}</td>
                <td>
                  <button v-if="sc.status !== 'finalized' && sc.status !== 'cancelled'" class="btn btn-outline btn-sm" @click="openCount(sc)">Edit</button>
                  <button v-if="sc.status !== 'finalized' && sc.status !== 'cancelled'" class="btn btn-success btn-sm" @click="finalize(sc)">Finalize</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!invStore.stockCounts.length" class="empty-state"><p>No stock counts yet</p></div>
      </div>

      <!-- Count Entry Modal -->
      <div v-if="editingCount" class="modal-overlay" @click.self="editingCount = null">
        <div class="modal" style="max-width:900px">
          <div class="modal-header">
            <h2>Stock Count #{{ editingCount.id }}</h2>
            <button class="modal-close" @click="editingCount = null">&times;</button>
          </div>
          <AlertBanner v-if="countError" type="danger" :message="countError" @dismiss="countError = ''" />

          <div class="mb-2">
            <button class="btn btn-accent btn-sm" @click="addLine">+ Add Item Line</button>
          </div>

          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>Item</th><th>Book Qty</th><th>Counted Qty</th><th>Variance</th><th>Variance %</th><th>Cost Var</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="(line, i) in countLines" :key="i" :class="varianceClass(line)">
                  <td>
                    <select v-model="line.item_id" class="form-control" @change="fillBookQty(line)">
                      <option value="">Select item</option>
                      <option v-for="item in invStore.items" :key="item.id" :value="item.id">{{ item.sku }} — {{ item.name }}</option>
                    </select>
                  </td>
                  <td>{{ line.book_quantity }}</td>
                  <td><input v-model.number="line.counted_quantity" type="number" class="form-control" min="0" /></td>
                  <td :class="line.counted_quantity - line.book_quantity !== 0 ? 'stock-critical' : ''">
                    {{ line.counted_quantity - line.book_quantity }}
                  </td>
                  <td>{{ variancePct(line) }}%</td>
                  <td>${{ varianceCost(line) }}</td>
                  <td><button class="btn btn-danger btn-sm" @click="countLines.splice(i, 1)">X</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-2 btn-group">
            <button class="btn btn-primary" @click="saveCountLines">Save Lines</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useInventoryStore } from '../stores/inventory.js';
import { useAuthStore } from '../stores/auth.js';
import StatusBadge from '../components/StatusBadge.vue';
import AlertBanner from '../components/AlertBanner.vue';

const invStore = useInventoryStore();
const auth = useAuthStore();
const editingCount = ref(null);
const countLines = ref([]);
const countError = ref('');

function formatDt(dt) { return dt ? new Date(dt).toLocaleString() : '—'; }

function variancePct(line) {
  if (!line.book_quantity) return line.counted_quantity ? '100.0' : '0.0';
  return (Math.abs(line.counted_quantity - line.book_quantity) / line.book_quantity * 100).toFixed(1);
}

function varianceCost(line) {
  const item = invStore.items.find(i => i.id === line.item_id);
  const cost = item?.unit_cost || 0;
  return (Math.abs(line.counted_quantity - line.book_quantity) * cost).toFixed(2);
}

function varianceClass(line) {
  const pct = parseFloat(variancePct(line));
  const cost = parseFloat(varianceCost(line));
  if (pct > 2 || cost > 50) return 'variance-alert';
  return '';
}

function fillBookQty(line) {
  const item = invStore.items.find(i => i.id === line.item_id);
  line.book_quantity = item?.on_hand || 0;
}

function addLine() {
  countLines.value.push({ item_id: '', book_quantity: 0, counted_quantity: 0 });
}

async function startNewCount() {
  try {
    const stationId = auth.user?.assignedStationIds?.[0];
    if (!stationId && auth.role !== 'platform_ops') {
      countError.value = 'No station assigned. Contact administrator.';
      return;
    }
    const count = await invStore.createStockCount({ station_id: stationId || 1, notes: '' });
    editingCount.value = count;
    countLines.value = [];
    addLine();
    await invStore.fetchStockCounts();
  } catch (e) {
    countError.value = e.message;
  }
}

function openCount(sc) {
  editingCount.value = sc;
  countLines.value = (sc.lines || []).map(l => ({ ...l }));
  if (!countLines.value.length) addLine();
}

async function saveCountLines() {
  countError.value = '';
  try {
    await invStore.updateStockCount(editingCount.value.id, { lines: countLines.value });
    editingCount.value = null;
    await invStore.fetchStockCounts();
  } catch (e) {
    countError.value = e.data?.error?.message || e.message;
  }
}

async function finalize(sc) {
  if (!confirm('Finalize this count? Adjustments will be created for any variances.')) return;
  try {
    await invStore.finalizeStockCount(sc.id);
    await invStore.fetchStockCounts();
  } catch (e) {
    alert(e.data?.error?.message || e.message);
  }
}

onMounted(async () => {
  await Promise.all([invStore.fetchItems(), invStore.fetchStockCounts()]);
});
</script>

<style scoped>
.variance-alert td { background: #fff5f5; }
</style>
