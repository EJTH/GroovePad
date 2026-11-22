<script setup lang="ts">
import { onMounted, ref } from 'vue'

defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)

onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="settings-dialog" :aria-label="title" @close="emit('close')" @click.self="dialog?.close()">
    <div class="dialog-content">
      <header class="dialog-header">
        <h2>{{ title }}</h2>
        <button type="button" class="dialog-close" aria-label="Close" @click="dialog?.close()">×</button>
      </header>
      <slot />
    </div>
  </dialog>
</template>
