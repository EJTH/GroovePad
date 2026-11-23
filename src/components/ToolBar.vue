<script setup lang="ts">
import type { ToolMode, RepeatDivision } from '../grid'
defineProps<{ mode: ToolMode; division: RepeatDivision }>()
const emit = defineEmits<{ select: [mode: ToolMode]; division: [division: RepeatDivision] }>()
const tools: { mode: Exclude<ToolMode, null>; label: string; path: string }[] = [
  { mode: 'edit', label: 'Edit grid', path: 'M4 20l4-.8L19 8.2 15.8 5 4.8 16 4 20zM14.5 6.3l3.2 3.2M3 21h18' },
  { mode: 'wire', label: 'Wire controls', path: 'M3 6h4v4H3zM17 14h4v4h-4zM7 8h3c6 0 0 8 7 8' },
  { mode: 'volume', label: 'Volume mode', path: 'M3 9h4l5-4v14l-5-4H3zM15 9c2 2 2 4 0 6M18 6c4 4 4 8 0 12' },
  { mode: 'repeat', label: 'Note repeat', path: 'M4 8V4h4M4 4l4 4M20 16v4h-4M20 20l-4-4M5 15a7 7 0 0 0 12 3M19 9A7 7 0 0 0 7 6' },
]
const divisions: RepeatDivision[] = ['1/4', '1/8', '1/16', '1/32']
</script>

<template>
  <div class="tool-buttons" role="toolbar" aria-label="Tools">
    <button v-for="tool in tools" :key="tool.mode" class="icon-button" type="button"
      :aria-label="tool.label" :title="tool.label" :aria-pressed="mode === tool.mode"
      @click="emit('select', mode === tool.mode ? null : tool.mode)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tool.path" /></svg>
    </button>
  </div>
  <Teleport defer to="#repeat-banner">
    <div v-if="mode === 'repeat'" class="repeat-banner" role="group" aria-label="Note repeat division">
      <span>Note repeat</span>
      <button v-for="value in divisions" :key="value" type="button" :aria-pressed="division === value"
        @click="emit('division', value)">{{ value }}</button>
    </div>
  </Teleport>
</template>
