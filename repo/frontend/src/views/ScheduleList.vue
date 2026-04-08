<template>
  <div class="page">
    <div class="container">
      <div class="flex-between page-header">
        <div>
          <h1>Schedules</h1>
          <p>Manage train schedules and versions</p>
        </div>
        <router-link to="/schedules/new" class="btn btn-primary">+ New Schedule</router-link>
      </div>

      <div class="card mb-2">
        <div class="form-row">
          <div class="form-group">
            <label>Filter by Status</label>
            <select v-model="statusFilter" class="form-control">
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="pending_approval">Pending Approval</option>
            </select>
          </div>
        </div>
      </div>

      <div v-if="store.loading" class="loading-state"><span class="spinner"></span> Loading schedules...</div>

      <div v-else-if="store.error" class="alert alert-danger">
        Failed to load schedules: {{ store.error }}
        <button class="btn btn-outline btn-sm" @click="store.fetchSchedules()">Retry</button>
      </div>

      <div v-else-if="filtered.length" class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Route Name</th>
                <th>Station</th>
                <th>Trainset</th>
                <th>Active Version</th>
                <th>Status</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in filtered" :key="s.id">
                <td><strong>{{ s.route_name }}</strong></td>
                <td>{{ s.station_name || '—' }}</td>
                <td>{{ s.trainset_code || '—' }}</td>
                <td>
                  <template v-if="s.active_version_number">
                    v{{ s.active_version_number }}
                    <span class="badge badge-active">Active</span>
                  </template>
                  <template v-else>—</template>
                </td>
                <td><StatusBadge :status="s.latest_status || 'draft'" /></td>
                <td>{{ formatDate(s.updated_at) }}</td>
                <td><router-link :to="`/schedules/${s.id}`" class="btn btn-outline btn-sm">View</router-link></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else class="card empty-state">
        <h3>No schedules found</h3>
        <p>Create your first schedule to get started.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useScheduleStore } from '../stores/schedules.js';
import StatusBadge from '../components/StatusBadge.vue';

const store = useScheduleStore();
const statusFilter = ref('');

const filtered = computed(() => {
  if (!statusFilter.value) return store.schedules;
  return store.schedules.filter(s => s.latest_status === statusFilter.value);
});

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString();
}

onMounted(() => store.fetchSchedules());
</script>
