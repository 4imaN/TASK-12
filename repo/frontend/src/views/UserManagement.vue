<template>
  <div class="page">
    <div class="container">
      <div class="flex-between page-header">
        <div><h1>User Management</h1></div>
        <button class="btn btn-primary" @click="showCreate = true">+ New User</button>
      </div>

      <div v-if="loading" class="loading-state"><span class="spinner"></span> Loading...</div>

      <div v-else class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Username</th><th>Display Name</th><th>Role</th><th>Stations</th><th>Status</th><th>Sessions</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td><strong>{{ u.username }}</strong></td>
                <td>{{ u.display_name || '—' }}</td>
                <td><StatusBadge :status="u.role" /></td>
                <td>
                  <template v-if="u.role === 'host'">
                    <span v-if="u.stations && u.stations.length" class="station-chips">
                      <span v-for="s in u.stations" :key="s.id" class="station-chip">{{ s.code }}</span>
                    </span>
                    <span v-else style="color:var(--color-danger);font-size:0.8rem">None assigned</span>
                  </template>
                  <template v-else><span style="color:var(--color-text-light);font-size:0.8rem">All (cross-site)</span></template>
                </td>
                <td><StatusBadge :status="u.is_active ? 'published' : 'rejected'" :label="u.is_active ? 'Active' : 'Disabled'" /></td>
                <td>{{ u.active_sessions || 0 }} / {{ u.max_sessions }}</td>
                <td>
                  <div class="btn-group">
                    <button class="btn btn-outline btn-sm" @click="editUser(u)">Edit</button>
                    <button v-if="u.role === 'host'" class="btn btn-accent btn-sm" @click="openStationAssign(u)">Stations</button>
                    <button class="btn btn-outline btn-sm" @click="viewSessions(u)">Sessions</button>
                    <button v-if="u.is_locked" class="btn btn-warning btn-sm" @click="unlockUser(u)">Unlock</button>
                    <button class="btn btn-outline btn-sm" @click="startSessionException(u)">Session Override</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create/Edit Modal -->
      <div v-if="showCreate || editingUser" class="modal-overlay" @click.self="closeModal">
        <div class="modal">
          <div class="modal-header">
            <h2>{{ editingUser ? 'Edit User' : 'Create User' }}</h2>
            <button class="modal-close" @click="closeModal">&times;</button>
          </div>
          <AlertBanner v-if="formError" type="danger" :message="formError" @dismiss="formError = ''" />
          <form @submit.prevent="saveUser">
            <div class="form-row">
              <div class="form-group">
                <label>Username</label>
                <input v-model="userForm.username" type="text" class="form-control" required :disabled="!!editingUser" />
              </div>
              <div class="form-group">
                <label>Display Name</label>
                <input v-model="userForm.display_name" type="text" class="form-control" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Role</label>
                <select v-model="userForm.role" class="form-control">
                  <option value="guest">Guest</option>
                  <option value="host">Host</option>
                  <option value="platform_ops">Platform Operations</option>
                </select>
              </div>
              <div class="form-group" v-if="!editingUser">
                <label>Password</label>
                <input v-model="userForm.password" type="password" class="form-control" required />
              </div>
            </div>
            <div class="form-group">
              <label>Phone (will be masked for non-Platform Ops)</label>
              <input v-model="userForm.phone" type="text" class="form-control" />
            </div>
            <button class="btn btn-primary" type="submit">{{ editingUser ? 'Update' : 'Create' }}</button>
          </form>
        </div>
      </div>

      <!-- Session Exception Modal -->
      <div v-if="exceptionTarget" class="modal-overlay" @click.self="exceptionTarget = null">
        <div class="modal">
          <div class="modal-header">
            <h2>Session Limit Override for {{ exceptionTarget.username }}</h2>
            <button class="modal-close" @click="exceptionTarget = null">&times;</button>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Max Sessions</label>
              <input v-model.number="exceptionForm.max_sessions" type="number" class="form-control" min="1" />
            </div>
            <div class="form-group">
              <label>Expires At (optional)</label>
              <input v-model="exceptionForm.expires_at" type="datetime-local" class="form-control" />
            </div>
          </div>
          <div class="form-group">
            <label>Reason</label>
            <textarea v-model="exceptionForm.reason" class="form-control" required></textarea>
          </div>
          <button class="btn btn-primary" @click="grantException" :disabled="!exceptionForm.reason">Grant Override</button>
        </div>
      </div>

      <!-- Sessions Modal -->
      <div v-if="sessionsTarget" class="modal-overlay" @click.self="sessionsTarget = null">
        <div class="modal">
          <div class="modal-header">
            <h2>Active Sessions — {{ sessionsTarget.username }}</h2>
            <button class="modal-close" @click="sessionsTarget = null">&times;</button>
          </div>
          <div v-if="!userSessions.length" class="empty-state"><p>No active sessions</p></div>
          <div v-else class="table-wrapper">
            <table>
              <thead><tr><th>Device</th><th>IP</th><th>Last Active</th><th>Expires</th><th></th></tr></thead>
              <tbody>
                <tr v-for="s in userSessions" :key="s.id">
                  <td>{{ s.device_fingerprint?.slice(0, 12) || '—' }}...</td>
                  <td>{{ s.ip_address }}</td>
                  <td>{{ formatDt(s.last_active_at) }}</td>
                  <td>{{ formatDt(s.expires_at) }}</td>
                  <td><button class="btn btn-danger btn-sm" @click="revokeSession(s)">Revoke</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <!-- Station Assignment Modal -->
      <div v-if="stationAssignTarget" class="modal-overlay" @click.self="stationAssignTarget = null">
        <div class="modal">
          <div class="modal-header">
            <h2>Station Assignments — {{ stationAssignTarget.username }}</h2>
            <button class="modal-close" @click="stationAssignTarget = null">&times;</button>
          </div>
          <p style="font-size:0.85rem;color:var(--color-text-light);margin-bottom:1rem">
            Select which stations this host can access. They will only see schedules and inventory for assigned stations.
          </p>
          <div v-if="allStationsLoading" class="loading-state"><span class="spinner"></span> Loading stations...</div>
          <div v-else class="station-grid">
            <label v-for="station in allStations" :key="station.id" class="station-checkbox"
              :class="{ checked: assignedStationIds.includes(station.id) }">
              <input type="checkbox" :value="station.id" v-model="assignedStationIds" />
              <span class="cb-code">{{ station.code }}</span>
              <span class="cb-name">{{ station.name }}</span>
              <span class="cb-region">{{ station.region }}</span>
            </label>
          </div>
          <div class="mt-2 btn-group">
            <button class="btn btn-primary" @click="saveStationAssignment">Save Assignments</button>
            <button class="btn btn-outline" @click="stationAssignTarget = null">Cancel</button>
          </div>
          <AlertBanner v-if="stationSaveMsg" type="success" :message="stationSaveMsg" class="mt-1" @dismiss="stationSaveMsg = ''" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../utils/api.js';
import StatusBadge from '../components/StatusBadge.vue';
import AlertBanner from '../components/AlertBanner.vue';

const users = ref([]);
const loading = ref(true);
const showCreate = ref(false);
const editingUser = ref(null);
const formError = ref('');
const userForm = ref({ username: '', display_name: '', role: 'host', password: '', phone: '' });
const exceptionTarget = ref(null);
const exceptionForm = ref({ max_sessions: 5, expires_at: '', reason: '' });
const sessionsTarget = ref(null);
const userSessions = ref([]);
const stationAssignTarget = ref(null);
const allStations = ref([]);
const allStationsLoading = ref(false);
const assignedStationIds = ref([]);
const stationSaveMsg = ref('');

function formatDt(dt) { return dt ? new Date(dt).toLocaleString() : '—'; }

async function load() {
  loading.value = true;
  try {
    const res = await api.get('/users');
    const d = res.data;
    const rawUsers = (d?.results && Array.isArray(d.results)) ? d.results : (Array.isArray(d) ? d : []);
    // Load station assignments for each user
    for (const u of rawUsers) {
      if (u.role === 'host') {
        try {
          const sRes = await api.get(`/users/${u.id}/stations`);
          u.stations = sRes.data || [];
        } catch { u.stations = []; }
      }
    }
    users.value = rawUsers;
  } finally {
    loading.value = false;
  }
}

async function loadAllStations() {
  if (allStations.value.length) return;
  allStationsLoading.value = true;
  try {
    const res = await api.get('/stations');
    const data = res.data;
    allStations.value = Array.isArray(data) ? data : (data?.results || []);
  } catch { allStations.value = []; }
  finally { allStationsLoading.value = false; }
}

async function openStationAssign(u) {
  stationAssignTarget.value = u;
  stationSaveMsg.value = '';
  await loadAllStations();
  assignedStationIds.value = (u.stations || []).map(s => s.id);
}

async function saveStationAssignment() {
  try {
    await api.put(`/users/${stationAssignTarget.value.id}/stations`, { station_ids: assignedStationIds.value });
    stationSaveMsg.value = 'Stations updated successfully!';
    await load();
    setTimeout(() => { stationAssignTarget.value = null; }, 1000);
  } catch (e) {
    stationSaveMsg.value = '';
    alert(e.data?.error?.message || e.message);
  }
}

function editUser(u) {
  editingUser.value = u;
  userForm.value = { username: u.username, display_name: u.display_name || '', role: u.role, phone: '' };
}

function closeModal() {
  showCreate.value = false;
  editingUser.value = null;
  formError.value = '';
  userForm.value = { username: '', display_name: '', role: 'host', password: '', phone: '' };
}

async function saveUser() {
  formError.value = '';
  try {
    if (editingUser.value) {
      await api.patch(`/users/${editingUser.value.id}`, userForm.value);
    } else {
      await api.post('/users', userForm.value);
    }
    closeModal();
    await load();
  } catch (e) {
    formError.value = e.data?.error?.message || e.message;
  }
}

async function unlockUser(u) {
  await api.post(`/users/${u.id}/unlock`);
  await load();
}

function startSessionException(u) {
  exceptionTarget.value = u;
  exceptionForm.value = { max_sessions: 5, expires_at: '', reason: '' };
}

async function grantException() {
  await api.post(`/users/${exceptionTarget.value.id}/session-exception`, exceptionForm.value);
  exceptionTarget.value = null;
  await load();
}

async function viewSessions(u) {
  sessionsTarget.value = u;
  try {
    const res = await api.get(`/users/${u.id}/sessions`);
    userSessions.value = res.data?.sessions || res.data || [];
  } catch {
    userSessions.value = [];
  }
}

async function revokeSession(s) {
  await api.delete(`/users/${sessionsTarget.value.id}/sessions/${s.id}`);
  await viewSessions(sessionsTarget.value);
}

onMounted(load);
</script>

<style scoped>
.station-chips { display: flex; gap: 0.3rem; flex-wrap: wrap; }
.station-chip {
  font-size: 0.7rem; font-weight: 700; color: #2b6cb0;
  background: #e8f4fd; padding: 0.15rem 0.45rem; border-radius: 4px;
  letter-spacing: 0.5px;
}
.station-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.4rem; max-height: 400px; overflow-y: auto; padding: 0.25rem;
}
.station-checkbox {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.65rem; border: 1.5px solid #e2e8f0; border-radius: 8px;
  cursor: pointer; transition: all 0.15s; font-size: 0.84rem;
}
.station-checkbox:hover { border-color: #90cdf4; background: #f7fafc; }
.station-checkbox.checked { border-color: #4299e1; background: #ebf8ff; }
.station-checkbox input[type="checkbox"] { accent-color: #4299e1; }
.cb-code {
  font-size: 0.7rem; font-weight: 700; color: #2b6cb0;
  background: #bee3f8; padding: 0.1rem 0.35rem; border-radius: 3px;
  min-width: 32px; text-align: center;
}
.cb-name { font-weight: 500; color: #2d3748; flex: 1; }
.cb-region { font-size: 0.68rem; color: #a0aec0; }
</style>
