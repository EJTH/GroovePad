<script setup lang="ts">
import { inject, onBeforeUnmount, ref } from 'vue'
import { readSampleFile, sampleAssetKey, type SampleAsset } from '../sampleAssets'
import SettingsDialog from './SettingsDialog.vue'

defineProps<{ selectable?: boolean }>()
const emit = defineEmits<{ close: []; select: [asset: SampleAsset]; delete: [source: string] }>()
const store = inject(sampleAssetKey)
if (!store) throw new Error('Sample asset store is unavailable.')

const pendingDelete = ref<string | null>(null)
const swapTarget = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref('')
let disposed = false
onBeforeUnmount(() => { disposed = true })

function deleteAsset(source: string) {
  if (pendingDelete.value !== source) {
    pendingDelete.value = source
    error.value = ''
    return
  }
  store!.remove(source)
  emit('delete', source)
  pendingDelete.value = null
}

function beginSwap(source: string) {
  pendingDelete.value = null
  error.value = ''
  swapTarget.value = source
  fileInput.value?.click()
}

async function swapFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const source = swapTarget.value
  swapTarget.value = null
  if (!file || !source) return
  if (file.size > 2 * 1024 * 1024) {
    error.value = 'Choose an audio file no larger than 2 MB.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const replacement = await readSampleFile(file)
    if (disposed) return
    if (!store!.assets.value.some((asset) => asset.source === source)) throw new Error('The sample is no longer in the project.')
    store!.swap(source, { source: replacement.source, name: file.name })
  } catch (cause) {
    if (!disposed) error.value = `Could not load audio: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    if (!disposed) busy.value = false
  }
}
</script>

<template>
  <SettingsDialog :title="selectable ? 'Load from project' : 'Manage assets'" @close="emit('close')">
    <p v-if="!store!.assets.value.length">No samples in this project yet.</p>
    <ul v-else class="asset-list">
      <li v-for="asset in store!.assets.value" :key="asset.source" class="asset">
        <div class="asset-row">
          <button v-if="selectable" type="button" class="asset-name select" :disabled="busy" @click="emit('select', asset)">
            {{ asset.name || 'Sample' }}
          </button>
          <span v-else class="asset-name">{{ asset.name || 'Sample' }}</span>
          <button v-if="!selectable" type="button" :disabled="busy" :aria-label="`Swap ${asset.name || 'Sample'}`" @click="beginSwap(asset.source)">Swap</button>
          <button type="button" class="delete" :disabled="busy" :aria-label="`${pendingDelete === asset.source ? 'Confirm delete' : 'Delete'} ${asset.name || 'Sample'}`"
            @click="deleteAsset(asset.source)">{{ pendingDelete === asset.source ? 'Confirm delete' : 'Delete' }}</button>
        </div>
        <p v-if="pendingDelete === asset.source" class="warning" role="alert">
          Delete this sample? It will also be removed from all pads using it. Press Confirm delete to continue.
          <button type="button" @click="pendingDelete = null">Cancel</button>
        </p>
      </li>
    </ul>
    <input ref="fileInput" type="file" hidden accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac" @change="swapFile">
    <p v-if="busy" role="status">Loading replacement…</p>
    <p v-if="error" class="warning" role="alert">{{ error }}</p>
  </SettingsDialog>
</template>

<style scoped>
.asset-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.asset { border: 1px solid #565b56; border-radius: 4px; padding: 8px; }
.asset-row { display: flex; align-items: center; gap: 6px; }
.asset-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
button { min-height: 40px; padding: 6px 10px; border: 1px solid #565b56; border-radius: 4px; background: #292d2b; color: #eee; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.select { text-align: left; }
.delete, .warning { color: #f0b5a9; }
.warning { font-size: 12px; }
.warning button { min-height: 30px; margin-left: 4px; }
</style>
