<template>
  <div class="page">
    <div class="container">
      <div class="flex-between page-header">
        <div><h1>Inventory Movements</h1></div>
        <button class="btn btn-primary" @click="showCreate = true">+ New Movement</button>
      </div>

      <!-- Filters -->
      <div class="card mb-2">
        <div class="form-row">
          <div class="form-group">
            <label>Type</label>
            <select v-model="typeFilter" class="form-control" @change="loadMovements">
              <option value="">All</option>
              <option value="receiving">Receiving</option>
              <option value="shipping">Shipping</option>
              <option value="material_return">Material Return</option>
              <option value="customer_return">Customer Return</option>
              <option value="adjustment">Adjustment</option>
            </select>
          </div>
        </div>
      </div>

      <div v-if="invStore.loading" class="loading-state"><span class="spinner"></span> Loading...</div>

      <div v-else class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Date</th><th>Type</th><th>Item</th><th>Qty</th><th>Direction</th><th>Batch/Serial</th><th>Performed By</th><th>Notes</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in invStore.movements" :key="m.id">
                <td>{{ formatDt(m.created_at) }}</td>
                <td><span class="badge" :class="typeBadge(m.movement_type)">{{ m.movement_type }}</span></td>
                <td>{{ m.item_name || m.item_id }}</td>
                <td><strong>{{ m.quantity }}</strong></td>
                <td>
                  <span :class="m.direction === 'in' ? 'stock-ok' : 'stock-critical'">
                    {{ m.direction === 'in' ? '↑ In' : '↓ Out' }}
                  </span>
                </td>
                <td>{{ m.batch_number || m.serial_numbers || '—' }}</td>
                <td>{{ m.performed_by_name || '—' }}</td>
                <td>{{ m.notes || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!invStore.movements.length" class="empty-state"><p>No movements found</p></div>
      </div>

      <!-- Create Modal -->
      <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
        <div class="modal">
          <div class="modal-header">
            <h2>New Movement</h2>
            <button class="modal-close" @click="showCreate = false">&times;</button>
          </div>
          <AlertBanner v-if="formError" type="danger" :message="formError" @dismiss="formError = ''" />
          <form @submit.prevent="submitMovement">
            <div class="form-row">
              <div class="form-group">
                <label>Type</label>
                <select v-model="movForm.movement_type" class="form-control" required>
                  <option value="receiving">Receiving</option>
                  <option value="shipping">Shipping</option>
                  <option value="material_return">Material Return</option>
                  <option value="customer_return">Customer Return</option>
                </select>
              </div>
              <div class="form-group">
                <label>Item</label>
                <select v-model="movForm.item_id" class="form-control" required>
                  <option value="">Select item</option>
                  <option v-for="item in invStore.items" :key="item.id" :value="item.id">{{ item.sku }} — {{ item.name }}</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Quantity</label>
                <input v-model.number="movForm.quantity" type="number" class="form-control" min="1" required />
              </div>
              <div class="form-group" v-if="selectedItemTracking === 'batch'">
                <label>Batch Number</label>
                <input v-model="movForm.batch_number" type="text" class="form-control" required />
              </div>
              <div class="form-group" v-if="selectedItemTracking === 'serial'">
                <label>Serial Numbers (comma-separated)</label>
                <input v-model="movForm.serial_numbers_raw" type="text" class="form-control" placeholder="SN001, SN002" required />
              </div>
            </div>
            <div class="form-group">
              <label>Reference Number</label>
              <input v-model="movForm.reference_number" type="text" class="form-control" />
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea v-model="movForm.notes" class="form-control"></textarea>
            </div>
            <button class="btn btn-primary" type="submit">Submit Movement</button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useInventoryStore } from '../stores/inventory.js';
import AlertBanner from '../components/AlertBanner.vue';

const invStore = useInventoryStore();
const showCreate = ref(false);
const typeFilter = ref('');
const formError = ref('');
const movForm = ref({ movement_type: 'receiving', item_id: '', quantity: 1, batch_number: '', serial_numbers_raw: '', reference_number: '', notes: '' });

const selectedItemTracking = computed(() => {
  const item = invStore.items.find(i => i.id === movForm.value.item_id);
  return item?.tracking_mode || 'none';
});

function typeBadge(type) {
  const map = { receiving: 'badge-approved', shipping: 'badge-pending', material_return: 'badge-draft', customer_return: 'badge-active', adjustment: 'badge-rejected' };
  return map[type] || 'badge-draft';
}

function formatDt(dt) { return dt ? new Date(dt).toLocaleString() : '—'; }

async function loadMovements() {
  const params = {};
  if (typeFilter.value) params.type = typeFilter.value;
  await invStore.fetchMovements(params);
}

async function submitMovement() {
  formError.value = '';
  try {
    const data = { ...movForm.value };
    if (data.serial_numbers_raw) {
      data.serial_numbers = data.serial_numbers_raw.split(',').map(s => s.trim()).filter(Boolean);
    }
    delete data.serial_numbers_raw;
    await invStore.createMovement(data);
    showCreate.value = false;
    movForm.value = { movement_type: 'receiving', item_id: '', quantity: 1, batch_number: '', serial_numbers_raw: '', reference_number: '', notes: '' };
    await loadMovements();
  } catch (e) {
    formError.value = e.data?.error?.message || e.message;
  }
}

onMounted(async () => {
  await Promise.all([invStore.fetchItems(), loadMovements()]);
});
</script>
