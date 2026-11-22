<script setup lang="ts">
import { onMounted, ref } from 'vue'

defineProps<{ 
  title: string
  showSaveButton?: boolean
}>()
const emit = defineEmits<{ 
  close: []
  save: []
}>()
const dialog = ref<HTMLDialogElement | null>(null)

onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="settings-dialog" :aria-label="title" @close="emit('close')" @click.self="dialog?.close()">
    <header class="dialog-header">
      <h2>{{ title }}</h2>
      <div class="dialog-header-actions">
        <slot name="header-actions" />
        <button v-if="showSaveButton" type="button" class="dialog-save" @click="$emit('save')">Save</button>
        <button type="button" class="dialog-close" aria-label="Close" @click="dialog?.close()">×</button>
      </div>
    </header>
    <div class="dialog-body">
      <slot />
    </div>
  </dialog>
</template>
