<script setup lang="ts">
import type { GridItem } from '../../grid'

defineProps<{ draft: Extract<GridItem, { type: 'sub-grid' }> }>()
const emit = defineEmits<{ open: [] }>()
</script>

<template>
  <h3>SubGrid</h3>
  <p>{{ draft.settings.layout.columns }} × {{ draft.settings.layout.rows }} nested grid · {{ draft.settings.layout.items.length }} controls</p>
  <div class="settings-actions"><button type="button" @click="emit('open')">Open SubGrid</button></div>
  <label>Exposed ports
    <input :value="draft.settings.exposedPorts.map((port) => port.name).join(', ')"
      readonly aria-label="Exposed SubGrid ports">
  </label>
</template>
