<template>
  <div class="page">
    <div class="container">
      <div class="page-header">
        <h1>Data Quality</h1>
        <p>Track data quality issues and reports</p>
      </div>

      <div v-if="loading" class="loading-state"><span class="spinner"></span> Loading...</div>

      <div v-else-if="error" class="alert alert-danger">
        Failed to load: {{ error }}
        <button class="btn btn-outline btn-sm" @click="load()">Retry</button>
      </div>

      <template v-else>
      <div class="grid grid-2 mb-2">
        <!-- Summary -->
        <div class="card">
          <div class="card-header">Issue Summary</div>
          <div class="grid grid-2">
            <div><span class="stat-label">Open</span><div class="stat-value">{{ openCount }}</div></div>
            <div><span class="stat-label">Critical</span><div class="stat-value stock-critical">{{ criticalCount }}</div></div>
          </div>
          <button class="btn btn-accent btn-sm mt-2" @click="generateReport">Generate Daily Report</button>
          <AlertBanner v-if="reportMsg" type="success" :message="reportMsg" class="mt-1" @dismiss="reportMsg = ''" />
        </div>

        <!-- Create Issue -->
        <div class="card">
          <div class="card-header">Log New Issue</div>
          <form @submit.prevent="createIssue">
            <div class="form-row">
              <div class="form-group">
                <label>Entity Type</label>
                <input v-model="issueForm.entity_type" type="text" class="form-control" required />
              </div>
              <div class="form-group">
                <label>Check Type</label>
                <select v-model="issueForm.check_type" class="form-control">
                  <option value="completeness">Completeness</option>
                  <option value="uniqueness">Uniqueness</option>
                  <option value="freshness">Freshness</option>
                  <option value="accuracy">Accuracy</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Severity</label>
                <select v-model="issueForm.severity" class="form-control">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div class="form-group">
                <label>Owner</label>
                <input v-model="issueForm.owner" type="text" class="form-control" />
              </div>
              <div class="form-group">
                <label>Due Date</label>
                <input v-model="issueForm.due_date" type="date" class="form-control" />
              </div>
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea v-model="issueForm.description" class="form-control" required></textarea>
            </div>
            <button class="btn btn-primary btn-sm" type="submit">Create Issue</button>
          </form>
        </div>
      </div>

      <!-- Issues List -->
      <div class="card mb-2">
        <div class="card-header">Data Quality Issues</div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>ID</th><th>Entity</th><th>Check</th><th>Severity</th><th>Status</th><th>Owner</th><th>Due</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="iss in issues" :key="iss.id">
                <td>#{{ iss.id }}</td>
                <td>{{ iss.entity_type }} {{ iss.entity_id ? '#' + iss.entity_id : '' }}</td>
                <td><span class="badge badge-draft">{{ iss.check_type }}</span></td>
                <td><span class="badge" :class="severityBadge(iss.severity)">{{ iss.severity }}</span></td>
                <td><StatusBadge :status="iss.status === 'resolved' ? 'published' : iss.status === 'open' ? 'pending' : 'draft'" :label="iss.status" /></td>
                <td>{{ iss.owner || '—' }}</td>
                <td>{{ iss.due_date || '—' }}</td>
                <td>
                  <select :value="iss.status" @change="updateStatus(iss, $event.target.value)" class="form-control" style="width:auto;font-size:0.8rem">
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="dismissed">Dismissed</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!loading && !error && !issues.length" class="empty-state"><p>No issues found</p></div>
      </div>

      <!-- Reports -->
      <div class="card">
        <div class="card-header">Daily Reports</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Date</th><th>Total Checks</th><th>Passed</th><th>Failed</th><th>Issues</th></tr></thead>
            <tbody>
              <tr v-for="r in reports" :key="r.id">
                <td>{{ r.report_date }}</td>
                <td>{{ r.total_checks }}</td>
                <td class="stock-ok">{{ r.passed_checks }}</td>
                <td class="stock-critical">{{ r.failed_checks }}</td>
                <td>{{ r.issues_found }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!loading && !error && !reports.length" class="empty-state"><p>No reports generated yet</p></div>
      </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../utils/api.js';
import StatusBadge from '../components/StatusBadge.vue';
import AlertBanner from '../components/AlertBanner.vue';

const issues = ref([]);
const reports = ref([]);
const loading = ref(true);
const error = ref('');
const reportMsg = ref('');
const issueForm = ref({ entity_type: '', entity_id: null, check_type: 'completeness', severity: 'medium', description: '', owner: '', due_date: '' });

const openCount = computed(() => issues.value.filter(i => i.status === 'open').length);
const criticalCount = computed(() => issues.value.filter(i => i.severity === 'critical' && i.status !== 'resolved').length);

function severityBadge(sev) {
  const m = { low: 'badge-draft', medium: 'badge-pending', high: 'badge-rejected', critical: 'badge-rejected' };
  return m[sev] || 'badge-draft';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [issRes, repRes] = await Promise.all([
      api.get('/data-quality/issues'),
      api.get('/data-quality/reports')
    ]);
    issues.value = issRes.data?.results || (Array.isArray(issRes.data) ? issRes.data : []);
    reports.value = repRes.data?.results || (Array.isArray(repRes.data) ? repRes.data : []);
  } catch (e) {
    error.value = e.data?.error?.message || e.message || 'Failed to load data quality information';
  } finally {
    loading.value = false;
  }
}

async function createIssue() {
  await api.post('/data-quality/issues', issueForm.value);
  issueForm.value = { entity_type: '', entity_id: null, check_type: 'completeness', severity: 'medium', description: '', owner: '', due_date: '' };
  await load();
}

async function updateStatus(iss, newStatus) {
  await api.patch(`/data-quality/issues/${iss.id}`, { status: newStatus });
  await load();
}

async function generateReport() {
  await api.post('/data-quality/reports/generate');
  reportMsg.value = 'Report generated successfully';
  await load();
}

onMounted(load);
</script>

<style scoped>
.stat-label { font-size: 0.8rem; color: var(--color-text-light); text-transform: uppercase; }
.stat-value { font-size: 1.5rem; font-weight: 700; color: var(--color-primary); }
</style>
