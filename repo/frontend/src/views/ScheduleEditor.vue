<template>
  <div class="page">
    <div class="container">
      <div class="page-header">
        <h1>{{ isEdit ? 'Edit Schedule' : 'New Schedule' }}</h1>
      </div>

      <AlertBanner v-if="error" type="danger" :message="error" @dismiss="error = ''" />
      <AlertBanner v-if="success" type="success" :message="success" @dismiss="success = ''" />

      <!-- Schedule Info -->
      <div class="card mb-2">
        <div class="card-header">Schedule Information</div>
        <div class="form-row">
          <div class="form-group">
            <label>Route Name</label>
            <input v-model="form.route_name" type="text" class="form-control" placeholder="e.g., Northeast Corridor Express" required />
          </div>
          <div class="form-group">
            <label>Station</label>
            <StationAutocomplete v-model="form.station_name" placeholder="Origin station" @select="s => form.station_id = s.id" />
          </div>
          <div class="form-group">
            <label>Trainset</label>
            <select v-model="form.trainset_id" class="form-control">
              <option value="">Select trainset</option>
              <option v-for="t in trainsets" :key="t.id" :value="t.id">{{ t.code }} — {{ t.name }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Stops -->
      <div class="card mb-2">
        <div class="flex-between mb-1">
          <div class="card-header" style="margin-bottom:0">Stops</div>
          <button class="btn btn-accent btn-sm" @click="addStop">+ Add Stop</button>
        </div>
        <div v-if="!form.stops.length" class="empty-state"><p>No stops added yet. Add at least one stop.</p></div>
        <div v-for="(stop, i) in form.stops" :key="i" class="stop-row card mb-1">
          <div class="flex-between mb-1">
            <strong>Stop {{ i + 1 }}</strong>
            <button class="btn btn-danger btn-sm" @click="removeStop(i)">Remove</button>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Station</label>
              <StationAutocomplete v-model="stop.station_name" scope="network" @select="s => stop.station_id = s.id" />
            </div>
            <div class="form-group">
              <label>Arrival</label>
              <input v-model="stop.arrival_at" type="datetime-local" class="form-control" />
            </div>
            <div class="form-group">
              <label>Departure</label>
              <input v-model="stop.departure_at" type="datetime-local" class="form-control" required />
            </div>
            <div class="form-group">
              <label>Platform</label>
              <input v-model="stop.platform" type="text" class="form-control" placeholder="e.g., 3A" />
            </div>
          </div>
        </div>
      </div>

      <!-- Seat Classes -->
      <div class="card mb-2">
        <div class="flex-between mb-1">
          <div class="card-header" style="margin-bottom:0">Seat Classes</div>
          <button class="btn btn-accent btn-sm" @click="addSeatClass">+ Add Class</button>
        </div>
        <div v-if="!form.seat_classes.length" class="empty-state"><p>No seat classes. Add at least one.</p></div>
        <div v-for="(sc, i) in form.seat_classes" :key="i" class="stop-row card mb-1">
          <div class="flex-between mb-1">
            <strong>{{ sc.class_name || 'New Class' }}</strong>
            <button class="btn btn-danger btn-sm" @click="removeSeatClass(i)">Remove</button>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Code</label>
              <input v-model="sc.class_code" type="text" class="form-control" placeholder="e.g., ECO" required />
            </div>
            <div class="form-group">
              <label>Name</label>
              <input v-model="sc.class_name" type="text" class="form-control" placeholder="Economy" required />
            </div>
            <div class="form-group">
              <label>Capacity (1-500)</label>
              <input v-model.number="sc.capacity" type="number" class="form-control" min="1" max="500" required />
              <small v-if="sc.capacity < 1 || sc.capacity > 500" style="color:var(--color-danger)">Must be 1–500</small>
            </div>
            <div class="form-group">
              <label>Fare ($1.00–$999.00)</label>
              <input v-model.number="sc.fare" type="number" class="form-control" min="1" max="999" step="0.01" required />
              <small v-if="sc.fare < 1 || sc.fare > 999" style="color:var(--color-danger)">Must be $1.00–$999.00</small>
            </div>
          </div>
        </div>
      </div>

      <!-- Checklist Preview -->
      <div class="card mb-2">
        <div class="card-header">Pre-Publish Checklist</div>
        <ul class="checklist">
          <li :class="form.stops.length >= 1 ? 'check-pass' : 'check-fail'">At least one stop</li>
          <li :class="timeSequenceValid ? 'check-pass' : 'check-fail'">Valid time sequence</li>
          <li :class="allCapacitiesValid ? 'check-pass' : 'check-fail'">All seat capacities 1–500</li>
          <li :class="allFaresValid ? 'check-pass' : 'check-fail'">All fares $1.00–$999.00</li>
          <li :class="form.seat_classes.length >= 1 ? 'check-pass' : 'check-fail'">At least one seat class</li>
          <li class="check-pass">No trainset overlap (verified on publish)</li>
        </ul>
      </div>

      <div class="btn-group">
        <button class="btn btn-primary" @click="saveDraft" :disabled="saving || !formValid">
          <span v-if="saving" class="spinner"></span> Save Draft
        </button>
        <router-link :to="isEdit ? `/schedules/${$route.params.id}` : '/schedules'" class="btn btn-outline">Cancel</router-link>
      </div>
      <p v-if="!formValid" class="form-hint" style="color:var(--color-danger);font-size:0.85rem;margin-top:0.5rem">
        Fill in required fields to save: route name, station, at least one stop with a departure time, valid time sequence, at least one seat class with capacity (1-500) and fare ($1-$999).
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useScheduleStore } from '../stores/schedules.js';
import { api } from '../utils/api.js';
import StationAutocomplete from '../components/StationAutocomplete.vue';
import AlertBanner from '../components/AlertBanner.vue';

const route = useRoute();
const router = useRouter();
const store = useScheduleStore();

const isEdit = computed(() => !!route.params.id);
const saving = ref(false);
const error = ref('');
const success = ref('');
const trainsets = ref([]);

const form = ref({
  route_name: '', station_id: null, station_name: '', trainset_id: '',
  stops: [],
  seat_classes: []
});

const timeSequenceValid = computed(() => {
  const stops = form.value.stops;
  if (stops.length < 2) return true;
  for (let i = 1; i < stops.length; i++) {
    if (!stops[i].departure_at || !stops[i - 1].departure_at) return false;
    if (new Date(stops[i].departure_at) <= new Date(stops[i - 1].departure_at)) return false;
  }
  return true;
});

const allCapacitiesValid = computed(() =>
  form.value.seat_classes.length > 0 && form.value.seat_classes.every(sc => sc.capacity >= 1 && sc.capacity <= 500)
);

const allFaresValid = computed(() =>
  form.value.seat_classes.length > 0 && form.value.seat_classes.every(sc => sc.fare >= 1 && sc.fare <= 999)
);

const formValid = computed(() => {
  const f = form.value;
  if (!f.route_name || !f.route_name.trim()) return false;
  if (!f.station_id) return false;
  if (!f.stops.length) return false;
  const hasStopWithDeparture = f.stops.some(s => s.departure_at && s.departure_at.trim());
  if (!hasStopWithDeparture) return false;
  if (!f.seat_classes.length) return false;
  if (!allCapacitiesValid.value) return false;
  if (!allFaresValid.value) return false;
  if (!timeSequenceValid.value) return false;
  return true;
});

function addStop() {
  form.value.stops.push({ station_id: null, station_name: '', arrival_at: '', departure_at: '', platform: '' });
}

function removeStop(i) { form.value.stops.splice(i, 1); }

function addSeatClass() {
  form.value.seat_classes.push({ class_code: '', class_name: '', capacity: 100, fare: 50 });
}

function removeSeatClass(i) { form.value.seat_classes.splice(i, 1); }

async function saveDraft() {
  if (!formValid.value) return;
  saving.value = true;
  error.value = '';
  try {
    if (isEdit.value) {
      // Update schedule-level fields (route, station, trainset) via PATCH
      await store.updateSchedule(route.params.id, {
        route_name: form.value.route_name,
        station_id: form.value.station_id,
        trainset_id: form.value.trainset_id || null
      });
      // Create new draft version for stops and seat classes
      await store.createVersion(route.params.id, {
        trainset_id: form.value.trainset_id || null,
        stops: form.value.stops,
        seat_classes: form.value.seat_classes
      });
      success.value = 'Draft version saved!';
      setTimeout(() => router.push(`/schedules/${route.params.id}`), 1000);
    } else {
      const created = await store.createSchedule({
        route_name: form.value.route_name,
        station_id: form.value.station_id,
        trainset_id: form.value.trainset_id || null,
        stops: form.value.stops,
        seat_classes: form.value.seat_classes
      });
      success.value = 'Schedule created!';
      setTimeout(() => router.push(`/schedules/${created.id}`), 1000);
    }
  } catch (e) {
    error.value = e.data?.error?.message || e.message;
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const res = await api.get('/trainsets');
    trainsets.value = res.data || [];
  } catch { /* ignore */ }

  if (isEdit.value) {
    const data = await store.fetchSchedule(route.params.id);
    if (data) {
      form.value.route_name = data.routeName || data.route_name || '';
      form.value.station_id = data.stationId || data.station_id;
      form.value.station_name = data.stationName || data.station_name || '';
      form.value.trainset_id = data.trainsetId || data.trainset_id || '';

      // Load the latest version's stops and seat classes so we don't start with empty arrays
      await store.fetchVersions(route.params.id);
      if (store.versions.length) {
        const activeVid = data.activeVersionId || data.active_version_id;
        const latestVersion = store.versions.find(v => v.id === activeVid)
          || store.versions[store.versions.length - 1];
        const versionDetail = await store.fetchVersion(route.params.id, latestVersion.id);
        if (versionDetail) {
          form.value.stops = (versionDetail.stops || []).map(s => ({
            station_id: s.stationId || s.station_id,
            station_name: s.stationName || s.station_name || '',
            arrival_at: s.arrivalAt || s.arrival_at || '',
            departure_at: s.departureAt || s.departure_at || '',
            platform: s.platform || ''
          }));
          form.value.seat_classes = (versionDetail.seatClasses || versionDetail.seat_classes || []).map(sc => ({
            class_code: sc.classCode || sc.class_code || '',
            class_name: sc.className || sc.class_name || '',
            capacity: sc.capacity,
            fare: sc.fare
          }));
        }
      }
    }
  }
});
</script>

<style scoped>
.stop-row { padding: 1rem; background: var(--color-bg); }
.checklist { list-style: none; padding: 0; }
.checklist li { padding: 0.4rem 0; padding-left: 1.5rem; position: relative; font-size: 0.875rem; }
.checklist li::before { position: absolute; left: 0; font-size: 1rem; }
.check-pass { color: var(--color-success); }
.check-pass::before { content: '✓'; }
.check-fail { color: var(--color-danger); }
.check-fail::before { content: '✗'; }
</style>
