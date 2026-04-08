<template>
  <div class="page">
    <div class="container">
      <div class="page-header">
        <h1>Audit Log</h1>
        <p>Security events, schedule changes, and inventory actions</p>
      </div>

      <!-- Filters -->
      <div class="card mb-2">
        <div class="form-row">
          <div class="form-group">
            <label>Action</label>
            <input v-model="filters.action" type="text" class="form-control" placeholder="e.g., login, publish, movement" />
          </div>
          <div class="form-group">
            <label>Entity Type</label>
            <input v-model="filters.entity_type" type="text" class="form-control" placeholder="e.g., schedule, inventory" />
          </div>
          <div class="form-group">
            <label>Actor</label>
            <input v-model="filters.actor" type="text" class="form-control" placeholder="Username" />
          </div>
          <div class="form-group">
            <label>From</label>
            <input v-model="filters.from" type="date" class="form-control" />
          </div>
          <div class="form-group">
            <label>To</label>
            <input v-model="filters.to" type="date" class="form-control" />
          </div>
        </div>
        <button class="btn btn-primary btn-sm" @click="load">Search</button>
      </div>

      <div v-if="loading" class="loading-state"><span class="spinner"></span> Loading...</div>

      <div v-else class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id">
                <td>{{ formatDt(log.created_at) }}</td>
                <td>{{ log.actor_username || '—' }}</td>
                <td><span class="badge badge-draft">{{ log.action }}</span></td>
                <td>{{ log.entity_type }} {{ log.entity_id ? '#' + log.entity_id : '' }}</td>
                <td>{{ log.ip_address || '—' }}</td>
                <td><button class="btn btn-outline btn-sm" @click="expandLog = expandLog === log.id ? null : log.id">{{ expandLog === log.id ? 'Hide' : 'Details' }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- Expanded detail -->
        <div v-for="log in logs" :key="'d'+log.id">
          <div v-if="expandLog === log.id" class="card mt-1" style="background:var(--color-bg)">
            <pre style="font-size:0.8rem;overflow-x:auto">{{ JSON.stringify(log.details, null, 2) }}</pre>
          </div>
        </div>
        <div v-if="!logs.length" class="empty-state"><p>No audit entries found</p></div>
      </div>

      <!-- Backtracking Section -->
      <div class="card mt-2">
        <div class="card-header">Point-in-Time Backtracking</div>
        <div class="form-row">
          <div class="form-group">
            <label>Entity Type</label>
            <select v-model="btForm.entity_type" class="form-control">
              <option value="schedule">Schedule</option>
              <option value="inventory_item">Inventory Item</option>
              <option value="inventory_movement">Inventory Movement</option>
            </select>
          </div>
          <div class="form-group">
            <label>Entity ID</label>
            <input v-model="btForm.entity_id" type="number" class="form-control" />
          </div>
          <div class="form-group">
            <label>From</label>
            <input v-model="btForm.from" type="datetime-local" class="form-control" />
          </div>
          <div class="form-group">
            <label>To</label>
            <input v-model="btForm.to" type="datetime-local" class="form-control" />
          </div>
        </div>
        <div class="btn-group">
          <button class="btn btn-accent btn-sm" @click="loadDiff">View Diff</button>
          <button class="btn btn-outline btn-sm" @click="loadReplay">Replay Events</button>
        </div>
        <div v-if="btResult" class="mt-2">
          <pre style="font-size:0.8rem;overflow-x:auto;background:var(--color-bg);padding:1rem;border-radius:var(--radius)">{{ JSON.stringify(btResult, null, 2) }}</pre>
        </div>
      </div>

      <!-- Corrective Action -->
      <div class="card mt-2">
        <div class="card-header">Document Corrective Action</div>
        <div class="form-row">
          <div class="form-group">
            <label>Entity Type</label>
            <input v-model="caForm.entity_type" type="text" class="form-control" />
          </div>
          <div class="form-group">
            <label>Entity ID</label>
            <input v-model.number="caForm.entity_id" type="number" class="form-control" />
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea v-model="caForm.description" class="form-control"></textarea>
        </div>
        <div class="form-group">
          <label>Action Taken</label>
          <textarea v-model="caForm.action_taken" class="form-control"></textarea>
        </div>
        <button class="btn btn-primary btn-sm" @click="submitCorrectiveAction" :disabled="!caForm.description || !caForm.action_taken">Submit</button>
        <AlertBanner v-if="caSuccess" type="success" message="Corrective action recorded" @dismiss="caSuccess = false" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../utils/api.js';
import AlertBanner from '../components/AlertBanner.vue';

const logs = ref([]);
const loading = ref(false);
const expandLog = ref(null);
const filters = ref({ action: '', entity_type: '', actor: '', from: '', to: '' });
const btForm = ref({ entity_type: 'schedule', entity_id: '', from: '', to: '' });
const btResult = ref(null);
const caForm = ref({ entity_type: '', entity_id: '', description: '', action_taken: '' });
const caSuccess = ref(false);

function formatDt(dt) { return dt ? new Date(dt).toLocaleString() : '—'; }

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    const keyMap = { actor: 'actor_username', from: 'date_from', to: 'date_to' };
    Object.entries(filters.value).forEach(([k, v]) => { if (v) params.set(keyMap[k] || k, v); });
    const res = await api.get(`/audit/logs?${params}`);
    logs.value = (res.data?.results) || (Array.isArray(res.data) ? res.data : []);
  } finally {
    loading.value = false;
  }
}

async function loadDiff() {
  const params = new URLSearchParams({ entity: btForm.value.entity_type, id: btForm.value.entity_id, from: btForm.value.from, to: btForm.value.to });
  const res = await api.get(`/backtrack/diff?${params}`);
  btResult.value = res.data;
}

async function loadReplay() {
  const params = new URLSearchParams({ entity: btForm.value.entity_type, id: btForm.value.entity_id, from: btForm.value.from, to: btForm.value.to });
  const res = await api.get(`/backtrack/replay?${params}`);
  btResult.value = res.data;
}

async function submitCorrectiveAction() {
  await api.post('/backtrack/corrective-actions', caForm.value);
  caSuccess.value = true;
  caForm.value = { entity_type: '', entity_id: '', description: '', action_taken: '' };
}

onMounted(load);
</script>
