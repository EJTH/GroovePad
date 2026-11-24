import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { MAX_LOOP_CLIP_INDEX, type GridItem, type GridLayout, type HeldNote, type LoopAutomation, type LoopNote, type ParameterOutput } from '../grid'
import { effectiveControls } from '../modulation'
import { outputs } from '../parameters'
import { applySettingsAutomation } from '../settingsAutomation'
import { pointerTap } from '../pointerTap'
import type { Bank } from '../project'
import { BankEventBus, SequencedLoopEngine, TransportClock, type BankEvent } from '../sequencedLoop'

type SequencedLoop = Extract<GridItem, { type: 'sequenced-loop' }>

export function useGridPlayback(options: {
  layout: () => GridLayout
  banks: () => Bank[] | undefined
  bankId: string
  bankEvents: BankEventBus
  clock: TransportClock
  playing: () => boolean | undefined
  editing: () => boolean
  transportStartImmediate: () => boolean | undefined
  triggeredByInput: () => boolean | undefined
  startOnInput: () => ((bankId: string) => Promise<boolean>) | undefined
  signals: Map<string, number>
  routeNote: (sourceId: string, output: ParameterOutput) => void
}) {
  const loopVoices = reactive(new Map<string, { instrumentId: string; note: number; velocity: number; bend?: number }>())
  const loopAutomation = reactive(new Map<string, Map<string, { sourceId: string; value: number; active?: boolean; sequence: number }>>())
  const liveControls = reactive(new Set<string>())
  const manualOverrides = reactive(new Map<string, number>())
  const settingTimers = reactive(new Map<string, ReturnType<typeof setTimeout> | undefined>())
  let settingGesture = false
  let automationSequence = 0
  const loopStatus = ref(new Map<string, { enabled: boolean; pending: boolean; counting: boolean }>())
  const loopPlayheads = ref(new Map<string, number>())
  const silentVoices = new Set<number>()
  const loopEngine = new SequencedLoopEngine(
    () => options.layout().items.filter((item): item is SequencedLoop => item.type === 'sequenced-loop'),
    () => options.clock.position(),
    (id, note, on, loopId) => {
      const loop = options.layout().items.find((item) => item.id === loopId && item.type === 'sequenced-loop')
      if (on && loop?.type === 'sequenced-loop') {
        note = { ...note, velocity: loop.settings.muted ? 0 : note.velocity * (loop.settings.volume ?? 1) }
        if (note.velocity === 0) { silentVoices.add(id); return }
      }
      if (!on && silentVoices.delete(id)) return
      options.bankEvents.emit({ kind: 'loop-note', bankId: note.bankId ?? options.bankId, voiceId: JSON.stringify([options.bankId, id]), note, on })
    },
    (id, event) => {
      options.bankEvents.emit({ kind: 'loop-automation', owner: JSON.stringify([options.bankId, id]), bankId: event ? (event.bankId ?? options.bankId) : undefined, event })
    },
    options.bankId,
    (loop) => {
      const effective = displayItems.value.find((item) => item.id === loop.id)
      return effective?.type === 'sequenced-loop' ? effective.settings.clipIndex : loop.settings.clipIndex
    },
    (beat) => options.bankEvents.emit({ kind: 'count-in-click', beat }),
  )
  watch(() => options.layout().items.filter((item): item is SequencedLoop => item.type === 'sequenced-loop')
    .map((item) => [item.id, item.settings.muted] as const), (loops) => {
    for (const [id, muted] of loops) if (muted) loopEngine.silence(id)
  }, { flush: 'sync' })

  function updateLoopStatus() {
    const next = new Map<string, { enabled: boolean; pending: boolean; counting: boolean }>()
    const playheads = new Map<string, number>()
    for (const item of options.layout().items) if (item.type === 'sequenced-loop') {
      next.set(item.id, { enabled: loopEngine.isEnabled(item.id), pending: loopEngine.isPending(item.id), counting: loopEngine.isCounting(item.id) })
      const displayed = displayItems.value.find((entry) => entry.id === item.id)
      const position = loopEngine.playhead(item.id, displayed?.type === 'sequenced-loop' ? displayed.settings.clipIndex : item.settings.clipIndex)
      if (position !== undefined) playheads.set(item.id, position * 100)
    }
    loopPlayheads.value = playheads
    if (next.size !== loopStatus.value.size || [...next].some(([id, status]) =>
      status.enabled !== loopStatus.value.get(id)?.enabled || status.pending !== loopStatus.value.get(id)?.pending ||
      status.counting !== loopStatus.value.get(id)?.counting)) loopStatus.value = next
  }

  function startArmedLoops() {
    for (const loop of options.layout().items) if (loop.type === 'sequenced-loop' &&
      loop.settings.armed && !loopEngine.isEnabled(loop.id)) {
      loop.settings.playing = true
      loopEngine.toggle(loop, options.clock.position(), true)
      updateLoopStatus()
    }
  }

  function setLoopArmed(loop: SequencedLoop, armed: boolean) {
    if (armed) {
      const layouts = options.banks()?.map((bank) => bank.layout) ?? []
      const layout = options.layout()
      if (!layouts.includes(layout)) layouts.push(layout)
      for (const bankLayout of layouts) for (const item of bankLayout.items) {
        if (item.type === 'sequenced-loop' && !(bankLayout === layout && item.id === loop.id)) {
          item.settings.armed = false
        }
      }
    }
    loop.settings.armed = armed
  }

  function toggleLoop(id: string) {
    const item = options.layout().items.find((entry) => entry.id === id)
    if (item?.type !== 'sequenced-loop') return
    if (!options.playing()) setLoopArmed(item, !item.settings.armed)
    else if (!item.settings.armed) {
      item.settings.playing = !loopEngine.isEnabled(id)
      loopEngine.toggle(item, options.clock.position())
      loopEngine.tick()
    }
    updateLoopStatus()
  }

  function changeLoopIndex(id: string, delta: number) {
    const loop = options.layout().items.find((item) => item.id === id)
    if (loop?.type !== 'sequenced-loop') return
    const index = Math.max(0, Math.min(MAX_LOOP_CLIP_INDEX, loop.settings.clipIndex + delta))
    loop.settings.clips[String(index)] ??= []
    loop.settings.automation[String(index)] ??= []
    loop.settings.clipIndex = index
  }

  function loopKeyDown(event: KeyboardEvent, id: string) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    changeLoopIndex(id, event.key === 'ArrowUp' ? 1 : -1)
  }

  function createLoopGesture(id: string) {
    const tap = pointerTap(() => toggleLoop(id))
    const pointers = new Map<number, { x: number; y: number; moved: boolean }>()
    function down(event: PointerEvent) {
      if ((event.pointerType !== 'touch' && event.button !== 0) || pointers.has(event.pointerId) ||
        !(event.currentTarget instanceof HTMLElement)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false })
      tap.down(event)
    }
    function move(event: PointerEvent) {
      const pointer = pointers.get(event.pointerId)
      if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 10) pointer.moved = true
    }
    function up(event: PointerEvent) {
      const pointer = pointers.get(event.pointerId)
      if (!pointer) return
      move(event)
      pointers.delete(event.pointerId)
      const dx = event.clientX - pointer.x
      const dy = event.clientY - pointer.y
      if (Math.abs(dy) >= 24 && Math.abs(dy) > Math.abs(dx)) {
        tap.cancel(event)
        changeLoopIndex(id, dy < 0 ? 1 : -1)
      } else if (pointer.moved) tap.cancel(event)
      else tap.up(event)
    }
    function cancel(event: PointerEvent) {
      pointers.delete(event.pointerId)
      tap.cancel(event)
    }
    return { down, move, up, cancel, click: tap.click }
  }

  const loopGestures = new Map<string, ReturnType<typeof createLoopGesture>>()
  function loopGesture(id: string) {
    let gesture = loopGestures.get(id)
    if (!gesture) { gesture = createLoopGesture(id); loopGestures.set(id, gesture) }
    return gesture
  }

  function recordedNotes(id: string): HeldNote[] {
    const notes = new Map<number, HeldNote>()
    for (const voice of loopVoices.values()) if (voice.instrumentId === id) {
      const previous = notes.get(voice.note)
      notes.set(voice.note, { note: voice.note, velocity: voice.velocity, bend: voice.bend, count: (previous?.count ?? 0) + 1 })
    }
    return [...notes.values()]
  }

  function selectedLoopNotes(item: SequencedLoop): LoopNote[] {
    return item.settings.clips[String(item.settings.clipIndex)] ?? []
  }

  function loopWantsPlayback(item: SequencedLoop) {
    return item.settings.playing ?? (loopEngine.isEnabled(item.id) || item.settings.armed)
  }

  function previewX(position: number, length: number) {
    return Math.max(0, Math.min(100, position / length * 100))
  }

  function previewY(value: number, min: number, max: number) {
    return max === min ? 24 : 44 - (value - min) / (max - min) * 36
  }

  function previewColor(sourceId: string, bankId?: string) {
    const layout = bankId && bankId !== options.bankId
      ? options.banks()?.find((bank) => bank.id === bankId)?.layout
      : options.layout()
    const source = layout?.items.find((item) => item.id === sourceId)
    return source && 'color' in source.settings ? source.settings.color : 'var(--accent)'
  }

  function loopPreviewCurves(item: SequencedLoop) {
    const groups = new Map<string, LoopAutomation[]>()
    for (const event of item.settings.automation[String(item.settings.clipIndex)] ?? []) {
      const key = JSON.stringify([event.sourceId, event.parameter, event.bankId ?? ''])
      const events = groups.get(key) ?? []
      events.push(event)
      groups.set(key, events)
    }
    const length = Math.max(1, item.settings.barLength * 4)
    return [...groups].map(([key, events]) => {
      const sorted = [...events].sort((a, b) => a.position - b.position)
      const min = sorted.reduce((value, event) => Math.min(value, event.value), Infinity)
      const max = sorted.reduce((value, event) => Math.max(value, event.value), -Infinity)
      const points = sorted.map((event) => ({
        x: previewX(event.position, length),
        y: previewY(event.value, min, max),
      }))
      let path = `M${points[0].x},${points[0].y}`
      if (points.length === 1) {
        path = `M${Math.max(0, points[0].x - 1.5)},${points[0].y} Q${points[0].x},${points[0].y - 2} ${Math.min(100, points[0].x + 1.5)},${points[0].y}`
      } else {
        for (let index = 1; index < points.length; index++) {
          const previous = points[index - 1]!
          const point = points[index]!
          path += ` Q${(previous.x + point.x) / 2},${previous.y} ${point.x},${point.y}`
        }
      }
      return { key, path, color: previewColor(events[0]!.sourceId, events[0]!.bankId) }
    })
  }

  function armLoop(id: string) {
    const loop = options.layout().items.find((item) => item.id === id)
    if (loop?.type !== 'sequenced-loop') return
    setLoopArmed(loop, !loop.settings.armed)
    if (loopWantsPlayback(loop) && options.playing() && !options.editing() && !loopEngine.isEnabled(id)) {
      loopEngine.toggle(loop, options.clock.position())
      loopEngine.tick()
    }
    updateLoopStatus()
  }

  function toggleLoopPlayback(id: string) {
    const loop = options.layout().items.find((item) => item.id === id)
    if (loop?.type !== 'sequenced-loop') return
    const shouldPlay = !loopWantsPlayback(loop)
    loop.settings.playing = shouldPlay
    if (options.playing() && !options.editing() && loopEngine.isEnabled(id) !== shouldPlay) {
      loopEngine.toggle(loop, options.clock.position())
      loopEngine.tick()
    }
    updateLoopStatus()
  }

  function clearLoopClip(id: string) {
    const item = options.layout().items.find((entry) => entry.id === id)
    const displayItem = displayItems.value.find((entry) => entry.id === id)
    if (item?.type !== 'sequenced-loop' || displayItem?.type !== 'sequenced-loop') return
    const index = String(displayItem.settings.clipIndex)
    item.settings.clips[index] = []
    item.settings.automation[index] = []
  }

  let inputStart: Promise<boolean> | undefined
  function beginInput() {
    const startOnInput = options.startOnInput()
    if (options.playing() || options.editing() || !startOnInput) return
    inputStart ??= startOnInput(options.bankId).finally(() => { inputStart = undefined })
  }

  function captureNote(id: string, note: number, on: boolean, velocity: number, bend?: number) {
    if (options.editing() && on) return
    const event: BankEvent = { kind: 'live-note', bankId: options.bankId, instrumentId: id, note, on, velocity, bend }
    if (options.playing()) options.bankEvents.emit(event)
    else {
      if (on) beginInput()
      if (inputStart) void inputStart.then((started) => { if (started) options.bankEvents.emit(event) })
    }
  }

  function receiveBankEvent(event: BankEvent) {
    if (event.kind === 'live-note') {
      if (options.playing()) {
        if (event.on) for (const loop of options.layout().items) if (loop.type === 'sequenced-loop' &&
          loop.settings.armed && (loop.settings.recordScope === 'all' || event.bankId === options.bankId) && !loopEngine.isEnabled(loop.id)) {
          loop.settings.playing = true
          loopEngine.toggle(loop, options.clock.position(), true)
          updateLoopStatus()
        }
        loopEngine.record(event.instrumentId, event.note, event.velocity, event.bend, event.on, event.bankId)
      }
    } else if (event.kind === 'live-automation') {
      if (options.playing()) loopEngine.recordAutomation(event.sourceId, event.parameter, event.value, event.active, event.bankId, event.motion)
    } else if (event.kind === 'live-automation-start') {
      if (options.playing()) loopEngine.recordAutomation(event.sourceId, event.parameter, event.value, undefined, event.bankId, true, true)
    } else if (event.kind === 'live-automation-end') {
      loopEngine.endAutomation(event.sourceId, event.parameter, event.bankId)
    } else if (event.kind === 'loop-note' && event.bankId === options.bankId) {
      if (!event.on) loopVoices.delete(event.voiceId)
      const source = options.layout().items.find((item) => item.id === event.note.instrumentId)
      if (source?.type === 'piano-roll') {
        options.routeNote(source.id, { parameter: 'note', value: event.note.note, on: event.on, velocity: event.note.velocity, bend: event.note.bend })
      } else if (source?.type === 'instrument-pad' && event.on) {
        loopVoices.set(event.voiceId, { instrumentId: source.id, note: event.note.note, velocity: event.note.velocity, bend: event.note.bend })
      }
    } else if (event.kind === 'loop-automation') {
      if (!event.event) { loopAutomation.delete(event.owner); return }
      if (event.bankId !== options.bankId) return
      let values = loopAutomation.get(event.owner)
      if (!values) { loopAutomation.set(event.owner, new Map()); values = loopAutomation.get(event.owner)! }
      values.set(`${event.event.sourceId}:${event.event.parameter}`, {
        sourceId: event.event.sourceId, value: event.event.value, active: event.event.active, sequence: ++automationSequence,
      })
    }
  }
  const unsubscribeBankEvents = options.bankEvents.subscribe(receiveBankEvent)

  let loopTimer: ReturnType<typeof setInterval> | undefined
  const playbackAutomation = computed(() => {
    const selected = new Map<string, { sourceId: string; value: number; active?: boolean; sequence: number }>()
    for (const values of loopAutomation.values()) for (const [key, event] of values) {
      if (!selected.has(key) || selected.get(key)!.sequence < event.sequence) selected.set(key, event)
    }
    return selected
  })

  const effectiveSignals = computed(() => {
    const result = new Map(options.signals)
    for (const [key, event] of playbackAutomation.value) {
      const source = options.layout().items.find((item) => item.id === event.sourceId)
      if (!source || liveControls.has(source.id) || (manualOverrides.get(key) ?? -1) >= event.sequence) continue
      if (event.active === false) result.delete(key)
      else result.set(key, event.value)
    }
    for (const item of options.layout().items) if (item.type === 'knob') {
      const parameter = 'setting:knob:value'
      const event = playbackAutomation.value.get(`${item.id}:${parameter}`)
      const output = playbackAutomation.value.get(`${item.id}:value`)
      if (event && (!output || event.sequence > output.sequence) && displayedAutomation(item.id, parameter) !== undefined) {
        result.set(`${item.id}:value`, event.value)
      }
    }
    return result
  })

  function controlActivity(id: string, active: boolean) {
    if (active) {
      const item = options.layout().items.find((entry) => entry.id === id)
      const value = playbackAutomation.value.get(`${id}:value`)
      if (item?.type === 'knob' && value && value.active !== false) {
        item.settings.value = Math.max(item.settings.min, Math.min(item.settings.max, value.value))
      }
      liveControls.add(id)
      if (item?.type === 'knob' && item.settings.recordAutomation && options.playing() && !options.editing()) {
        options.bankEvents.emit({ kind: 'live-automation-start', bankId: options.bankId, sourceId: id, parameter: 'value', value: item.settings.value })
      }
    } else {
      liveControls.delete(id)
      const item = options.layout().items.find((entry) => entry.id === id)
      if (item && (item.type === 'knob' || item.type === 'mod-wheel')) {
        options.bankEvents.emit({ kind: 'live-automation-end', bankId: options.bankId, sourceId: id, parameter: 'value' })
      }
      const layouts = options.banks()?.map((bank) => ({ bankId: bank.id, layout: bank.layout })) ??
        [{ bankId: options.bankId, layout: options.layout() }]
      const recording = layouts.some(({ bankId, layout }) => layout.items.some((entry) => entry.type === 'sequenced-loop' &&
        entry.settings.armed && (bankId === options.bankId || entry.settings.recordScope === 'all')))
      if (item && (item.type === 'knob' || item.type === 'mod-wheel')) {
        for (const output of outputs(item)) {
          if (recording && item.settings.recordAutomation) markManualOverride(id, output.id)
          else manualOverrides.delete(`${id}:${output.id}`)
        }
      }
    }
  }

  function markManualOverride(itemId: string, parameter: string) {
    manualOverrides.set(`${itemId}:${parameter}`, automationSequence)
  }

  function finishSettingChanges() {
    for (const [key, timer] of settingTimers) {
      if (timer !== undefined) clearTimeout(timer)
      const [sourceId, parameter] = JSON.parse(key) as [string, string]
      options.bankEvents.emit({ kind: 'live-automation-end', bankId: options.bankId, sourceId, parameter })
      markManualOverride(sourceId, parameter)
    }
    settingTimers.clear()
  }

  function setSettingGesture(active: boolean) {
    settingGesture = active
    if (!active) finishSettingChanges()
  }

  function recordSettingChange(sourceId: string, change: { id: string; value: number; continuous: boolean }) {
    if (!options.playing()) return
    const parameter = change.id
    const key = JSON.stringify([sourceId, parameter])
    const timer = settingTimers.get(key)
    markManualOverride(sourceId, parameter)
    const source = options.layout().items.find((item) => item.id === sourceId)
    if ((source?.type !== 'knob' && source?.type !== 'mod-wheel') || source.settings.recordAutomation) {
      options.bankEvents.emit({ kind: 'live-automation', bankId: options.bankId, sourceId, parameter,
        value: change.value, motion: change.continuous })
    }
    if (change.continuous) {
      if (timer !== undefined) clearTimeout(timer)
      settingTimers.set(key, settingGesture ? undefined : setTimeout(() => {
        options.bankEvents.emit({ kind: 'live-automation-end', bankId: options.bankId, sourceId, parameter })
        markManualOverride(sourceId, parameter)
        settingTimers.delete(key)
      }, 200))
    }
  }

  function displayedAutomation(id: string, parameter: string) {
    const key = `${id}:${parameter}`
    const event = playbackAutomation.value.get(key)
    return event && event.active !== false && !liveControls.has(id) && !settingTimers.has(JSON.stringify([id, parameter])) &&
      (manualOverrides.get(key) ?? -1) < event.sequence ? event.value : undefined
  }

  const displayItems = computed(() => {
    const layout = options.layout()
    const items = layout.items.map((item) => {
      const settings = new Map<string, number>()
      for (const [key, event] of playbackAutomation.value) {
        if (event.sourceId !== item.id) continue
        const parameter = key.slice(item.id.length + 1)
        if (!parameter.startsWith('setting:') || displayedAutomation(item.id, parameter) === undefined) continue
        settings.set(parameter, event.value)
      }
      const effective = settings.size ? applySettingsAutomation(item, settings) : item
      const enabled = effective.type === 'arpeggiator' ? effectiveSignals.value.get(`${item.id}:enabled`) : undefined
      return effective.type === 'arpeggiator' && enabled !== undefined
        ? { ...effective, settings: { ...effective.settings, enabled: enabled >= 0.5 } }
        : effective
    })
    return effectiveControls({ ...layout, items }, effectiveSignals.value)
  })
  watch(() => displayItems.value.filter((item) => item.type === 'sequenced-loop').map((item) =>
    ({ id: item.id, index: item.settings.clipIndex })), (selections) => {
    for (const selection of selections) {
      const loop = options.layout().items.find((item) => item.id === selection.id)
      if (loop?.type !== 'sequenced-loop') continue
      loop.settings.clips[String(selection.index)] ??= []
      loop.settings.automation[String(selection.index)] ??= []
    }
  }, { immediate: true, flush: 'sync' })

  watch(options.playing, (playing, previous) => {
    if (!playing) finishSettingChanges()
    if (loopTimer !== undefined) clearInterval(loopTimer)
    loopTimer = undefined
    if (!playing) loopEngine.stop()
    else {
      const starting = !previous
      const transportStarting = previous === false && !!options.transportStartImmediate()
      for (const loop of options.layout().items) if (loop.type === 'sequenced-loop' &&
        (loopWantsPlayback(loop) || (starting && options.triggeredByInput() && loop.settings.armed)) && !loopEngine.isEnabled(loop.id)) {
        if (starting && options.triggeredByInput() && loop.settings.armed) loop.settings.playing = true
        loopEngine.toggle(loop, transportStarting ? 0 : options.clock.position(),
          transportStarting || (starting && !!options.transportStartImmediate() && loop.settings.armed))
      }
      loopEngine.tick()
      loopTimer = setInterval(() => { loopEngine.tick(); updateLoopStatus() }, 20)
    }
  }, { immediate: true, flush: 'sync' })

  watch([options.playing, options.editing], ([playing, editing]) => {
    if (!playing || editing) { liveControls.clear(); manualOverrides.clear() }
    updateLoopStatus()
  }, { immediate: true, flush: 'sync' })

  onBeforeUnmount(() => {
    finishSettingChanges()
    if (loopTimer !== undefined) clearInterval(loopTimer)
    loopEngine.stop()
    unsubscribeBankEvents()
  })

  return {
    loopEngine,
    loopAutomation,
    liveControls,
    loopStatus,
    loopPlayheads,
    playbackAutomation,
    effectiveSignals,
    displayItems,
    startArmedLoops,
    updateLoopStatus,
    loopGesture,
    loopKeyDown,
    changeLoopIndex,
    toggleLoop,
    recordedNotes,
    selectedLoopNotes,
    loopWantsPlayback,
    previewX,
    previewY,
    previewColor,
    loopPreviewCurves,
    setLoopArmed,
    recordSettingChange,
    finishSettingChanges,
    setSettingGesture,
    armLoop,
    toggleLoopPlayback,
    clearLoopClip,
    beginInput,
    captureNote,
    controlActivity,
    markManualOverride,
    displayedAutomation,
  }
}
