<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import GrooveGrid from './components/GrooveGrid.vue'
import SampleAssetsDialog from './components/SampleAssetsDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { canResizeGrid, copyControl, createControl, type GridLayout } from './grid'
import { isSavedProject, migrateSavedProject, type Bank } from './project'
import { loadProjectFromFile, saveProjectToFile } from './saveManager'
import { replaceSampleInBanks, sampleAssetKey, samplesInBanks, type SampleAsset } from './sampleAssets'
import { BankEventBus, TransportClock } from './sequencedLoop'

function createLayout(): GridLayout {
  return { columns: 4, rows: 4, items: [], connections: [] }
}

function createDefaultProject(): Bank {
  const layout: GridLayout = { columns: 4, rows: 4, items: [], connections: [] }

  const drums = [
    { label: 'Kick', drum: 'kick' as const, x: 0, y: 0 },
    { label: 'Snare', drum: 'snare' as const, x: 1, y: 0 },
    { label: 'Hi-Hat', drum: 'closed-hat' as const, x: 2, y: 0 },
    { label: 'Open Hat', drum: 'open-hat' as const, x: 3, y: 0 },
    { label: 'Tom', drum: 'tom' as const, x: 0, y: 1 },
    { label: 'Rim', drum: 'rim' as const, x: 1, y: 1 },
  ]

  for (const drum of drums) {
    const drumPad = createControl(`drum-${drum.drum}`, drum.x, drum.y, 'instrument-pad', '808')
    drumPad.label = drum.label
    if (drumPad.type === 'instrument-pad') {
      drumPad.settings.instrumentParams.drum = drum.drum
    }
    layout.items.push(drumPad)
  }

  const pianoRoll = createControl('piano-roll-1', 0, 2, 'piano-roll')
  pianoRoll.width = 4
  pianoRoll.height = 1
  pianoRoll.y = 3;
  if (pianoRoll.type === 'piano-roll') {
    pianoRoll.settings.octaves = 1
    pianoRoll.settings.scale = 'chromatic'
    pianoRoll.settings.orientation = 'horizontal'
  }
  layout.items.push(pianoRoll)

  const bass303 = createControl('bass-303', 3, 2, 'instrument-pad', '303')
  bass303.y = 2;
  bass303.width = 1
  bass303.height = 1
  bass303.label = 'Bass 303'
  layout.items.push(bass303)

  layout.connections.push({
    id: 'connection-piano-to-bass',
    sourceId: 'piano-roll-1',
    sourceParameter: 'note',
    targetId: 'bass-303',
    targetParameter: 'note',
  })

  return {
    id: 'A',
    title: 'Beat',
    icon: '♫',
    color: '#ff6b9d',
    layout,
  }
}

const banks = ref<Bank[]>([
  { id: 'A', title: 'Drums', icon: '▦', color: '#b8d986', layout: createLayout() },
  { id: 'B', title: 'Bass', icon: '≋', color: '#83c9bb', layout: createLayout() },
  { id: 'C', title: 'Keys', icon: '▥', color: '#b5a4df', layout: createLayout() },
  { id: 'D', title: 'Textures', icon: '✳', color: '#dfa88a', layout: createLayout() },
])

const selectedBankId = ref('A')
const bpm = ref(120)
const assets = ref<SampleAsset[]>([])
const storageKey = 'groovepad.project.v1'
const storageError = ref('')
let storageBlocked = false
let saveTimer: number | undefined

try {
  const saved = localStorage.getItem(storageKey)
  if (saved !== null) {
    const data: unknown = JSON.parse(saved)
    migrateSavedProject(data)
    if (!isSavedProject(data)) throw new Error('Saved project is invalid or unsupported.')
    banks.value = data.banks
    selectedBankId.value = data.selectedBankId
    bpm.value = data.bpm
    assets.value = data.assets ?? []
    for (const asset of samplesInBanks(data.banks)) addAsset(asset)
  }
} catch (error) {
  storageBlocked = true
  storageError.value = `Local project could not be loaded: ${error instanceof Error ? error.message : String(error)}. Saved data has not been overwritten.`
}

function saveLocalProject() {
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = undefined
  if (storageBlocked) return
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, bpm: bpm.value, banks: banks.value, selectedBankId: selectedBankId.value, assets: assets.value }))
    storageError.value = ''
  } catch (error) {
    storageError.value = `Local project could not be saved: ${error instanceof Error ? error.message : String(error)}.`
  }
}

function replaceInvalidProject() {
  storageBlocked = false
  saveLocalProject()
}

watch([banks, selectedBankId, bpm, assets], () => {
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

onMounted(() => {
  window.addEventListener('pagehide', saveLocalProject)
  document.addEventListener('fullscreenchange', syncFullScreen)
  syncFullScreen()
})
const selectedBank = computed(() => banks.value.find((bank) => bank.id === selectedBankId.value)!)
const playing = ref(false)
const transportClock = new TransportClock()
const bankEvents = new BankEventBus()
const beat = ref(0)
const menuOpen = ref(false)
const editing = ref(false)
const wiring = ref(false)
watch(editing, (value) => { if (!value) wiring.value = false })
const gridSettingsOpen = ref(false)
const projectSettingsOpen = ref(false)
const assetsOpen = ref(false)
const bpmDraft = ref(120)
const tempoError = ref('')
const projectError = ref('')
const busy = ref(false)
const projectInput = ref<HTMLInputElement | null>(null)
const bankInput = ref<HTMLInputElement | null>(null)
const bankDraft = ref<{ id: string | null; title: string; icon: string; color: string; columns: number; rows: number } | null>(null)
const bankError = ref('')
const removeBankOpen = ref(false)
const importedBanks = ref<Bank[] | null>(null)
const workspaceRevision = ref(0)
let longPressTimer: number | undefined
let longPressPosition: { x: number; y: number } | undefined
let suppressBankClick = false
let beatTimer: number | undefined

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

function updateBeatTimer() {
  if (beatTimer !== undefined) window.clearInterval(beatTimer)
  if (playing.value) {
    beatTimer = window.setInterval(() => {
      beat.value = (beat.value + 1) % 4
    }, 60000 / bpm.value)
  } else {
    beatTimer = undefined
    beat.value = 0
  }
}

function togglePlayback() {
  playing.value = !playing.value
  if (playing.value) transportClock.start(bpm.value)
  else transportClock.stop()
  beat.value = 0
  updateBeatTimer()
}
watch(bpm, () => { transportClock.setTempo(bpm.value); updateBeatTimer() }, { flush: 'sync' })

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
  bankError.value = ''
  bankDraft.value = bank
    ? { id: bank.id, title: bank.title, icon: bank.icon, color: bank.color, columns: bank.layout.columns, rows: bank.layout.rows }
    : { id: null, title: `Bank ${banks.value.length + 1}`, icon: '▦', color: '#b8d986', columns: 4, rows: 4 }
}

function saveBank() {
  const draft = bankDraft.value
  if (!draft) return
  const bank = draft.id ? banks.value.find((entry) => entry.id === draft.id) : undefined
  const layout = bank?.layout ?? createLayout()
  if (!draft.title.trim() || !draft.icon.trim() || !/^#[\da-f]{6}$/i.test(draft.color) ||
    !canResizeGrid(layout, draft.columns, draft.rows)) {
    bankError.value = 'Enter a title and icon, and choose a valid color and grid size that fits all controls.'
    return
  }
  if (draft.id && !bank) {
    bankError.value = 'Bank no longer exists.'
    return
  }
  layout.columns = draft.columns
  layout.rows = draft.rows
  if (bank) {
    bank.title = draft.title.trim()
    bank.icon = draft.icon.trim()
    bank.color = draft.color
  } else {
    const newBank = { id: nextBankId(), title: draft.title.trim(), icon: draft.icon.trim(), color: draft.color, layout }
    banks.value.push(newBank)
    selectedBankId.value = newBank.id
  }
  bankDraft.value = null
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
      version: 1, bpm: bpm.value, banks: banks.value, selectedBankId: selectedBankId.value, assets: assets.value,
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
    bankDraft.value = null
    banks.value = project.banks
    selectedBankId.value = project.selectedBankId
    bpm.value = project.bpm
    assets.value = project.assets ?? []
    for (const asset of samplesInBanks(project.banks)) addAsset(asset)
    workspaceRevision.value++
    storageBlocked = false
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

function saveTempo() {
  if (!Number.isFinite(bpmDraft.value) || bpmDraft.value < 1 || bpmDraft.value > 300) {
    tempoError.value = 'Tempo must be between 1 and 300 BPM.'
    return
  }
  bpm.value = bpmDraft.value
  tempoError.value = ''
  projectSettingsOpen.value = false
}

function newProject() {
  if (!window.confirm('Start a new project? The current project will be replaced.')) return
  gridSettingsOpen.value = false
  bankDraft.value = null
  banks.value = [createDefaultProject()]
  selectedBankId.value = 'A'
  bpm.value = 120
  assets.value = []
  workspaceRevision.value++
  storageBlocked = false
  saveLocalProject()
}

onUnmounted(() => {
  window.removeEventListener('pagehide', saveLocalProject)
  document.removeEventListener('fullscreenchange', syncFullScreen)
  saveLocalProject()
  if (beatTimer !== undefined) window.clearInterval(beatTimer)
  cancelBankPress()
})
</script>

<template>
  <main class="app">
    <header class="header">
      <section class="transport" aria-label="Transport">
        <button class="transport-button record" type="button" disabled aria-label="Record (not yet available)">
          <span class="record-icon" aria-hidden="true"></span>
        </button>
        <button
          class="transport-button"
          type="button"
          :aria-label="playing ? 'Pause' : 'Play'"
          :aria-pressed="playing"
          @click="togglePlayback"
        >
          <svg v-if="playing" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5h3v14H8zM14 5h3v14h-3z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4v16l13-8z" />
          </svg>
        </button>

        <div class="display" aria-label="Tempo and current bank">
          <div><strong>{{ bpm }}</strong><span>BPM</span></div>
          <div class="display-bank" :title="selectedBank.title">{{ selectedBank.title }}</div>
        </div>

        <div class="beats" aria-label="Beat indicator">
          <span
            v-for="index in 4"
            :key="index"
            :class="{ active: playing && beat === index - 1 }"
          ></span>
        </div>
      </section>
      <div class="header-actions">
        <button v-if="editing" class="icon-button" type="button" :aria-label="wiring ? 'Exit wire mode' : 'Wire controls'"
          :aria-pressed="wiring" title="Wire controls" @click="wiring = !wiring">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="6" r="2" /><circle cx="19" cy="18" r="2" />
            <path d="M7 6h3c6 0 0 12 6 12h1" />
          </svg>
        </button>
        <button class="icon-button" type="button" :aria-label="editing ? 'Exit edit mode' : 'Edit grid'"
          :aria-pressed="editing" title="Edit grid" @click="editing = !editing">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20l4-.8L19 8.2 15.8 5 4.8 16 4 20zM14.5 6.3l3.2 3.2M3 21h18" />
          </svg>
        </button>
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
            <div class="brand">GroovePad<span>.js</span></div>
            <p>Project</p>
            <button type="button" @click="newProject(); menuOpen = false">New project</button>
            <button type="button" :disabled="busy" @click="projectInput?.click(); menuOpen = false">Load project</button>
            <button type="button" :disabled="busy" @click="saveProject(); menuOpen = false">Save project</button>
            <button type="button" @click="assetsOpen = true; menuOpen = false">Manage assets</button>
            <button type="button" @click="bpmDraft = bpm; tempoError = ''; projectSettingsOpen = true; menuOpen = false">Project settings</button>
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
    <input ref="projectInput" type="file" accept=".zip,.gpz,application/zip" hidden @change="loadProject">
    <input ref="bankInput" type="file" accept=".json,.zip,.gpz,application/json,application/zip" hidden @change="loadBank">
    <div v-if="storageError" class="storage-error" role="alert">
      {{ storageError }}
      <button v-if="storageBlocked" type="button" @click="replaceInvalidProject">Replace saved project</button>
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
        :settings-open="gridSettingsOpen && bank.id === selectedBankId"
        :bpm="bpm"
        :playing="playing"
        :transport-clock="transportClock"
        @close-settings="gridSettingsOpen = false"
      />
    </section>
    <SampleAssetsDialog v-if="assetsOpen" @close="assetsOpen = false" />
    <SettingsDialog v-if="bankDraft" :title="bankDraft.id ? 'Bank settings' : 'Add bank'" @close="bankDraft = null">
      <form class="settings-form bank-form" @submit.prevent="saveBank">
        <label>Title <input v-model="bankDraft.title" required maxlength="80"></label>
        <label>Icon <input v-model="bankDraft.icon" required maxlength="16"></label>
        <label>Color <input v-model="bankDraft.color" type="color"></label>
        <label>Columns <input v-model.number="bankDraft.columns" type="number" min="1" max="8" required></label>
        <label>Rows <input v-model.number="bankDraft.rows" type="number" min="1" max="10" required></label>
        <p v-if="bankError" class="grid-message" role="alert">{{ bankError }}</p>
        <div class="settings-actions"><button type="submit">Save bank</button></div>
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
    <SettingsDialog v-if="projectSettingsOpen" title="Project settings" @close="projectSettingsOpen = false">
      <form class="settings-form bank-form" @submit.prevent="saveTempo">
        <label>Tempo (BPM) <input v-model.number="bpmDraft" type="number" min="1" max="300" step="any" required></label>
        <p v-if="tempoError" class="grid-message" role="alert">{{ tempoError }}</p>
        <div class="settings-actions"><button type="submit">Save tempo</button></div>
      </form>
    </SettingsDialog>
  </main>
</template>
