<template>
  <div class="page">
    <div class="container">
      <div class="page-header">
        <h1>Approval Requests</h1>
        <p>Review and approve schedule publish requests</p>
      </div>

      <div v-if="loading" class="loading-state"><span class="spinner"></span> Loading...</div>

      <div v-else-if="error" class="alert alert-danger">
        Failed to load: {{ error }}
        <button class="btn btn-outline btn-sm" @click="load()">Retry</button>
      </div>

      <AlertBanner v-if="actionSuccess" type="success" :message="actionSuccess" @dismiss="actionSuccess = ''" />
      <AlertBanner v-if="actionError" type="danger" :message="actionError" @dismiss="actionError = ''" />

      <div v-if="!loading && !error && approvals.length" class="card">
        <div v-for="a in approvals" :key="a.id" class="approval-item">
          <div class="flex-between">
            <div>
              <strong>{{ a.schedule_name || `Schedule #${a.schedule_id}` }}</strong>
              — Version {{ a.version_number }}
              <StatusBadge :status="a.status" />
            </div>
            <div class="text-light" style="font-size:0.8rem">Requested {{ formatDt(a.requested_at) }} by {{ a.requested_by_name }}</div>
          </div>
          <div v-if="a.status === 'pending'" class="btn-group mt-1">
            <button class="btn btn-success btn-sm" @click="approve(a)" :disabled="approving[a.id]">
              <span v-if="approving[a.id]" class="spinner"></span> Approve
            </button>
            <button class="btn btn-danger btn-sm" @click="startReject(a)" :disabled="rejecting[a.id]">Reject</button>
          </div>
          <div v-if="a.status === 'rejected'" class="alert alert-danger mt-1">
            Rejected by {{ a.reviewed_by_name }}: {{ a.review_comment }}
          </div>
          <div v-if="a.status === 'approved'" class="alert alert-success mt-1">
            Approved by {{ a.reviewed_by_name }} on {{ formatDt(a.reviewed_at) }}
          </div>
        </div>
      </div>

      <div v-if="!loading && !error && !approvals.length" class="card empty-state">
        <h3>No pending approvals</h3>
        <p>All caught up!</p>
      </div>

      <!-- Reject Modal -->
      <div v-if="rejectTarget" class="modal-overlay" @click.self="rejectTarget = null">
        <div class="modal">
          <div class="modal-header">
            <h2>Reject Request</h2>
            <button class="modal-close" @click="rejectTarget = null">&times;</button>
          </div>
          <div class="form-group">
            <label>Rejection Comment (required)</label>
            <textarea v-model="rejectComment" class="form-control" required placeholder="Explain why this is being rejected..."></textarea>
          </div>
          <button class="btn btn-danger" @click="doReject" :disabled="!rejectComment.trim() || rejectingInProgress">
            <span v-if="rejectingInProgress" class="spinner"></span> Confirm Rejection
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { api } from '../utils/api.js';
import StatusBadge from '../components/StatusBadge.vue';
import AlertBanner from '../components/AlertBanner.vue';

const approvals = ref([]);
const loading = ref(true);
const error = ref('');
const rejectTarget = ref(null);
const rejectComment = ref('');
const approving = reactive({});
const rejecting = reactive({});
const rejectingInProgress = ref(false);
const actionSuccess = ref('');
const actionError = ref('');

function formatDt(dt) { return dt ? new Date(dt).toLocaleString() : '—'; }

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/approvals');
    approvals.value = res.data || [];
  } catch (e) {
    error.value = e.data?.error?.message || e.message || 'Failed to load approvals';
  } finally {
    loading.value = false;
  }
}

async function approve(a) {
  approving[a.id] = true;
  actionError.value = '';
  actionSuccess.value = '';
  try {
    await api.post(`/approvals/${a.id}/approve`);
    actionSuccess.value = `Approval #${a.id} approved successfully`;
    await load();
  } catch (e) {
    actionError.value = e.data?.error?.message || e.message || 'Approve failed';
  } finally {
    delete approving[a.id];
  }
}

function startReject(a) {
  rejectTarget.value = a;
  rejectComment.value = '';
}

async function doReject() {
  rejectingInProgress.value = true;
  const targetId = rejectTarget.value.id;
  rejecting[targetId] = true;
  actionError.value = '';
  actionSuccess.value = '';
  try {
    await api.post(`/approvals/${targetId}/reject`, { reviewComment: rejectComment.value });
    rejectTarget.value = null;
    actionSuccess.value = `Approval #${targetId} rejected`;
    await load();
  } catch (e) {
    actionError.value = e.data?.error?.message || e.message || 'Reject failed';
  } finally {
    delete rejecting[targetId];
    rejectingInProgress.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.approval-item { padding: 1rem 0; border-bottom: 1px solid var(--color-border); }
.approval-item:last-child { border-bottom: none; }
.text-light { color: var(--color-text-light); }
</style>
