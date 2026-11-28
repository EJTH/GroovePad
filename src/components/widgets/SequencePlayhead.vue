<script setup lang="ts">
import type { Ref } from 'vue'

defineProps<{
  source: { position: Readonly<Ref<number | undefined>> }
  steps: number
  stepWidth: number
}>()
</script>

<template>
  <div v-if="source.position.value !== undefined" class="sequence-playhead"
    :style="{ left: `calc(130px + ${source.position.value * steps * stepWidth}px)` }" aria-hidden="true"></div>
</template>

<style scoped>
.sequence-playhead { position: absolute; z-index: 1; top: 0; bottom: 0; width: 2px; background: #f3df8a; pointer-events: none; }
</style>
