<script setup lang="ts">
import { computed, inject, nextTick, ref } from 'vue'
import type { KnobSettings, ParameterOutput } from '../grid'
import { settingGestureKey } from '../settingsAutomation'
import Knob from './Knob.vue'

const props = withDefaults(defineProps<{
  label: string
  modelValue: number
  min?: number
  max?: number
  step?: number
  integer?: boolean
}>(), { step: 1 })
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const frozenRange = ref<{ min: number; max: number; step: number } | null>(null)
const settingGesture = inject(settingGestureKey, undefined)
let gesturing = false

function startGesture(event: PointerEvent) {
  if (event.button !== 0 || gesturing) return
  frozenRange.value = range.value
  gesturing = true
  settingGesture?.(true)
}

function endGesture() {
  frozenRange.value = null
  if (!gesturing) return
  gesturing = false
  settingGesture?.(false)
}

const range = computed(() => {
  const value = Number.isFinite(props.modelValue) ? props.modelValue : 0
  const magnitude = Math.min(1e100, Math.max(1, Math.abs(value)))
  const scale = 10 ** Math.floor(Math.log10(magnitude))
  const min = props.min ?? -scale * 10
  const max = props.max ?? scale * 10
  return { min, max, step: props.step }
})

const settings = computed<KnobSettings>(() => {
  const { min, max, step } = frozenRange.value ?? range.value
  const value = Number.isFinite(props.modelValue) ? Math.min(max, Math.max(min, props.modelValue)) : min
  return { color: '#b8d986', min, max, step, value, defaultValue: value, unit: '', recordAutomation: true }
})

function updateInput(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const value = input.valueAsNumber
  if (Number.isFinite(value) && (props.min === undefined || value >= props.min) &&
    (props.max === undefined || value <= props.max) && (!props.integer || Number.isSafeInteger(value))) {
    emit('update:modelValue', value)
    void nextTick(() => {
      if (input.valueAsNumber === value && props.modelValue !== value) input.value = String(props.modelValue)
    })
  }
}

function finishInput(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  let value = input.valueAsNumber
  if (!Number.isFinite(value)) value = props.modelValue
  if (props.integer) value = Math.round(value)
  value = Math.max(props.min ?? -Infinity, Math.min(props.max ?? Infinity, value))
  input.value = String(value)
  emit('update:modelValue', value)
  void nextTick(() => { input.value = String(props.modelValue) })
}

function updateKnob(output: ParameterOutput) {
  emit('update:modelValue', output.value)
}
</script>

<template>
  <div class="numeric-setting">
    <div
      class="numeric-knob"
      @pointerdown.capture="startGesture"
      @pointerup="endGesture"
      @pointercancel="endGesture"
      @lostpointercapture="endGesture"
    >
      <Knob :label="`${label} adjustment`" :settings="settings" @output="updateKnob" />
    </div>
    <label>
      {{ label }}
      <input
        :value="Number.isFinite(modelValue) ? modelValue : ''"
        type="number"
        :min="min"
        :max="max"
        step="any"
        required
        @input="updateInput"
        @blur="finishInput"
      />
    </label>
    <slot />
  </div>
</template>

<style scoped>
.numeric-setting {
  min-width: 0;
  display: flex;
  align-items: end;
  gap: 8px;
}

.numeric-setting label { flex: 1; }
.numeric-knob { flex: 0 0 48px; height: 48px; }
.numeric-knob :deep(.knob) { padding: 0; }
.numeric-knob :deep(.knob-control) { width: 44px; max-height: none; }
.numeric-knob :deep(.value), .numeric-knob :deep(.label) { display: none; }
</style>
