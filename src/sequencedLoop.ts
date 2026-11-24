import type { GridItem, LoopAutomation, LoopNote, LoopQuantize } from './grid'
import { automationRow, noteRow, rowKey } from './loopRows'

export type BankEvent =
  | { kind: 'live-note'; bankId: string; instrumentId: string; note: number; velocity: number; bend?: number; on: boolean }
  | { kind: 'live-automation'; bankId: string; sourceId: string; parameter: string; value: number; active?: boolean; motion?: boolean }
  | { kind: 'live-automation-start'; bankId: string; sourceId: string; parameter: string; value: number }
  | { kind: 'live-automation-end'; bankId: string; sourceId: string; parameter: string }
  | { kind: 'loop-note'; bankId: string; voiceId: string; note: LoopNote; on: boolean }
  | { kind: 'loop-automation'; bankId?: string; owner: string; event?: LoopAutomation; remove?: boolean }
  | { kind: 'count-in-click'; beat: number }

export class BankEventBus {
  private listeners = new Set<(event: BankEvent) => void>()
  subscribe(listener: (event: BankEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(event: BankEvent) {
    for (const listener of this.listeners) listener(event)
  }
}

export class TransportClock {
  private beat = 0
  private started = 0
  private running = false
  private tempo = 120
  private stoppedBeat = 0
  private stoppedStarted: number

  private now: () => number

  constructor(now: () => number = () => performance.now()) { this.now = now; this.stoppedStarted = now() }

  position() {
    return this.beat + (this.running ? (this.now() - this.started) * this.tempo / 60000 : 0)
  }

  repeatPosition() {
    return this.running ? this.position() : this.stoppedBeat + (this.now() - this.stoppedStarted) * this.tempo / 60000
  }

  start(tempo: number) {
    this.beat = 0
    this.tempo = tempo
    this.started = this.now()
    this.running = true
  }

  setTempo(tempo: number) {
    this.stoppedBeat = this.repeatPosition()
    this.stoppedStarted = this.now()
    this.beat = this.position()
    this.started = this.now()
    this.tempo = tempo
  }

  stop() {
    this.beat = this.position()
    this.stoppedBeat = this.beat
    this.stoppedStarted = this.now()
    this.running = false
  }
}

export class Metronome {
  private lastBeat = -1
  private lastClick = -1
  private readonly play: (beat: number) => void
  constructor(play: (beat: number) => void) { this.play = play }
  reset() { this.lastBeat = -1; this.lastClick = -1 }
  click(beat: number) {
    if (beat <= this.lastClick) return
    this.lastClick = beat
    this.play(beat)
  }
  tick(position: number, enabled: boolean) {
    const beat = Math.floor(position)
    if (beat <= this.lastBeat) return
    this.lastBeat = beat
    if (enabled) this.click(beat)
  }
}

type Loop = Extract<GridItem, { type: 'sequenced-loop' }>
type Voice = { id: number; note: LoopNote; end: number }
type State = { id: string; enabled: boolean; index: number; origin: number; last: number; pending?: { index: number; at: number }; countInUntil?: number; lastCountBeat?: number; voices: Voice[]; automation: Map<string, LoopAutomation> }
type Recording = { index: number; start: number; origin: number; quantize: LoopQuantize; note: Omit<LoopNote, 'position' | 'duration'> }
type MotionRecording = { bucket: number; origin: number; loop: Loop; clip: number; events: LoopAutomation[]; event: LoopAutomation; pending?: LoopAutomation; last: number; recorded: Map<LoopAutomation, number> }

export class SequencedLoopEngine {
  private states = new Map<string, State>()
  private recordings = new Map<string, Recording[]>()
  private motions = new Map<string, MotionRecording>()
  private voiceId = 0
  private loops: () => Loop[]
  private position: () => number
  private send: (id: number, note: LoopNote, on: boolean, loopId: string) => void
  private sendAutomation: (loopId: string, event?: LoopAutomation, remove?: boolean) => void
  private bankId: string
  private clipIndex: (loop: Loop) => number
  private countInClick: (beat: number) => void

  constructor(
    loops: () => Loop[],
    position: () => number,
    send: (id: number, note: LoopNote, on: boolean, loopId: string) => void,
    sendAutomation: (loopId: string, event?: LoopAutomation, remove?: boolean) => void = () => {},
    bankId = '',
    clipIndex: (loop: Loop) => number = (loop) => loop.settings.clipIndex,
    countInClick: (beat: number) => void = () => {},
  ) { this.loops = loops; this.position = position; this.send = send; this.sendAutomation = sendAutomation; this.bankId = bankId; this.clipIndex = clipIndex; this.countInClick = countInClick }

  isEnabled(id: string) { return this.states.get(id)?.enabled ?? false }
  isPending(id: string) { return !!this.states.get(id)?.pending }
  isCounting(id: string) { return this.states.get(id)?.countInUntil !== undefined }
  playhead(id: string, index: number) {
    const state = this.states.get(id)
    const loop = this.loops().find((item) => item.id === id)
    const now = this.position()
    if (!state || !loop || state.index !== index || state.countInUntil !== undefined || now < state.origin) return undefined
    const length = loop.settings.barLength * 4
    return ((now - state.origin) % length + length) % length / length
  }

  private startTime(loop: Loop, now: number) {
    const length = loop.settings.barLength * 4
    const counting = loop.settings.armed && loop.settings.countIn
    const earliest = counting ? Math.max(0, Math.ceil(now - 0.05)) + 4 : now
    const at = loop.settings.syncMode === 'sync' ? Math.ceil(earliest / length) * length : earliest
    return { at, counting }
  }

  toggle(loop: Loop, now = this.position(), immediate = false) {
    const state = this.states.get(loop.id)
    if (state?.enabled) {
      this.release(state)
      this.states.delete(loop.id)
      return
    }
    const { at, counting } = immediate ? { at: now, counting: false } : this.startTime(loop, now)
    const index = this.clipIndex(loop)
    this.states.set(loop.id, { id: loop.id, enabled: true, index, origin: at,
      last: at - 1e-8, pending: at > now ? { index, at } : undefined,
      ...(counting ? { countInUntil: at, lastCountBeat: at - 5 } : {}), voices: [], automation: new Map() })
  }

  private release(state: State) {
    this.silence(state.id)
    this.sendAutomation(state.id)
    state.automation.clear()
  }

  silence(id: string) {
    const state = this.states.get(id)
    if (!state) return
    for (const voice of state.voices) this.send(voice.id, voice.note, false, state.id)
    state.voices = []
  }

  tick() {
    const now = this.position()
    const loops = this.loops()
    for (const [key, motion] of this.motions) {
      const state = this.states.get(motion.loop.id)
      const boundary = state?.pending && state.pending.index !== motion.clip && now >= state.pending.at
        ? state.pending.at : undefined
      if (!motion.loop.settings.armed || motion.loop.settings.automation[String(motion.clip)] !== motion.events ||
        (state && state.index !== motion.clip) || boundary !== undefined) {
        if (boundary !== undefined && motion.loop.settings.automation[String(motion.clip)] === motion.events) {
          this.overwriteMotion(motion, boundary)
        }
        this.flushMotion(motion)
        this.motions.delete(key)
      } else this.overwriteMotion(motion, now)
    }
    for (const [id, state] of this.states) {
      const loop = loops.find((item) => item.id === id)
      if (!loop) { this.release(state); this.states.delete(id); continue }
      const { barLength, syncMode, clips, automation } = loop.settings
      const muted = new Set((loop.settings.mutedRows?.[state.index] ?? []).map((row) => rowKey(row, this.bankId)))
      const activeNotes = new Set((clips[state.index] ?? []).map((note) => rowKey(noteRow(note), this.bankId)))
      state.voices = state.voices.filter((voice) => {
        const key = rowKey(noteRow(voice.note), this.bankId)
        if (!muted.has(key) && activeNotes.has(key)) return true
        this.send(voice.id, voice.note, false, state.id)
        return false
      })
      const activeRows = new Set((automation[state.index] ?? []).map((event) => rowKey(automationRow(event), this.bankId)))
      for (const [key, event] of state.automation) if (muted.has(key) || !activeRows.has(key)) {
        this.sendAutomation(state.id, event, true)
        state.automation.delete(key)
      }
      const clipIndex = this.clipIndex(loop)
      const length = barLength * 4
      if (state.countInUntil !== undefined) {
        if (!loop.settings.armed) {
          state.countInUntil = undefined
          const at = syncMode === 'sync' ? Math.ceil(now / length) * length : now
          state.index = clipIndex
          state.origin = at
          state.last = at - 1e-8
          state.pending = at > now ? { index: clipIndex, at } : undefined
        } else {
          const beat = Math.floor(now)
          if (beat >= state.countInUntil - 4 && beat < state.countInUntil && beat > (state.lastCountBeat ?? -1)) {
            state.lastCountBeat = beat
            this.countInClick(beat)
          }
          state.pending = { index: clipIndex, at: state.countInUntil }
          if (now < state.countInUntil) continue
          state.countInUntil = undefined
        }
      }
      if (state.index !== clipIndex && state.pending?.index !== clipIndex) {
        const at = syncMode === 'sync' ? Math.ceil(now / length) * length : now
        state.pending = { index: clipIndex, at }
      } else if (state.index === clipIndex && state.pending && state.pending.index !== clipIndex) {
        state.pending = undefined
      }
      const until = state.pending && now >= state.pending.at ? state.pending.at - 1e-8 : now
      if (until >= state.origin && !(state.pending && state.pending.index === state.index)) {
        this.playRange(state, clips[String(state.index)] ?? [], automation[String(state.index)] ?? [], length, until)
      }
      if (state.pending && now >= state.pending.at) {
        this.release(state)
        state.index = state.pending.index
        state.origin = state.pending.at
        state.last = state.origin - 1e-8
        state.pending = undefined
        this.playRange(state, clips[String(state.index)] ?? [], automation[String(state.index)] ?? [], length, now)
      }
    }
  }

  private playRange(state: State, notes: LoopNote[], automation: LoopAutomation[], length: number, now: number) {
    // Drop missed cycles after a suspended tab rather than replaying an unbounded backlog.
    if (now - state.last > length * 2) { this.release(state); state.last = now - length }
    const events: ({ at: number; order: number; note: LoopNote } | { at: number; order: number; automation: LoopAutomation })[] = []
    const addDue = (position: number, event: { note: LoopNote } | { automation: LoopAutomation }, order: number) => {
      const first = Math.max(0, Math.floor((state.last - state.origin - position) / length) + 1)
      const last = Math.floor((now - state.origin - position) / length)
      for (let cycle = first; cycle <= last; cycle++) {
        events.push({ ...event, order, at: state.origin + cycle * length + position })
      }
    }
    const loop = this.loops().find((item) => item.id === state.id)
    const muted = new Set((loop?.settings.mutedRows?.[state.index] ?? []).map((row) => rowKey(row, this.bankId)))
    for (const note of notes) if (!muted.has(rowKey(noteRow(note), this.bankId))) addDue(note.position, { note }, 0)
    for (const event of automation) if (!muted.has(rowKey(automationRow(event), this.bankId))) addDue(event.position, { automation: event }, 1)
    events.sort((a, b) => a.at - b.at || a.order - b.order)
    const releaseUntil = (at: number) => {
      let active = 0
      for (const voice of state.voices) {
        if (voice.end <= at) this.send(voice.id, voice.note, false, state.id)
        else state.voices[active++] = voice
      }
      state.voices.length = active
    }
    for (const event of events) {
      releaseUntil(event.at)
      if ('automation' in event) {
        state.automation.set(rowKey(automationRow(event.automation), this.bankId), event.automation)
        this.sendAutomation(state.id, event.automation)
        continue
      }
      const voice = { id: ++this.voiceId, note: event.note, end: event.at + event.note.duration }
      state.voices.push(voice)
      this.send(voice.id, voice.note, true, state.id)
    }

    releaseUntil(now)
    state.last = now
  }

  recordAutomation(sourceId: string, parameter: string, value: number, active?: boolean, bankId = this.bankId, motion = false, onlyExisting = false) {
    this.tick()
    const now = this.position()
    for (const loop of this.loops()) {
      if (!loop.settings.armed || (loop.settings.recordScope !== 'all' && bankId !== this.bankId)) continue
      const state = this.states.get(loop.id)
      if (state?.countInUntil !== undefined && now < state.countInUntil) continue
      const index = state && !state.pending ? state.index : this.clipIndex(loop)
      const origin = state && !state.pending ? state.origin : 0
      const length = loop.settings.barLength * 4
      const position = ((now - origin) % length + length) % length
      const events = loop.settings.automation[String(index)] ??= []
      if (onlyExisting && !events.some((event) => event.sourceId === sourceId && event.parameter === parameter &&
        (event.bankId ?? this.bankId) === bankId)) continue
      const event: LoopAutomation = { sourceId, parameter, value, position, ...(bankId !== this.bankId ? { bankId } : {}), ...(active === undefined ? {} : { active }) }
      const key = JSON.stringify([loop.id, bankId, sourceId, parameter])
      const previous = this.motions.get(key)
      const bucket = Math.floor((now - origin) / 0.125)
      if (motion && active !== false && previous && previous.bucket === bucket && previous.origin === origin &&
        previous.events === events && events.includes(previous.event)) {
        previous.pending = event
      } else {
        if (previous && (active === false || previous.events !== events || previous.origin !== origin)) {
          this.flushMotion(previous)
          this.motions.delete(key)
        }
        events.push(event)
        const inserted = events[events.length - 1]!
        if (motion && active !== false) {
          const current = this.motions.get(key)
          if (current) {
            current.bucket = bucket
            current.event = inserted
            current.pending = undefined
            current.recorded.set(inserted, now)
          } else {
            const recording: MotionRecording = { bucket, origin, loop, clip: index, events, event: inserted, last: now, recorded: new Map([[inserted, now]]) }
            this.motions.set(key, recording)
            this.overwriteMotion(recording, now, true)
          }
        }
        else this.motions.delete(key)
      }
    }
  }

  private overwriteMotion(motion: MotionRecording, now: number, includeStart = false) {
    const length = motion.loop.settings.barLength * 4
    const from = motion.last
    if (now < from) { motion.last = now; return }
    for (let i = motion.events.length - 1; i >= 0; i--) {
      const event = motion.events[i]!
      if (event.sourceId !== motion.event.sourceId || event.parameter !== motion.event.parameter ||
        (event.bankId ?? this.bankId) !== (motion.event.bankId ?? this.bankId)) continue
      const recordedAt = motion.recorded.get(event)
      const cycle = Math.ceil((from - motion.origin - event.position) / length)
      let at = motion.origin + cycle * length + event.position
      if (!includeStart && at <= from) at += length
      if (at <= now && (recordedAt === undefined || recordedAt < at - 1e-8)) {
        if (recordedAt !== undefined && event === motion.event) {
          if (motion.pending) {
            event.value = motion.pending.value
            event.active = motion.pending.active
            motion.pending = undefined
          }
          motion.recorded.set(event, at + Math.floor((now - at) / length) * length)
        } else {
          motion.events.splice(i, 1)
          motion.recorded.delete(event)
        }
      }
    }
    motion.last = now
  }

  private flushMotion(motion: MotionRecording) {
    const pending = motion.pending
    if (pending && motion.loop.settings.automation[String(motion.clip)] === motion.events &&
      motion.events.includes(motion.event) &&
      (pending.value !== motion.event.value || pending.active !== motion.event.active)) {
      motion.events.push(pending)
      motion.recorded.set(motion.events[motion.events.length - 1]!, motion.last)
    }
    motion.pending = undefined
  }

  endAutomation(sourceId: string, parameter: string, bankId = this.bankId) {
    this.tick()
    for (const loop of this.loops()) {
      const key = JSON.stringify([loop.id, bankId, sourceId, parameter])
      const motion = this.motions.get(key)
      if (motion) this.flushMotion(motion)
      this.motions.delete(key)
    }
  }

  record(instrumentId: string, note: number, velocity: number, bend: number | undefined, on: boolean, bankId = this.bankId) {
    this.tick()
    const now = this.position()
    for (const loop of this.loops()) {
      const key = JSON.stringify([loop.id, bankId, instrumentId, note])
      if (on && loop.settings.armed && (loop.settings.recordScope === 'all' || bankId === this.bankId)) {
        const state = this.states.get(loop.id)
        if (state?.countInUntil !== undefined && now < state.countInUntil) continue
        const index = state && !state.pending ? state.index : this.clipIndex(loop)
        const recording: Recording = { index, start: now, origin: state && !state.pending ? state.origin : 0, quantize: loop.settings.quantize,
          note: { instrumentId, note, velocity, ...(bankId !== this.bankId ? { bankId } : {}), ...(bend === undefined ? {} : { bend }) } }
        const pending = this.recordings.get(key) ?? []
        pending.push(recording)
        this.recordings.set(key, pending)
      } else if (!on) {
        const pending = this.recordings.get(key)
        const recording = pending?.shift()
        if (recording) this.finish(loop, recording, now)
        if (!pending?.length) this.recordings.delete(key)
      }
    }
  }

  private finish(loop: Loop, recording: Recording, now: number) {
    const length = loop.settings.barLength * 4
    const raw = ((recording.start - recording.origin) % length + length) % length
    const step = recording.quantize === 'off' ? 0 : 4 / Number(recording.quantize.slice(2))
    const position = step ? (Math.round(raw / step) * step) % length : raw
    const duration = Math.max(0.001, Math.min(length, now - recording.start))
    const clip = loop.settings.clips[String(recording.index)] ??= []
    clip.push({ ...recording.note, position, duration })
  }

  suspend() {
    const now = this.position()
    for (const [key, pending] of this.recordings) {
      const [loopId] = JSON.parse(key) as [string, string, string, number]
      const loop = this.loops().find((item) => item.id === loopId)
      if (loop) for (const recording of pending) this.finish(loop, recording, now)
    }
    this.recordings.clear()
    for (const motion of this.motions.values()) {
      if (motion.loop.settings.automation[String(motion.clip)] === motion.events) this.overwriteMotion(motion, now)
      this.flushMotion(motion)
    }
    this.motions.clear()
    for (const state of this.states.values()) this.release(state)
  }

  resume() {
    const now = this.position()
    for (const [id, state] of this.states) {
      const loop = this.loops().find((item) => item.id === id)
      if (!loop) { this.states.delete(id); continue }
      const { at, counting } = this.startTime(loop, now)
      state.index = this.clipIndex(loop)
      state.origin = at
      state.last = at - 1e-8
      state.pending = at > now ? { index: state.index, at } : undefined
      state.countInUntil = counting ? at : undefined
      state.lastCountBeat = counting ? at - 5 : undefined
    }
  }

  stop() {
    this.suspend()
    this.states.clear()
  }
}
