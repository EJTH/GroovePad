<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { SampleHitParams, SampleLoopParams, SamplePlayback } from '../../../instruments/types'
import { encodeWav } from '../../../audio/wav'
import { readSampleFile, sampleAssetKey, setSample, type SampleAsset } from '../../../sampleAssets'
import SampleAssetsDialog from '../../SampleAssetsDialog.vue'
import WaveformEditor from '../../UI/WaveformEditor.vue'

const props = defineProps<{ params: SampleHitParams | SampleLoopParams }>()
const emit = defineEmits<{ 'loading-change': [loading: boolean] }>()
const assets = inject(sampleAssetKey)
if (!assets) throw new Error('Sample asset store is unavailable.')
const assetsOpen = ref(false)
const buffer = shallowRef<AudioBuffer>()
const error = ref('')
const loading = ref(false)
const recording = ref<'idle' | 'requesting' | 'recording' | 'stopping'>('idle')
const fileInput = ref<HTMLInputElement | null>(null)
let request = 0
let decodedSource = ''
let disposed = false
let microphone: MediaStream | undefined
let recordingContext: AudioContext | undefined
let recordingNode: AudioWorkletNode | undefined
const busy = computed(() => loading.value || recording.value !== 'idle')
const hitLooping = computed(() => 'loopMode' in props.params && props.params.loopMode !== 'once')
watch(busy, (value) => emit('loading-change', value), { flush: 'sync' })
const start = computed({
  get: () => 'loopStart' in props.params ? props.params.loopStart : props.params.start,
  set: (value: number) => { if ('loopStart' in props.params) props.params.loopStart = value; else props.params.start = value },
})
const end = computed({
  get: () => 'loopEnd' in props.params ? props.params.loopEnd : props.params.end,
  set: (value: number) => { if ('loopEnd' in props.params) props.params.loopEnd = value; else props.params.end = value },
})

async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  const context = new AudioContext()
  try {
    return await context.decodeAudioData(data)
  } finally {
    await context.close()
  }
}

async function loadSample(file: Blob, name: string) {
  const current = ++request
  error.value = ''
  loading.value = true
  try {
    const { source, buffer: decoded } = await readSampleFile(file)
    if (disposed || current !== request) return
    decodedSource = source
    buffer.value = decoded
    assets!.add({ source, name })
    setSample(props.params, { source, name })
  } catch (cause) {
    if (!disposed && current === request) error.value = `Could not load audio: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    if (!disposed && current === request) loading.value = false
  }
}

function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    error.value = 'Choose an audio file no larger than 2 MB.'
    return
  }
  void loadSample(file, file.name)
}

function stopMicrophone() {
  microphone?.getTracks().forEach((track) => track.stop())
  microphone = undefined
  recordingNode?.disconnect()
  recordingNode = undefined
  const context = recordingContext
  recordingContext = undefined
  if (context && context.state !== 'closed') {
    void context.close().catch((cause: unknown) => console.error('Could not close recording audio context:', cause))
  }
}

async function startRecording() {
  if (busy.value) return
  error.value = ''
  recording.value = 'requesting'
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      throw new Error('Microphone recording is not supported in this browser or context.')
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (disposed) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    microphone = stream
    const context = new AudioContext()
    recordingContext = context
    await context.audioWorklet.addModule(new URL('../audio/recording-processor.js', import.meta.url).href)
    if (disposed) return
    await context.resume()
    if (disposed) return
    const node = new AudioWorkletNode(context, 'recording-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
    })
    recordingNode = node
    const chunks: Float32Array[] = []
    node.onprocessorerror = () => {
      if (disposed) return
      error.value = 'Microphone recording failed.'
      stopMicrophone()
      recording.value = 'idle'
    }
    node.port.onmessage = (event: MessageEvent<{ type: string; samples?: Float32Array }>) => {
      if (disposed) return
      if (event.data.type === 'samples' && event.data.samples) chunks.push(event.data.samples)
      if (event.data.type !== 'stopped') return
      stopMicrophone()
      try {
        const audio = encodeWav(chunks, context.sampleRate)
        let number = 1
        while (assets!.assets.value.some((asset) => asset.name.toLowerCase() === `recording-${number}.wav`)) number++
        void loadSample(audio, `recording-${number}.wav`).finally(() => {
          if (!disposed) recording.value = 'idle'
        })
      } catch (cause) {
        error.value = `Could not finish recording: ${cause instanceof Error ? cause.message : String(cause)}`
        recording.value = 'idle'
      }
    }
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (disposed || recording.value === 'idle') return
        stopMicrophone()
        recording.value = 'idle'
        error.value = 'Microphone recording stopped unexpectedly.'
      })
    }
    const source = context.createMediaStreamSource(stream)
    const mute = context.createGain()
    mute.gain.value = 0
    source.connect(node)
    node.connect(mute)
    mute.connect(context.destination)
    recording.value = 'recording'
  } catch (cause) {
    stopMicrophone()
    if (!disposed) {
      recording.value = 'idle'
      error.value = `Could not start recording: ${cause instanceof Error ? cause.message : String(cause)}`
    }
  }
}

function toggleRecording() {
  if (recording.value === 'idle') {
    void startRecording()
  } else if (recording.value === 'recording' && recordingNode) {
    recording.value = 'stopping'
    try {
      recordingNode.port.postMessage('stop')
    } catch (cause) {
      stopMicrophone()
      recording.value = 'idle'
      error.value = `Could not stop recording: ${cause instanceof Error ? cause.message : String(cause)}`
    }
  }
}

function resetSample() {
  request++
  decodedSource = ''
  buffer.value = undefined
  error.value = ''
  setSample(props.params)
}

function selectAsset(asset: SampleAsset) {
  assetsOpen.value = false
  setSample(props.params, asset)
}

function deletedAsset(source: string) {
  if (props.params.sample === source) resetSample()
}

watch(() => props.params.sample, async (source) => {
  if (source && source === decodedSource) return
  const current = ++request
  buffer.value = undefined
  error.value = ''
  if (!source) { loading.value = false; return }
  loading.value = true
  try {
    if (!/^data:[^,]*;base64,/.test(source)) throw new Error('Choose a sample file.')
    const response = await fetch(source)
    if (!response.ok) throw new Error('Could not read the sample.')
    const decoded = await decode(await response.arrayBuffer())
    if (disposed || current !== request) return
    decodedSource = source
    buffer.value = decoded
  } catch (cause) {
    if (!disposed && current === request) error.value = `Could not load audio: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    if (!disposed && current === request) loading.value = false
  }
}, { immediate: true })

function updateCuts(cuts: number[]) {
  props.params.cuts = cuts
  if (props.params.playback.startsWith('cut:')) {
    const index = Number(props.params.playback.slice(4))
    if (!cuts.length || index >= cuts.length + 1) props.params.playback = 'order'
  }
}

function updatePlayback(event: Event) {
  const playback = (event.target as HTMLSelectElement).value as SamplePlayback
  if ('loopMode' in props.params) {
    props.params.loopMode = playback === 'loop'
      ? (props.params.loopMode === 'back-and-forth' ? 'back-and-forth' : 'loop')
      : 'once'
  }
  props.params.playback = playback
}

onBeforeUnmount(() => {
  disposed = true
  request++
  stopMicrophone()
  emit('loading-change', false)
})
</script>

<template>
  <div class="sample-editor">
    <div class="sample-actions">
      <button v-if="'loopMode' in params" type="button" aria-label="Load from project" title="Load from project" :disabled="busy" @click="assetsOpen = true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v5H3zM5 9v11h14V9M9 13h6" /></svg>
      </button>
      <button type="button" aria-label="Open sample file" title="Open sample file" :disabled="busy" @click="fileInput?.click()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h7l2 2h9v12H3z" /><path d="M3 10h18" /></svg>
      </button>
      <button type="button" :disabled="loading || recording === 'requesting' || recording === 'stopping'"
        :aria-label="recording === 'recording' ? 'Stop recording' : 'Record from microphone'"
        :aria-pressed="recording === 'recording'" @click="toggleRecording">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect v-if="recording === 'recording'" x="6" y="6" width="12" height="12" />
          <circle v-else cx="12" cy="12" r="7" />
        </svg>
        {{ recording === 'recording' ? 'Stop' : 'Record' }}
      </button>
      <input ref="fileInput" type="file" hidden accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac" @change="selectFile" />
    </div>
    <SampleAssetsDialog v-if="assetsOpen" selectable @close="assetsOpen = false" @select="selectAsset" @delete="deletedAsset" />
    <div v-if="params.sample" class="sample-info">
      <div>
        <p><strong>{{ params.sampleName || 'Sample' }}</strong></p>
        <p v-if="buffer">Length: {{ buffer.duration.toFixed(2) }} s</p>
        <p v-if="buffer">Decoded quality: {{ (buffer.sampleRate / 1000).toFixed(1) }} kHz, {{ buffer.numberOfChannels }} {{ buffer.numberOfChannels === 1 ? 'channel' : 'channels' }}</p>
      </div>
      <p v-if="params.sample.length > 2 * 1024 * 1024 * 4 / 3">Large recordings may exceed browser storage or the project export limit.</p>
      <button type="button" :disabled="busy" @click="resetSample">Reset</button>
    </div>
    <p v-if="recording === 'requesting'" role="status">Waiting for microphone permission…</p>
    <p v-else-if="recording === 'recording'" role="status">Recording from microphone…</p>
    <p v-else-if="recording === 'stopping'" role="status">Finishing recording…</p>
    <p v-if="loading" role="status">Loading waveform…</p>
    <p v-if="error" role="alert" class="sample-error">{{ error }}</p>
    <WaveformEditor v-if="buffer" v-model:start="start" v-model:end="end" :cuts="params.cuts"
      :buffer="buffer" @update:cuts="updateCuts" />
    <label v-if="params.cuts.length || 'loopMode' in params">Playback
      <select :value="params.playback" @change="updatePlayback">
        <option v-if="params.cuts.length" value="random">Play random</option>
        <option value="order">{{ params.cuts.length ? 'Play in order' : 'Play once' }}</option>
        <template v-if="params.cuts.length">
          <option v-for="(_, index) in params.cuts.length + 1" :key="index" :value="`cut:${index}`">Cut {{ index + 1 }}</option>
        </template>
        <option v-if="'loopMode' in params" value="loop">Loop mode</option>
      </select>
    </label>
    <p v-if="hitLooping">The first and last cut markers define the loop; slice selection applies to Play once.</p>
  </div>
</template>

<style scoped>
.sample-editor p { color: #bbb; font-size: 12px; overflow-wrap: anywhere; }
.sample-editor .sample-error { color: #ff9a9a; }
.sample-actions { display: flex; gap: 8px; margin-top: 8px; }
.sample-actions button, .sample-info button { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 6px 12px; border: 1px solid #565b56; border-radius: 4px; background: #292d2b; color: #eee; cursor: pointer; }
.sample-actions button:disabled, .sample-info button:disabled { opacity: 0.5; cursor: not-allowed; }
.sample-actions svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; }
.sample-actions circle, .sample-actions rect { fill: #ff6b6b; stroke: none; }
.sample-info { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sample-info p { margin: 5px 0; }
.sample-info strong { color: #eee; }
</style>
