<script setup lang="ts">
import { onMounted, ref } from 'vue'

defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)

onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="settings-dialog" :aria-label="title" @close="emit('close')"
    @cancel.prevent="emit('close')" @click.self="emit('close')">
    <header class="dialog-header">
      <h2>{{ title }}</h2>
      <div class="dialog-header-actions">
        <slot name="header-actions" />
        <button type="button" class="dialog-close" aria-label="Close" @click="emit('close')">×</button>
      </div>
    </header>
    <div class="dialog-body">
      <slot />
    </div>
  </dialog>
</template>
