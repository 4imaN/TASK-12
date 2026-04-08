<template>
  <div class="page">
    <div class="container">
      <div v-if="store.loading" class="loading-state"><span class="spinner"></span> Loading...</div>
      <template v-else-if="schedule">
        <div class="flex-between page-header">
          <div>
            <h1>{{ schedule.route_name }}</h1>
            <p>Station: {{ schedule.station_name }} | Trainset: {{ schedule.trainset_code || 'None' }}</p>
          </div>
          <div class="btn-group">
            <router-link :to="`/schedules/${schedule.id}/edit`" class="btn btn-accent">Edit Draft</router-link>
          </div>
        </div>

        <!-- Active Version Banner -->
        <div v-if="schedule.active_version_id" class="alert alert-success mb-2">
          Active version: <strong>v{{ activeVersion?.version_number }}</strong>
          — effective since {{ formatDt(activeVersion?.effective_at) }}
        </div>

        <!-- Versions -->
        <div class="card mb-2">
          <div class="flex-between mb-1">
            <div class="card-header" style="margin-bottom:0">Version History</div>
            <div class="btn-group">
              <button v-if="compareV1 && compareV2" class="btn btn-outline btn-sm" @click="showCompare = true">
                Compare v{{ compareV1 }} vs v{{ compareV2 }}
              </button>
            </div>
          </div>

          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Compare</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Created By</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="v in store.versions" :key="v.id" :class="{ 'active-row': v.id === schedule.active_version_id }">
                  <td>
                    <input type="checkbox" :value="v.id" v-model="selectedForCompare"
                      :disabled="selectedForCompare.length >= 2 && !selectedForCompare.includes(v.id)" />
                  </td>
                  <td>
                    <strong>v{{ v.version_number }}</strong>
                    <span v-if="v.id === schedule.active_version_id" class="badge badge-active">Active</span>
                    <span v-if="v.rollback_source_version_id" class="badge badge-draft">Rollback</span>
                  </td>
                  <td><StatusBadge :status="v.status" /></td>
                  <td>{{ v.created_by_name || '—' }}</td>
                  <td>{{ formatDt(v.created_at) }}</td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-outline btn-sm" @click="viewVersion(v)">View</button>
                      <button v-if="v.status === 'draft'" class="btn btn-sm btn-accent" @click="validate(v)">Validate</button>
                      <button v-if="v.status === 'draft' && canPublishDirectly" class="btn btn-sm btn-success" @click="publish(v)" :disabled="!canPublishVersion(v)">
                        <span v-if="publishing" class="spinner"></span>
                        {{ validatedVersionId !== v.id ? 'Run validation first' : 'Publish' }}
                      </button>
                      <button v-if="v.status === 'draft' && canRequestApproval && !canPublishDirectly" class="btn btn-sm btn-warning" @click="requestApproval(v)" :disabled="!canRequestApprovalForVersion(v)">
                        <span v-if="requesting" class="spinner"></span>
                        {{ validatedVersionId !== v.id ? 'Run validation first' : 'Request Approval' }}
                      </button>
                      <span v-if="v.status === 'pending_approval'" class="badge badge-pending" style="padding:0.3rem 0.6rem">Awaiting Approval</span>
                      <span v-if="v.status === 'rejected'" class="badge badge-rejected" style="padding:0.3rem 0.6rem">Rejected — edit &amp; resubmit</span>
                      <span v-if="v.status === 'approved' && canPublishDirectly">
                        <button class="btn btn-sm btn-success" @click="publish(v)" :disabled="publishing">
                          <span v-if="publishing" class="spinner"></span> Publish Approved
                        </button>
                      </span>
                      <button v-if="v.status === 'published' && isPlatformOps" class="btn btn-sm btn-outline" @click="startRollback(v)">Rollback To</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Validation Results -->
        <AlertBanner v-if="validationMsg" :type="validationOk ? 'success' : 'danger'" :message="validationMsg" @dismiss="validationMsg = ''" />

        <!-- Inline validation checks -->
        <div v-if="validationChecks.length" class="card mb-2">
          <div class="card-header">Validation Checks</div>
          <ul class="checklist">
            <li v-for="(check, idx) in validationChecks" :key="idx" :class="check.passed ? 'check-pass' : 'check-fail'">
              {{ check.label }}
            </li>
          </ul>
        </div>

        <!-- Action Feedback -->
        <AlertBanner v-if="actionSuccess" type="success" :message="actionSuccess" @dismiss="actionSuccess = ''" />
        <AlertBanner v-if="actionError" type="danger" :message="actionError" @dismiss="actionError = ''" />

        <!-- Selected Version Detail -->
        <div v-if="selectedVersion" class="card mb-2">
          <div class="card-header">Version {{ selectedVersion.version_number }} Details</div>
          <h4 class="mb-1">Stops</h4>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>#</th><th>Station</th><th>Arrival</th><th>Departure</th><th>Platform</th></tr></thead>
              <tbody>
                <tr v-for="stop in selectedVersion.stops || []" :key="stop.id">
                  <td>{{ stop.stop_sequence }}</td>
                  <td>{{ stop.station_name || stop.station_id }}</td>
                  <td>{{ formatDt(stop.arrival_at) }}</td>
                  <td>{{ formatDt(stop.departure_at) }}</td>
                  <td>{{ stop.platform || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h4 class="mt-2 mb-1">Seat Classes</h4>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Capacity</th><th>Fare</th><th>Available</th></tr></thead>
              <tbody>
                <tr v-for="sc in selectedVersion.seat_classes || []" :key="sc.id">
                  <td>{{ sc.class_code }}</td>
                  <td>{{ sc.class_name }}</td>
                  <td>{{ sc.capacity }}</td>
                  <td>${{ Number(sc.fare).toFixed(2) }}</td>
                  <td><StatusBadge :status="sc.is_available ? 'published' : 'rejected'" :label="sc.is_available ? 'Yes' : 'No'" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Rollback Modal -->
        <div v-if="rollbackTarget" class="modal-overlay" @click.self="rollbackTarget = null">
          <div class="modal">
            <div class="modal-header">
              <h2>Rollback to v{{ rollbackTarget.version_number }}</h2>
              <button class="modal-close" @click="rollbackTarget = null">&times;</button>
            </div>
            <div class="form-group">
              <label>Reason for rollback</label>
              <textarea v-model="rollbackReason" class="form-control" required></textarea>
            </div>
            <button class="btn btn-danger" @click="doRollback" :disabled="!rollbackReason || rollingBack">
              <span v-if="rollingBack" class="spinner"></span> Confirm Rollback
            </button>
          </div>
        </div>

        <!-- Compare Modal -->
        <VersionCompare v-if="showCompare && compareV1 && compareV2"
          :scheduleId="schedule.id" :versionId1="compareV1" :versionId2="compareV2"
          @close="showCompare = false" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useScheduleStore } from '../stores/schedules.js';
import { useAuthStore } from '../stores/auth.js';
import StatusBadge from '../components/StatusBadge.vue';
import AlertBanner from '../components/AlertBanner.vue';
import VersionCompare from '../components/VersionCompare.vue';

const route = useRoute();
const store = useScheduleStore();
const auth = useAuthStore();

const schedule = computed(() => store.currentSchedule);
const selectedVersion = ref(null);
const selectedForCompare = ref([]);
const showCompare = ref(false);
const rollbackTarget = ref(null);
const rollbackReason = ref('');
const validationMsg = ref('');
const validationOk = ref(false);
const validatedVersionId = ref(null);
const validationChecks = ref([]);
const publishing = ref(false);
const requesting = ref(false);
const rollingBack = ref(false);
const actionSuccess = ref('');
const actionError = ref('');

const isPlatformOps = computed(() => auth.role === 'platform_ops');
const canPublishDirectly = computed(() => auth.role === 'platform_ops');
const canRequestApproval = computed(() => auth.role === 'host' || auth.role === 'platform_ops');

// Check if a version has a pending approval (blocks direct publish until resolved)
function versionHasPendingApproval(v) {
  return v.status === 'pending_approval';
}
function versionIsRejected(v) {
  return v.status === 'rejected';
}
// Publish is allowed when: validated + platform_ops + not pending_approval + not rejected
function canPublishVersion(v) {
  return canPublishDirectly.value && validatedVersionId.value === v.id && v.status === 'draft' && !publishing.value;
}
function canRequestApprovalForVersion(v) {
  return canRequestApproval.value && !canPublishDirectly.value && validatedVersionId.value === v.id && v.status === 'draft' && !requesting.value;
}

const compareV1 = computed(() => selectedForCompare.value[0] || null);
const compareV2 = computed(() => selectedForCompare.value[1] || null);
const activeVersion = computed(() => store.versions.find(v => v.id === schedule.value?.active_version_id));

function formatDt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

async function viewVersion(v) {
  selectedVersion.value = await store.fetchVersion(schedule.value.id, v.id);
}

async function validate(v) {
  const res = await store.validateVersion(schedule.value.id, v.id);
  if (res.valid) {
    validationOk.value = true;
    validatedVersionId.value = v.id;
    validationMsg.value = 'All pre-publish checks passed!';
    validationChecks.value = (res.checks || []).map(c => ({ label: c.label || c.name || c, passed: true }));
    if (!validationChecks.value.length) {
      validationChecks.value = [{ label: 'All pre-publish checks passed', passed: true }];
    }
  } else {
    validationOk.value = false;
    validatedVersionId.value = null;
    const errors = res.errors || [];
    validationMsg.value = errors.join('; ');
    validationChecks.value = errors.map(e => ({ label: e, passed: false }));
  }
}

async function publish(v) {
  publishing.value = true;
  actionError.value = '';
  actionSuccess.value = '';
  try {
    await store.publishVersion(schedule.value.id, v.id);
    actionSuccess.value = 'Version published successfully!';
    await reload();
  } catch (e) {
    actionError.value = e.data?.error?.message || e.message || 'Publish failed';
  } finally {
    publishing.value = false;
  }
}

async function requestApproval(v) {
  requesting.value = true;
  actionError.value = '';
  actionSuccess.value = '';
  try {
    await store.requestApproval(schedule.value.id, v.id);
    actionSuccess.value = 'Approval requested successfully!';
    await reload();
  } catch (e) {
    actionError.value = e.data?.error?.message || e.message || 'Request approval failed';
  } finally {
    requesting.value = false;
  }
}

function startRollback(v) {
  rollbackTarget.value = v;
  rollbackReason.value = '';
}

async function doRollback() {
  rollingBack.value = true;
  actionError.value = '';
  actionSuccess.value = '';
  try {
    await store.rollback(schedule.value.id, rollbackTarget.value.id, rollbackReason.value);
    rollbackTarget.value = null;
    actionSuccess.value = 'Rollback completed successfully!';
    await reload();
  } catch (e) {
    actionError.value = e.data?.error?.message || e.message || 'Rollback failed';
  } finally {
    rollingBack.value = false;
  }
}

async function reload() {
  await store.fetchSchedule(route.params.id);
  await store.fetchVersions(route.params.id);
}

watch(() => store.versions, () => {
  validatedVersionId.value = null;
  validationChecks.value = [];
}, { deep: true });

onMounted(reload);
</script>

<style scoped>
.active-row td { background: #f0fff4; }
.checklist { list-style: none; padding: 0; }
.checklist li { padding: 0.4rem 0; padding-left: 1.5rem; position: relative; font-size: 0.875rem; }
.checklist li::before { position: absolute; left: 0; font-size: 1rem; }
.check-pass { color: var(--color-success); }
.check-pass::before { content: '\2713'; }
.check-fail { color: var(--color-danger); }
.check-fail::before { content: '\2717'; }
</style>
