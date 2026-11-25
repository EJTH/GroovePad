<script setup lang="ts">
import type { ToneElementSettings } from '../../../grid'

defineProps<{ label: string; settings: ToneElementSettings; available: boolean }>()
const emit = defineEmits<{ toggleMute: [] }>()
</script>

<template>
  <button type="button" class="tone-element-control" :class="{ muted: settings.tapMode === 'bypass' ? settings.bypassed : settings.muted }"
    :style="{ '--tone-color': settings.color }" :disabled="!available"
    :aria-label="settings.tapMode === 'bypass' ? `${settings.bypassed ? 'Enable' : 'Bypass'} ${label}` : `${settings.muted ? 'Unmute' : 'Mute'} ${label}`"
    :aria-pressed="settings.tapMode === 'bypass' ? !!settings.bypassed : !!settings.muted"
    @click="emit('toggleMute')">
    <strong>{{ label }}</strong>
    <small>{{ settings.elementType }}</small>
    <small v-if="settings.tapMode === 'bypass' && settings.bypassed">Bypassed</small>
    <small v-else-if="settings.tapMode !== 'bypass' && settings.muted">Muted</small>
  </button>
</template>
