<script setup lang="ts">
import { computed } from 'vue'
import type { Connection, GridLayout } from '../grid'
import { connectionMappingMode, mappingEndpoint, mappingTarget, setConnectionMappingMode, setMappingEndpoint } from '../modulation'

const props = defineProps<{ layout: GridLayout; connection: Connection; label: string; draft?: boolean }>()
const emit = defineEmits<{ error: [message: string] }>()
const mode = computed(() => connectionMappingMode(props.layout, props.connection))
const target = computed(() => mappingTarget(props.layout, props.connection))

function toggleMode() {
  setConnectionMappingMode(props.layout, props.connection, mode.value === 'mod' ? 'abs' : 'mod', !props.draft)
  emit('error', '')
}

function setEndpoint(endpoint: 'min' | 'max', event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  if (input.value !== '' && (!input.validity.valid || !Number.isFinite(input.valueAsNumber))) {
    input.value = mappingEndpoint(props.layout, props.connection, endpoint)?.toString() ?? ''
    emit('error', mode.value === 'abs'
      ? `Absolute mapping values must be between ${target.value.min} and ${target.value.max}.`
      : 'Modulation offsets must be between -100 and 100%.')
    return
  }
  setMappingEndpoint(props.layout, props.connection, endpoint, input.value === '' ? undefined : input.valueAsNumber, !props.draft)
  emit('error', '')
}

function choiceEndpoint(endpoint: 'min' | 'max'): string {
  const choices = target.value.choices
  const value = mappingEndpoint(props.layout, props.connection, endpoint)
  if (!choices?.length || value === undefined) return ''
  return String(Math.max(0, Math.min(choices.length - 1, Math.floor(value / 128 * choices.length))))
}

function setChoiceEndpoint(endpoint: 'min' | 'max', event: Event) {
  const input = event.target
  if (!(input instanceof HTMLSelectElement)) return
  const choices = target.value.choices
  if (input.value === '') {
    setMappingEndpoint(props.layout, props.connection, endpoint, undefined, !props.draft)
  } else {
    const index = Number(input.value)
    if (!choices?.length || !Number.isInteger(index) || index < 0 || index >= choices.length) {
      input.value = choiceEndpoint(endpoint)
      emit('error', 'Choose a valid mapping value.')
      return
    }
    setMappingEndpoint(props.layout, props.connection, endpoint, (index + 0.5) * 128 / choices.length - 0.5, !props.draft)
  }
  emit('error', '')
}
</script>

<template>
  <button type="button" class="wire-mode" :aria-label="`${mode === 'mod' ? 'Modulation' : 'Absolute'} mode for ${label}; switch mode`"
    :title="mode === 'mod' ? 'Modulation mode; switch to absolute' : 'Absolute mode; switch to modulation'"
    @click="toggleMode">{{ mode.toUpperCase() }}</button>
  <template v-for="endpoint in (['min', 'max'] as const)" :key="endpoint">
    <select v-if="mode === 'abs' && target.choices"
      :value="choiceEndpoint(endpoint)" class="wire-amount"
      :aria-label="`${endpoint === 'min' ? 'Minimum' : 'Maximum'} absolute mapping for ${label}`"
      @change="setChoiceEndpoint(endpoint, $event)">
      <option value="">{{ endpoint === 'min' ? 'Min' : 'Max' }}</option>
      <option v-for="(choice, index) in target.choices" :key="choice" :value="String(index)">{{ choice }}</option>
    </select>
    <input v-else :value="mappingEndpoint(layout, connection, endpoint) ?? ''" class="wire-amount" type="number"
      :min="mode === 'abs' ? target.min : -100" :max="mode === 'abs' ? target.max : 100" step="any"
      :placeholder="`${endpoint === 'min' ? 'Min' : 'Max'}${mode === 'mod' ? ' %' : ''}`"
      :title="`Mapping at source ${endpoint === 'min' ? 'minimum' : 'maximum'}`"
      :aria-label="`${endpoint === 'min' ? 'Minimum' : 'Maximum'} ${mode === 'abs' ? 'absolute mapping' : 'modulation offset (%)'} for ${label}`"
      @change="setEndpoint(endpoint, $event)" />
  </template>
</template>
