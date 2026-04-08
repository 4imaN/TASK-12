import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../utils/api.js';

export const useScheduleStore = defineStore('schedules', () => {
  const schedules = ref([]);
  const currentSchedule = ref(null);
  const versions = ref([]);
  const currentVersion = ref(null);
  const loading = ref(false);
  const error = ref(null);
  const validationResults = ref(null);
  const comparisonData = ref(null);

  async function fetchSchedules() {
    loading.value = true;
    try {
      const res = await api.get('/schedules');
      schedules.value = res.data || [];
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function fetchSchedule(id) {
    loading.value = true;
    try {
      const res = await api.get(`/schedules/${id}`);
      currentSchedule.value = res.data;
      return res.data;
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function fetchVersions(scheduleId) {
    try {
      const res = await api.get(`/schedules/${scheduleId}/versions`);
      versions.value = res.data || [];
    } catch (e) {
      error.value = e.message;
    }
  }

  async function fetchVersion(scheduleId, versionId) {
    try {
      const res = await api.get(`/schedules/${scheduleId}/versions/${versionId}`);
      currentVersion.value = res.data;
      return res.data;
    } catch (e) {
      error.value = e.message;
    }
  }

  async function createSchedule(data) {
    const res = await api.post('/schedules', data);
    return res.data;
  }

  async function updateSchedule(scheduleId, data) {
    const res = await api.patch(`/schedules/${scheduleId}`, data);
    return res.data;
  }

  async function createVersion(scheduleId, data) {
    const res = await api.post(`/schedules/${scheduleId}/versions`, data);
    return res.data;
  }

  async function updateVersion(scheduleId, versionId, data) {
    const res = await api.patch(`/schedules/${scheduleId}/versions/${versionId}`, data);
    return res.data;
  }

  async function addStop(scheduleId, versionId, data) {
    const res = await api.post(`/schedules/${scheduleId}/versions/${versionId}/stops`, data);
    return res.data;
  }

  async function updateStop(scheduleId, versionId, stopId, data) {
    return await api.patch(`/schedules/${scheduleId}/versions/${versionId}/stops/${stopId}`, data);
  }

  async function removeStop(scheduleId, versionId, stopId) {
    return await api.delete(`/schedules/${scheduleId}/versions/${versionId}/stops/${stopId}`);
  }

  async function addSeatClass(scheduleId, versionId, data) {
    const res = await api.post(`/schedules/${scheduleId}/versions/${versionId}/seat-classes`, data);
    return res.data;
  }

  async function updateSeatClass(scheduleId, versionId, classId, data) {
    return await api.patch(`/schedules/${scheduleId}/versions/${versionId}/seat-classes/${classId}`, data);
  }

  async function removeSeatClass(scheduleId, versionId, classId) {
    return await api.delete(`/schedules/${scheduleId}/versions/${versionId}/seat-classes/${classId}`);
  }

  async function validateVersion(scheduleId, versionId) {
    const res = await api.post(`/schedules/${scheduleId}/versions/${versionId}/validate`);
    validationResults.value = res.data;
    return res.data;
  }

  async function publishVersion(scheduleId, versionId) {
    return await api.post(`/schedules/${scheduleId}/versions/${versionId}/publish`);
  }

  async function requestApproval(scheduleId, versionId) {
    return await api.post(`/schedules/${scheduleId}/versions/${versionId}/request-approval`);
  }

  async function compareVersions(scheduleId, v1, v2) {
    const res = await api.get(`/schedules/${scheduleId}/versions/compare?v1=${v1}&v2=${v2}`);
    comparisonData.value = res.data;
    return res.data;
  }

  async function rollback(scheduleId, sourceVersionId, reason) {
    return await api.post(`/schedules/${scheduleId}/rollback`, { sourceVersionId, reason });
  }

  return {
    schedules, currentSchedule, versions, currentVersion, loading, error, validationResults, comparisonData,
    fetchSchedules, fetchSchedule, fetchVersions, fetchVersion,
    createSchedule, updateSchedule, createVersion, updateVersion,
    addStop, updateStop, removeStop,
    addSeatClass, updateSeatClass, removeSeatClass,
    validateVersion, publishVersion, requestApproval, compareVersions, rollback
  };
});
