<script setup lang="ts">
import type { GridItem } from '../../grid'

defineProps<{
  item: Extract<GridItem, { type: 'sub-grid' }>
  original: Extract<GridItem, { type: 'sub-grid' }>
}>()
const emit = defineEmits<{ open: [] }>()
</script>

<template>
  <div class="sub-grid-control">
    <button type="button" class="subgrid-open" :aria-label="`Open ${item.label}`" @click="emit('open')">Open {{ item.label }}</button>
    <strong v-if="!original.settings.surfaceItemIds.length">{{ item.label }}</strong>
    <slot />
  </div>
</template>
