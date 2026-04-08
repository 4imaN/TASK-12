<template>
  <div v-if="show" class="alert" :class="'alert-' + type">
    <span>{{ message }}</span>
    <button v-if="dismissible" class="modal-close" @click="$emit('dismiss')">&times;</button>
  </div>
</template>

<script setup>
defineProps({
  type: { type: String, default: 'info' },
  message: { type: String, required: true },
  show: { type: Boolean, default: true },
  dismissible: { type: Boolean, default: true }
});
defineEmits(['dismiss']);
</script>
