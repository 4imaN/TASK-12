<template>
  <span class="badge" :class="'badge-' + status">{{ label || status }}</span>
</template>

<script setup>
defineProps({
  status: { type: String, required: true },
  label: { type: String, default: '' }
});
</script>
