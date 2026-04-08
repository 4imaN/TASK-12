<template>
  <div class="page">
    <div class="container">
      <div class="flex-between page-header">
        <div><h1>Inventory Items</h1></div>
        <button class="btn btn-primary" @click="showCreate = true">+ New Item</button>
      </div>

      <div v-if="invStore.loading" class="loading-state"><span class="spinner"></span> Loading...</div>

      <div v-else class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>SKU</th><th>Name</th><th>On-Hand</th><th>Reorder Point</th><th>Tracking</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="item in invStore.items" :key="item.id">
                <td><strong>{{ item.sku }}</strong></td>
                <td>{{ item.name }}</td>
                <td :class="stockClass(item)">{{ item.on_hand ?? '—' }}</td>
                <td>{{ item.reorder_point }}</td>
                <td><span class="badge badge-draft">{{ item.tracking_mode }}</span></td>
                <td><StatusBadge :status="item.is_active ? 'published' : 'archived'" :label="item.is_active ? 'Active' : 'Inactive'" /></td>
                <td><button class="btn btn-outline btn-sm" @click="editItem(item)">Edit</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create/Edit Modal -->
      <div v-if="showCreate || editingItem" class="modal-overlay" @click.self="closeModal">
        <div class="modal">
          <div class="modal-header">
            <h2>{{ editingItem ? 'Edit Item' : 'New Item' }}</h2>
            <button class="modal-close" @click="closeModal">&times;</button>
          </div>
          <AlertBanner v-if="formError" type="danger" :message="formError" @dismiss="formError = ''" />
          <form @submit.prevent="saveItem">
            <div class="form-row">
              <div class="form-group">
                <label>SKU</label>
                <input v-model="itemForm.sku" type="text" class="form-control" required :disabled="!!editingItem" />
              </div>
              <div class="form-group">
                <label>Name</label>
                <input v-model="itemForm.name" type="text" class="form-control" required />
              </div>
            </div>
            <div class="form-group" v-if="!editingItem">
              <label>Station</label>
              <select v-model="itemForm.station_id" class="form-control" required>
                <option value="">Select station</option>
                <option v-for="s in availableStations" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Unit</label>
                <input v-model="itemForm.unit" type="text" class="form-control" placeholder="unit" />
              </div>
              <div class="form-group">
                <label>Unit Cost ($)</label>
                <input v-model.number="itemForm.unit_cost" type="number" class="form-control" min="0" step="0.01" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Reorder Point</label>
                <input v-model.number="itemForm.reorder_point" type="number" class="form-control" min="0" />
              </div>
              <div class="form-group">
                <label>Tracking Mode</label>
                <select v-model="itemForm.tracking_mode" class="form-control">
                  <option value="none">None</option>
                  <option value="batch">Batch / Lot</option>
                  <option value="serial">Serial Number</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea v-model="itemForm.description" class="form-control"></textarea>
            </div>
            <button class="btn btn-primary" type="submit">{{ editingItem ? 'Update' : 'Create' }}</button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useInventoryStore } from '../stores/inventory.js';
import { useAuthStore } from '../stores/auth.js';
import { api } from '../utils/api.js';
import StatusBadge from '../components/StatusBadge.vue';
import AlertBanner from '../components/AlertBanner.vue';

const invStore = useInventoryStore();
const auth = useAuthStore();
const showCreate = ref(false);
const editingItem = ref(null);
const formError = ref('');
const stations = ref([]);
const itemForm = ref(defaultForm());

const availableStations = computed(() => {
  if (auth.isPlatformOps) return stations.value;
  const assignedIds = auth.user?.assignedStationIds || [];
  return stations.value.filter(s => assignedIds.includes(s.id));
});

function defaultStationId() {
  return auth.user?.assignedStationIds?.[0] || null;
}

function defaultForm() {
  return { sku: '', name: '', unit: 'unit', unit_cost: 0, reorder_point: 20, tracking_mode: 'none', description: '', station_id: defaultStationId() };
}

function stockClass(item) {
  if (item.on_hand == null) return '';
  if (item.on_hand <= 0) return 'stock-critical';
  if (item.on_hand < item.reorder_point) return 'stock-low';
  return 'stock-ok';
}

function editItem(item) {
  editingItem.value = item;
  itemForm.value = { ...item };
}

function closeModal() {
  showCreate.value = false;
  editingItem.value = null;
  itemForm.value = defaultForm();
  formError.value = '';
}

async function saveItem() {
  formError.value = '';
  if (!editingItem.value && !itemForm.value.station_id) {
    formError.value = 'Please select a station before creating an item.';
    return;
  }
  try {
    if (editingItem.value) {
      await invStore.updateItem(editingItem.value.id, itemForm.value);
    } else {
      await invStore.createItem(itemForm.value);
    }
    closeModal();
    await invStore.fetchItems();
  } catch (e) {
    formError.value = e.data?.error?.message || e.message;
  }
}

onMounted(async () => {
  invStore.fetchItems();
  try {
    const res = await api.get('/stations');
    stations.value = res.data?.results || (Array.isArray(res.data) ? res.data : []);
  } catch {
    // Fall back to empty — the user can still type a station if the API is unreachable
  }
});
</script>
