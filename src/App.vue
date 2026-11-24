<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import * as Tone from 'tone'
import GrooveGrid from './components/GrooveGrid.vue'
import SampleAssetsDialog from './components/SampleAssetsDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import TempoDialog from './components/TempoDialog.vue'
import NumericSetting from './components/NumericSetting.vue'
import ToolBar from './components/ToolBar.vue'
import { copyControl, MAX_GRID_COLUMNS, MAX_GRID_ROWS, type GridLayout, type ToolMode, type RepeatDivision } from './grid'
import { loadDefaultProject } from './defaultProject'
import { DEFAULT_INFO_SCROLL_SPEED, isSavedProject, migrateSavedProject, type Bank } from './project'
import { loadProjectFromFile, saveProjectToFile } from './saveManager'
import { loadStoredProject, saveStoredProject } from './projectStorage'
import { replaceSampleInBanks, sampleAssetKey, samplesInBanks, type SampleAsset } from './sampleAssets'
import { BankEventBus } from './sequencedLoop'
import { keepScreenAwake } from './screenWakeLock'
import { useTransport } from './composables/useTransport'
import { RECORDING_FORMATS, startSessionRecording, supportedRecordingFormats, type RecordingFormat } from './audio/sessionRecording'

function createLayout(): GridLayout {
  return { columns: 4, rows: 4, items: [], connections: [] }
}

const banks = ref<Bank[]>([])

const selectedBankId = ref('A')
const bpm = ref(120)
const infoText = ref('')
const infoScrollSpeed = ref(DEFAULT_INFO_SCROLL_SPEED)
const supportedFormats = supportedRecordingFormats()
const defaultRecordingFormat: RecordingFormat = supportedFormats[0] ?? 'wav'
const recordingFormat = ref<RecordingFormat>(defaultRecordingFormat)
const infoScroll = ref<HTMLElement | null>(null)
const infoScrollWidth = ref(0)
const infoScrollDuration = computed(() => infoScrollWidth.value ? infoScrollWidth.value / infoScrollSpeed.value : 30)
watch(infoScroll, (element, _previous, onCleanup) => {
  if (!element) {
    infoScrollWidth.value = 0
    return
  }
  const observer = new ResizeObserver(() => {
    infoScrollWidth.value = element.getBoundingClientRect().width
  })
  observer.observe(element)
  onCleanup(() => observer.disconnect())
}, { flush: 'post' })
const assets = ref<SampleAsset[]>([])
const storageKey = 'groovepad.project.v1'
const storageError = ref('')
const storageBlocked = ref(false)
const storageReady = ref(false)
let saveTimer: number | undefined
let saveQueue = Promise.resolve()

async function initializeStorage() {
  storageReady.value = false
  storageBlocked.value = false
  storageError.value = ''
  let loadingDefault = false
  try {
    let data = await loadStoredProject()
    if (!data) {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null) {
        const legacy: unknown = JSON.parse(saved)
        migrateSavedProject(legacy)
        if (!isSavedProject(legacy)) throw new Error('Saved project is invalid or unsupported.')
        await saveStoredProject(legacy)
        localStorage.removeItem(storageKey)
        data = legacy
      }
    }
    if (!data) {
      loadingDefault = true
      data = await loadDefaultProject()
    }
    banks.value = data.banks
    selectedBankId.value = data.selectedBankId
    bpm.value = data.bpm
    infoText.value = data.infoText ?? ''
    infoScrollSpeed.value = data.infoScrollSpeed ?? DEFAULT_INFO_SCROLL_SPEED
    recordingFormat.value = data.recordingFormat ?? defaultRecordingFormat
    assets.value = data.assets ?? []
    for (const asset of samplesInBanks(data.banks)) addAsset(asset)
  } catch (error) {
    storageBlocked.value = true
    storageError.value = `${loadingDefault ? 'Default project' : 'Local project'} could not be loaded: ${error instanceof Error ? error.message : String(error)}. Saved data has not been overwritten.`
  } finally {
    await nextTick()
    storageReady.value = true
  }
}

function saveLocalProject() {
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = undefined
  if (!storageReady.value || storageBlocked.value) return
  const project = { version: 1 as const, bpm: bpm.value, infoText: infoText.value, infoScrollSpeed: infoScrollSpeed.value, recordingFormat: recordingFormat.value,
    banks: banks.value, selectedBankId: selectedBankId.value, assets: assets.value }
  saveQueue = saveQueue.then(async () => {
    await saveStoredProject(project)
    storageError.value = ''
  }).catch((error: unknown) => {
    storageError.value = `Local project could not be saved: ${error instanceof Error ? error.message : String(error)}.`
  })
}

function replaceInvalidProject() {
  storageBlocked.value = false
  saveLocalProject()
}

watch([banks, selectedBankId, bpm, infoText, infoScrollSpeed, recordingFormat, assets], () => {
  if (!storageReady.value || storageBlocked.value) return
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveLocalProject, 300)
}, { deep: true })

const fullScreen = ref(false)

function syncFullScreen() {
  fullScreen.value = document.fullscreenElement !== null
}

async function toggleFullScreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch (error) {
    projectError.value = `Full screen mode could not be changed: ${error instanceof Error ? error.message : String(error)}`
  }
}

let stopKeepingScreenAwake: (() => void) | undefined
onMounted(() => {
  void initializeStorage()
  window.addEventListener('pagehide', saveLocalProject)
  document.addEventListener('fullscreenchange', syncFullScreen)
  syncFullScreen()
  stopKeepingScreenAwake = keepScreenAwake(document, navigator)
})
const selectedBank = computed(() => banks.value.find((bank) => bank.id === selectedBankId.value)!)
const bankEvents = new BankEventBus()
const menuOpen = ref(false)
const tool = ref<ToolMode>(null)
const repeatDivision = ref<RepeatDivision>('1/16')
const editing = computed(() => tool.value === 'edit')
const wiring = computed(() => tool.value === 'wire')
const toolLabel = computed(() => tool.value ? ({ edit: 'EDIT MODE', wire: 'WIRE MODE', volume: 'VOLUME MODE', repeat: 'NOTE REPEAT' })[tool.value] : '')
const gridSettingsOpen = ref(false)
const projectSettingsOpen = ref(false)
const assetsOpen = ref(false)
const projectError = ref('')
const recordingError = ref('')
const recordingState = ref<'idle' | 'starting' | 'recording' | 'stopping'>('idle')
let sessionRecording: Awaited<ReturnType<typeof startSessionRecording>> | undefined
let appUnmounted = false

function downloadSession(audio: Blob, format: RecordingFormat) {
  const extension = RECORDING_FORMATS.find((item) => item.id === format)!.extension
  const url = URL.createObjectURL(audio)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `groovepad-session.${extension}`
    link.click()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

async function toggleSessionRecording() {
  if (recordingState.value === 'recording') {
    recordingState.value = 'stopping'
    sessionRecording?.stop()
    return
  }
  if (recordingState.value !== 'idle') return
  recordingError.value = ''
  recordingState.value = 'starting'
  try {
    await Tone.start()
    if (appUnmounted) return
    const format = recordingFormat.value
    const session = await startSessionRecording(Tone.getContext(), Tone.getDestination(), format, (audio) => {
      sessionRecording = undefined
      recordingState.value = 'idle'
      try { downloadSession(audio, format) } catch (error) {
        recordingError.value = `Could not download session recording: ${error instanceof Error ? error.message : String(error)}`
      }
    }, (error) => {
      sessionRecording = undefined
      recordingState.value = 'idle'
      recordingError.value = error.message
    })
    if (appUnmounted) { session.dispose(); return }
    sessionRecording = session
    recordingState.value = 'recording'
  } catch (error) {
    recordingState.value = 'idle'
    recordingError.value = `Could not start session recording: ${error instanceof Error ? error.message : String(error)}`
  }
}

const { playing, countingIn, triggeredByInput, metronomeEnabled, transportClock, beat, togglePlayback, startFromInput } = useTransport({
  banks,
  bpm,
  editing,
  projectError,
  bankEvents,
})
const busy = ref(false)
const projectInput = ref<HTMLInputElement | null>(null)
const bankInput = ref<HTMLInputElement | null>(null)
const bankSettingsId = ref<string | null>(null)
const bankSettings = computed(() => banks.value.find((bank) => bank.id === bankSettingsId.value) ?? null)
const removeBankOpen = ref(false)
const importedBanks = ref<Bank[] | null>(null)
const workspaceRevision = ref(0)
let longPressTimer: number | undefined
let longPressPosition: { x: number; y: number } | undefined
let suppressBankClick = false

function addAsset(asset: SampleAsset) {
  if (!assets.value.some((entry) => entry.source === asset.source)) assets.value.push(asset)
}

provide(sampleAssetKey, {
  assets,
  add: addAsset,
  remove(source) {
    replaceSampleInBanks(banks.value, source)
    assets.value = assets.value.filter((asset) => asset.source !== source)
  },
  swap(source, replacement) {
    replaceSampleInBanks(banks.value, source, replacement)
    assets.value = assets.value.filter((asset) => asset.source !== source)
    addAsset(replacement)
  },
})

function nextBankId() {
  const reserved = new Set(banks.value.map((bank) => bank.id))
  for (const bank of banks.value) for (const item of bank.layout.items) if (item.type === 'sequenced-loop') {
    for (const notes of Object.values(item.settings.clips)) for (const note of notes) if (note.bankId) reserved.add(note.bankId)
    for (const events of Object.values(item.settings.automation)) for (const event of events) if (event.bankId) reserved.add(event.bankId)
  }
  let number = 1
  while (reserved.has(`bank-${number}`)) number++
  return `bank-${number}`
}

function editBank(bank?: Bank) {
  if (!bank) {
    bank = { id: nextBankId(), title: `Bank ${banks.value.length + 1}`, icon: '▦', color: '#b8d986', layout: createLayout() }
    banks.value.push(bank)
    selectedBankId.value = bank.id
  }
  bankSettingsId.value = bank.id
}

function updateBankText(event: Event, field: 'title' | 'icon', finish = false) {
  const input = event.target
  const bank = bankSettings.value
  if (!(input instanceof HTMLInputElement) || !bank) return
  if (input.value.trim()) bank[field] = finish ? input.value.trim() : input.value
  if (finish) input.value = bank[field]
}

function closeBankSettings() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  bankSettingsId.value = null
}

function removeCurrentBank() {
  if (banks.value.length <= 1) return
  const index = banks.value.findIndex((bank) => bank.id === selectedBankId.value)
  if (index < 0) return
  banks.value.splice(index, 1)
  selectedBankId.value = banks.value[Math.min(index, banks.value.length - 1)]!.id
  removeBankOpen.value = false
}

function beginBankPress(event: PointerEvent, bank: Bank) {
  if (event.button !== 0) return
  cancelBankPress()
  suppressBankClick = false
  longPressPosition = { x: event.clientX, y: event.clientY }
  longPressTimer = window.setTimeout(() => {
    longPressTimer = undefined
    suppressBankClick = true
    editBank(bank)
  }, 600)
}

function moveBankPress(event: PointerEvent) {
  if (longPressPosition && Math.hypot(event.clientX - longPressPosition.x, event.clientY - longPressPosition.y) > 10) cancelBankPress()
}

function cancelBankPress() {
  if (longPressTimer !== undefined) window.clearTimeout(longPressTimer)
  longPressTimer = undefined
  longPressPosition = undefined
}

function selectBank(id: string) {
  if (suppressBankClick) {
    suppressBankClick = false
    return
  }
  selectedBankId.value = id
}

async function saveProject() {
  busy.value = true
  projectError.value = ''
  try {
    const blob = await saveProjectToFile(JSON.parse(JSON.stringify({
      version: 1, bpm: bpm.value, infoText: infoText.value, infoScrollSpeed: infoScrollSpeed.value, recordingFormat: recordingFormat.value,
      banks: banks.value, selectedBankId: selectedBankId.value, assets: assets.value,
    })))
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'groovepad-project.zip'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (error) {
    projectError.value = `Project could not be saved: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    busy.value = false
  }
}

async function loadProject(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  projectError.value = ''
  try {
    const project = await loadProjectFromFile(file)
    if (!window.confirm('Replace the current project with the loaded project?')) return
    gridSettingsOpen.value = false
    bankSettingsId.value = null
    banks.value = project.banks
    selectedBankId.value = project.selectedBankId
    bpm.value = project.bpm
    infoText.value = project.infoText ?? ''
    infoScrollSpeed.value = project.infoScrollSpeed ?? DEFAULT_INFO_SCROLL_SPEED
    recordingFormat.value = project.recordingFormat ?? defaultRecordingFormat
    assets.value = project.assets ?? []
    for (const asset of samplesInBanks(project.banks)) addAsset(asset)
    workspaceRevision.value++
    storageBlocked.value = false
    saveLocalProject()
  } catch (error) {
    projectError.value = `Project could not be loaded: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    busy.value = false
  }
}

async function loadBank(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  projectError.value = ''
  busy.value = true
  try {
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    if (file.name.toLowerCase().endsWith('.zip') || file.name.toLowerCase().endsWith('.gpz') ||
      (signature[0] === 0x50 && signature[1] === 0x4b)) {
      const project = await loadProjectFromFile(file)
      importedBanks.value = project.banks
      return
    }
    if (file.size > 20 * 1024 * 1024) throw new Error('Bank file is too large.')
    const bank: unknown = JSON.parse(await file.text())
    const candidate: unknown = { version: 1, bpm: 120, banks: [bank], selectedBankId:
      typeof bank === 'object' && bank !== null && 'id' in bank ? bank.id : null }
    migrateSavedProject(candidate)
    if (!isSavedProject(candidate)) throw new Error('Invalid bank configuration.')
    addImportedBank(candidate.banks[0]!)
  } catch (error) {
    projectError.value = `Bank could not be loaded: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    busy.value = false
  }
}

function addImportedBank(bank: Bank) {
  const hasExternalTargets = bank.layout.items.some((item) => item.type === 'sequenced-loop' &&
    (Object.values(item.settings.clips).some((notes) => notes.some((note) => note.bankId && note.bankId !== bank.id)) ||
     Object.values(item.settings.automation).some((events) => events.some((event) => event.bankId && event.bankId !== bank.id))))
  if (hasExternalTargets) {
    importedBanks.value = null
    projectError.value = 'This bank contains loops targeting other banks. Load the complete project to preserve those targets.'
    return
  }
  const items = bank.layout.items.map((item) => {
    if (item.type !== 'sequenced-loop') return item
    const copy = copyControl(item, item.id)
    if (copy.type === 'sequenced-loop') {
      if (banks.value.some((entry) => entry.layout.items.some((existing) =>
        existing.type === 'sequenced-loop' && existing.settings.armed))) copy.settings.armed = false
      for (const notes of Object.values(copy.settings.clips)) for (const note of notes) if (note.bankId === bank.id) delete note.bankId
      for (const events of Object.values(copy.settings.automation)) for (const event of events) if (event.bankId === bank.id) delete event.bankId
    }
    return copy
  })
  const imported = { ...bank, id: nextBankId(), layout: { ...bank.layout, items } }
  banks.value.push(imported)
  for (const asset of samplesInBanks([imported])) addAsset(asset)
  selectedBankId.value = imported.id
  importedBanks.value = null
}

async function newProject() {
  if (!window.confirm('Start a new project? The current project will be replaced.')) return
  busy.value = true
  projectError.value = ''
  try {
    const project = await loadDefaultProject()
    gridSettingsOpen.value = false
    bankSettingsId.value = null
    banks.value = project.banks
    selectedBankId.value = project.selectedBankId
    bpm.value = project.bpm
    infoText.value = project.infoText ?? ''
    infoScrollSpeed.value = project.infoScrollSpeed ?? DEFAULT_INFO_SCROLL_SPEED
    recordingFormat.value = project.recordingFormat ?? defaultRecordingFormat
    assets.value = project.assets ?? []
    for (const asset of samplesInBanks(project.banks)) addAsset(asset)
    workspaceRevision.value++
    storageBlocked.value = false
    saveLocalProject()
  } catch (error) {
    projectError.value = `Default project could not be loaded: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    busy.value = false
  }
}

onUnmounted(() => {
  appUnmounted = true
  sessionRecording?.dispose()
  stopKeepingScreenAwake?.()
  window.removeEventListener('pagehide', saveLocalProject)
  document.removeEventListener('fullscreenchange', syncFullScreen)
  saveLocalProject()
  cancelBankPress()
})
</script>

<template>
  <p v-if="!storageReady" role="status">Loading project...</p>
  <div v-else-if="!selectedBank" class="storage-error" role="alert">
    {{ storageError }}
    <p v-if="projectError">{{ projectError }}</p>
    <button type="button" @click="initializeStorage">Retry</button>
    <button type="button" :disabled="busy" @click="newProject">Replace saved project</button>
  </div>
  <main v-else class="app">
    <header class="header">
      <section class="transport" aria-label="Transport">
        <button class="transport-button record" type="button"
          :disabled="recordingState === 'starting' || recordingState === 'stopping'"
          :class="{ 'is-recording': recordingState === 'recording' }"
          :aria-label="recordingState === 'recording' ? 'Stop session recording' : 'Record session'"
          :aria-pressed="recordingState === 'recording'"
          :title="recordingState === 'recording' ? 'Stop and download session recording' : 'Record session'"
          @click="toggleSessionRecording">
          <span class="record-icon" aria-hidden="true"></span>
        </button>
        <button
          class="transport-button"
          type="button"
          :aria-label="playing || countingIn ? 'Pause' : 'Play'"
          :aria-pressed="playing || countingIn"
          @click="togglePlayback"
        >
          <svg v-if="playing || countingIn" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5h3v14H8zM14 5h3v14h-3z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4v16l13-8z" />
          </svg>
        </button>

        <div class="display" aria-label="Tempo, project info and current bank">
          <div class="display-top">
            <button class="display-tempo" type="button" aria-label="Change tempo" @click="projectSettingsOpen = true"><strong>{{ bpm }}</strong><span>BPM</span></button>
            <div v-if="infoText" class="display-info" :title="infoText" tabindex="0">
              <div ref="infoScroll" class="display-info-scroll" :style="{ animationDuration: `${infoScrollDuration}s` }">{{ infoText }}</div>
            </div>
          </div>
          <div class="display-bank" :class="{ 'mode-indicator': tool }" :title="toolLabel || selectedBank.title">{{ toolLabel || selectedBank.title }}</div>
        </div>

        <div class="beat-controls">
          <button class="metronome-toggle" type="button" aria-label="Metronome"
            :aria-pressed="metronomeEnabled" title="Toggle metronome" @click="metronomeEnabled = !metronomeEnabled">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 3h6l5 18H4L9 3zM12 12l5-7M8 17h8" />
              <circle cx="12" cy="12" r="1" />
            </svg>
          </button>
          <div class="beats" aria-label="Beat indicator">
            <span
              v-for="index in 4"
              :key="index"
              :class="{ active: (playing || countingIn) && beat === index - 1 }"
            ></span>
          </div>
        </div>
      </section>
      <div class="header-actions">
        <ToolBar :mode="tool" :division="repeatDivision" @select="tool = $event" @division="repeatDivision = $event" />
      <div class="menu-container" @keydown.esc="menuOpen = false">
        <button
          class="icon-button"
          type="button"
          aria-label="Menu"
          aria-controls="main-menu"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <template v-if="menuOpen">
          <div class="menu-dismiss" @click="menuOpen = false"></div>
          <nav id="main-menu" class="menu" aria-label="Main menu">
            <div class="brand">GroovePad<span>.io</span></div>
            <p>Project</p>
            <button type="button" @click="newProject(); menuOpen = false">New project</button>
            <button type="button" :disabled="busy" @click="projectInput?.click(); menuOpen = false">Load project</button>
            <button type="button" :disabled="busy" @click="saveProject(); menuOpen = false">Save project</button>
            <button type="button" @click="assetsOpen = true; menuOpen = false">Manage assets</button>
            <button type="button" @click="projectSettingsOpen = true; menuOpen = false">Project settings</button>
            <p>View</p>
            <button type="button" :aria-pressed="fullScreen" @click="toggleFullScreen(); menuOpen = false">
              {{ fullScreen ? 'Exit full screen' : 'Enter full screen' }}
            </button>
            <p>Bank</p>
            <button type="button" @click="editBank(); menuOpen = false">Add empty bank</button>
            <button type="button" :disabled="busy" @click="bankInput?.click(); menuOpen = false">Add bank from file</button>
            <button type="button" :disabled="banks.length <= 1" @click="removeBankOpen = true; menuOpen = false">Remove current bank</button>
            <button type="button" @click="editBank(selectedBank); menuOpen = false">Bank settings</button>
            <button type="button" @click="gridSettingsOpen = true; menuOpen = false">Grid settings</button>
          </nav>
        </template>
      </div>
      </div>
    </header>
    <div id="repeat-banner"></div>
    <input ref="projectInput" type="file" accept=".zip,.gpz,application/zip" hidden @change="loadProject">
    <input ref="bankInput" type="file" accept=".json,.zip,.gpz,application/json,application/zip" hidden @change="loadBank">
    <div v-if="storageError" class="storage-error" role="alert">
      {{ storageError }}
      <button v-if="storageBlocked" type="button" @click="replaceInvalidProject">Replace saved project</button>
    </div>
    <div v-if="recordingError" class="storage-error" role="alert">
      {{ recordingError }}
      <button type="button" @click="recordingError = ''">Dismiss</button>
    </div>
    <div v-if="projectError" class="storage-error" role="alert">
      {{ projectError }}
      <button type="button" @click="projectError = ''">Dismiss</button>
    </div>

    <section class="banks" aria-label="Banks">
      <button
        v-for="bank in banks"
        :key="bank.id"
        type="button"
        class="bank"
        :class="{ selected: selectedBankId === bank.id }"
        :style="{ '--bank-color': bank.color }"
        :aria-label="bank.title"
        :aria-pressed="selectedBankId === bank.id"
        @pointerdown="beginBankPress($event, bank)"
        @pointermove="moveBankPress"
        @pointerup="cancelBankPress"
        @pointercancel="cancelBankPress"
        @pointerleave="cancelBankPress"
        @contextmenu.prevent="cancelBankPress(); suppressBankClick = true; editBank(bank)"
        @click="selectBank(bank.id)"
      >
        <span class="bank-icon" aria-hidden="true">{{ bank.icon }}</span>
        <span class="bank-label">{{ bank.title }}</span>
      </button>
    </section>

    <section class="workspace" :aria-label="`${selectedBank.title} workspace`">
      <GrooveGrid
        v-for="bank in banks"
        v-show="bank.id === selectedBankId"
        :key="`${workspaceRevision}:${bank.id}`"
        :bank-id="bank.id"
        :banks="banks"
        :bank-events="bankEvents"
        :layout="bank.layout"
        :editing="editing && bank.id === selectedBankId"
        :wiring="wiring && bank.id === selectedBankId"
        :volume-mode="tool === 'volume' && bank.id === selectedBankId"
        :repeat-division="tool === 'repeat' && bank.id === selectedBankId ? repeatDivision : undefined"
        :settings-open="gridSettingsOpen && bank.id === selectedBankId"
        :bpm="bpm"
        :playing="playing"
        :transport-clock="transportClock"
        :start-on-input="startFromInput"
        :transport-start-immediate="true"
        :triggered-by-input="triggeredByInput"
        @close-settings="gridSettingsOpen = false"
      />
    </section>
    <SampleAssetsDialog v-if="assetsOpen" @close="assetsOpen = false" />
    <SettingsDialog v-if="bankSettings" title="Bank settings" @close="closeBankSettings">
      <form class="settings-form bank-form" @submit.prevent="closeBankSettings">
        <label>Title <input :value="bankSettings.title" required maxlength="80" @input="updateBankText($event, 'title')" @blur="updateBankText($event, 'title', true)"></label>
        <label>Icon <input :value="bankSettings.icon" required maxlength="16" @input="updateBankText($event, 'icon')" @blur="updateBankText($event, 'icon', true)"></label>
        <label>Color <input v-model="bankSettings.color" type="color"></label>
        <NumericSetting v-model="bankSettings.layout.columns" label="Columns" :min="Math.max(1, ...bankSettings.layout.items.map((item) => item.x + item.width))" :max="MAX_GRID_COLUMNS" integer />
        <NumericSetting v-model="bankSettings.layout.rows" label="Rows" :min="Math.max(1, ...bankSettings.layout.items.map((item) => item.y + item.height))" :max="MAX_GRID_ROWS" integer />
      </form>
    </SettingsDialog>
    <SettingsDialog v-if="removeBankOpen" title="Remove bank" @close="removeBankOpen = false">
      <p>Remove {{ selectedBank.title }} and its controls?</p>
      <div class="settings-actions">
        <button type="button" @click="removeCurrentBank">Remove bank</button>
        <button type="button" @click="removeBankOpen = false">Cancel</button>
      </div>
    </SettingsDialog>
    <SettingsDialog v-if="importedBanks" title="Choose a bank to import" @close="importedBanks = null">
      <div class="import-bank-list">
        <button v-for="bank in importedBanks" :key="bank.id" type="button" @click="addImportedBank(bank)">
          <span :style="{ color: bank.color }">{{ bank.icon }}</span> {{ bank.title }}
          ({{ bank.layout.columns }} × {{ bank.layout.rows }})
        </button>
      </div>
    </SettingsDialog>
    <TempoDialog v-if="projectSettingsOpen" v-model:bpm="bpm" v-model:info-text="infoText" v-model:info-scroll-speed="infoScrollSpeed"
      v-model:recording-format="recordingFormat" :supported-formats="supportedFormats" @close="projectSettingsOpen = false" />
  </main>
</template>
