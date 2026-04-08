<template>
  <div class="page">
    <div class="container">
      <div class="page-header">
        <h1>Backup &amp; Recovery</h1>
        <p>Local backup management and restore drills</p>
      </div>

      <div v-if="loading" class="loading-state"><span class="spinner"></span> Loading...</div>

      <div v-else-if="error" class="alert alert-danger">
        Failed to load: {{ error }}
        <button class="btn btn-outline btn-sm" @click="load()">Retry</button>
      </div>

      <template v-else>
      <div class="grid grid-2 mb-2">
        <!-- Config -->
        <div class="card">
          <div class="card-header">Backup Configuration</div>
          <form @submit.prevent="saveConfig">
            <div class="form-group">
              <label>Backup Path (removable drive)</label>
              <input v-model="config.backup_path" type="text" class="form-control" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Full Backup Schedule (cron)</label>
                <input v-model="config.full_schedule" type="text" class="form-control" placeholder="0 2 * * *" />
              </div>
              <div class="form-group">
                <label>Incremental Interval (min)</label>
                <input v-model.number="config.incremental_interval_min" type="number" class="form-control" />
              </div>
            </div>
            <div class="form-group">
              <label>Retention (days)</label>
              <input v-model.number="config.retention_days" type="number" class="form-control" />
            </div>
            <button class="btn btn-primary btn-sm" type="submit">Save Config</button>
          </form>
        </div>

        <!-- Manual Backup -->
        <div class="card">
          <div class="card-header">Manual Backup</div>
          <p style="font-size:0.875rem;color:var(--color-text-light)">Trigger a full backup immediately.</p>
          <button class="btn btn-accent" @click="triggerBackup" :disabled="backupRunning">
            <span v-if="backupRunning" class="spinner"></span> Run Full Backup
          </button>
          <AlertBanner v-if="backupMsg" :type="backupOk ? 'success' : 'danger'" :message="backupMsg" class="mt-1" @dismiss="backupMsg = ''" />
        </div>
      </div>

      <!-- Backup History -->
      <div class="card mb-2">
        <div class="card-header">Backup History</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Size</th><th>Started</th><th>Completed</th><th>Checksum</th></tr></thead>
            <tbody>
              <tr v-for="b in backups" :key="b.id">
                <td>#{{ b.id }}</td>
                <td><span class="badge badge-draft">{{ b.backup_type }}</span></td>
                <td><StatusBadge :status="b.status === 'completed' ? 'published' : b.status === 'running' ? 'pending' : 'rejected'" :label="b.status" /></td>
                <td>{{ b.file_size ? formatSize(b.file_size) : '—' }}</td>
                <td>{{ formatDt(b.started_at) }}</td>
                <td>{{ b.completed_at ? formatDt(b.completed_at) : '—' }}</td>
                <td style="font-size:0.75rem">{{ b.checksum?.slice(0, 16) || '—' }}...</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!loading && !error && !backups.length" class="empty-state"><p>No backups recorded</p></div>
      </div>

      <!-- Restore Drills -->
      <div class="card">
        <div class="flex-between mb-1">
          <div class="card-header" style="margin-bottom:0">Restore Drills (Quarterly)</div>
          <button class="btn btn-accent btn-sm" @click="showDrillModal = true">Start Drill</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>ID</th><th>Backup</th><th>Status</th><th>Started</th><th>Completed</th><th>Report</th></tr></thead>
            <tbody>
              <tr v-for="d in drills" :key="d.id">
                <td>#{{ d.id }}</td>
                <td>Backup #{{ d.backup_id }}</td>
                <td><StatusBadge :status="d.status === 'passed' ? 'published' : d.status === 'running' ? 'pending' : 'rejected'" :label="d.status" /></td>
                <td>{{ formatDt(d.started_at) }}</td>
                <td>{{ d.completed_at ? formatDt(d.completed_at) : '—' }}</td>
                <td><button v-if="d.report" class="btn btn-outline btn-sm" @click="viewReport(d)">View</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!loading && !error && !drills.length" class="empty-state"><p>No restore drills recorded</p></div>
      </div>

      </template>

      <!-- Drill Modal -->
      <div v-if="showDrillModal" class="modal-overlay" @click.self="showDrillModal = false">
        <div class="modal">
          <div class="modal-header">
            <h2>Start Restore Drill</h2>
            <button class="modal-close" @click="showDrillModal = false">&times;</button>
          </div>
          <div class="form-group">
            <label>Select Backup to Restore</label>
            <select v-model="drillBackupId" class="form-control">
              <option value="">Select backup</option>
              <option v-for="b in backups.filter(b => b.status === 'completed')" :key="b.id" :value="b.id">
                #{{ b.id }} — {{ b.backup_type }} — {{ formatDt(b.started_at) }}
              </option>
            </select>
          </div>
          <button class="btn btn-accent" @click="startDrill" :disabled="!drillBackupId">Begin Drill</button>
        </div>
      </div>

      <!-- Report Modal -->
      <div v-if="reportData" class="modal-overlay" @click.self="reportData = null">
        <div class="modal">
          <div class="modal-header">
            <h2>Drill Report</h2>
            <button class="modal-close" @click="reportData = null">&times;</button>
          </div>
          <pre style="font-size:0.8rem;overflow-x:auto">{{ JSON.stringify(reportData, null, 2) }}</pre>
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

const config = ref({ backup_path: '/backups', full_schedule: '0 2 * * *', incremental_interval_min: 15, retention_days: 90 });
const backups = ref([]);
const drills = ref([]);
const loading = ref(true);
const error = ref('');
const backupRunning = ref(false);
const backupMsg = ref('');
const backupOk = ref(false);
const showDrillModal = ref(false);
const drillBackupId = ref('');
const reportData = ref(null);

function formatDt(dt) { return dt ? new Date(dt).toLocaleString() : '—'; }
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [cfgRes, bkRes, drRes] = await Promise.all([
      api.get('/backups/config'),
      api.get('/backups'),
      api.get('/restore-drills')
    ]);
    config.value = cfgRes.data || config.value;
    backups.value = bkRes.data?.results || (Array.isArray(bkRes.data) ? bkRes.data : []);
    drills.value = drRes.data?.results || (Array.isArray(drRes.data) ? drRes.data : []);
  } catch (e) {
    error.value = e.data?.error?.message || e.message || 'Failed to load backup data';
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  await api.patch('/backups/config', config.value);
}

async function triggerBackup() {
  backupRunning.value = true;
  backupMsg.value = '';
  try {
    await api.post('/backups/run');
    backupOk.value = true;
    backupMsg.value = 'Backup initiated successfully';
    await load();
  } catch (e) {
    backupOk.value = false;
    backupMsg.value = e.data?.error?.message || e.message;
  } finally {
    backupRunning.value = false;
  }
}

async function startDrill() {
  await api.post('/restore-drills', { backup_id: drillBackupId.value });
  showDrillModal.value = false;
  await load();
}

function viewReport(d) { reportData.value = d.report; }

onMounted(load);
</script>
