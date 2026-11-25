<script setup lang="ts">
import { computed } from 'vue'
import type { ExposedPort, GridItem, SubGridSettings } from '../grid'
import { inputs, outputs, type ParameterMetadata } from '../parameters'
import SettingsDialog from './UI/SettingsDialog.vue'

const props = defineProps<{ item: GridItem; settings: SubGridSettings; protectedPorts?: string[] }>()
defineEmits<{ close: [] }>()
const noteInputs = computed(() => inputs(props.item).filter((port) => port.kind === 'note'))
const noteOutputs = computed(() => outputs(props.item).filter((port) => port.kind === 'note'))
const numericInputs = computed(() => inputs(props.item).filter((port) => port.kind === 'number'))
const numericOutputs = computed(() => outputs(props.item).filter((port) => port.kind === 'number'))
const audioInputs = computed(() => inputs(props.item).filter((port) => port.kind === 'audio'))
const audioOutputs = computed(() => outputs(props.item).filter((port) => port.kind === 'audio'))
function exposed(direction: ExposedPort['direction'], parameter: string) {
  return props.settings.exposedPorts.find((port) => port.itemId === props.item.id &&
    port.parameterId === parameter && port.direction === direction)
}
function togglePort(direction: ExposedPort['direction'], parameter: ParameterMetadata, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const existing = exposed(direction, parameter.id)
  if (target.checked && !existing) {
    let number = 1
    while (props.settings.exposedPorts.some((port) => port.id === `port-${number}`)) number++
    props.settings.exposedPorts.push({ id: `port-${number}`, name: `${props.item.label} ${parameter.label}`,
      kind: parameter.kind === 'number' ? 'numeric' : parameter.kind, direction, itemId: props.item.id, parameterId: parameter.id })
  } else if (!target.checked && existing && !props.protectedPorts?.includes(existing.id)) {
    props.settings.exposedPorts.splice(props.settings.exposedPorts.indexOf(existing), 1)
  } else if (existing) target.checked = true
}
function rename(port: ExposedPort, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const name = target.value.trim()
  if (name) port.name = name
  else target.value = port.name
}
const surfaced = computed({
  get: () => props.settings.surfaceItemIds.includes(props.item.id),
  set: (value: boolean) => {
    const ids = props.settings.surfaceItemIds
    const index = ids.indexOf(props.item.id)
    if (value && index < 0) ids.push(props.item.id)
    else if (!value && index >= 0) ids.splice(index, 1)
  },
})
</script>

<template>
  <SettingsDialog :title="`Configure ${item.label}`" @close="$emit('close')">
    <div class="settings-form">
      <label class="inline-checkbox"><input v-model="surfaced" type="checkbox"> Show on surface</label>
      <h3>Expose I/O</h3>
      <p v-if="!noteInputs.length && !noteOutputs.length && !numericInputs.length && !numericOutputs.length && !audioInputs.length && !audioOutputs.length">This control has no exposable ports.</p>
      <template v-for="group in [{ direction: 'input' as const, ports: [...noteInputs, ...numericInputs, ...audioInputs] }, { direction: 'output' as const, ports: [...noteOutputs, ...numericOutputs, ...audioOutputs] }]" :key="group.direction">
        <div v-for="port in group.ports" :key="port.id">
          <label class="inline-checkbox">
            <input type="checkbox" :checked="!!exposed(group.direction, port.id)"
              :disabled="!!exposed(group.direction, port.id) && protectedPorts?.includes(exposed(group.direction, port.id)!.id)"
              @change="togglePort(group.direction, port, $event)">
            {{ group.direction === 'input' ? 'Input' : 'Output' }}: {{ port.label }} ({{ port.kind === 'number' ? 'numeric' : port.kind }})
          </label>
          <label v-if="exposed(group.direction, port.id)">Port name
            <input :value="exposed(group.direction, port.id)!.name" @change="rename(exposed(group.direction, port.id)!, $event)">
          </label>
          <small v-if="exposed(group.direction, port.id) && protectedPorts?.includes(exposed(group.direction, port.id)!.id)">
            Remove parent wires or parent exposures before removing this port.
          </small>
        </div>
      </template>
    </div>
  </SettingsDialog>
</template>
