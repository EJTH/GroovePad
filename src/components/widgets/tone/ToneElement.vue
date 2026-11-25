<script setup lang="ts">
import type { ToneElementSettings } from '../../../grid'

defineProps<{ label: string; settings: ToneElementSettings }>()
</script>

<template>
  <div class="tone-element-control" :style="{ '--tone-color': settings.color }">
    <strong>{{ label }}</strong>
    <small>{{ settings.elementType }}</small>
  </div>
</template>
