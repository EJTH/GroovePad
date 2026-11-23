import type { GridItem, LoopAutomation, LoopNote, LoopQuantize } from './grid'

export type BankEvent =
  | { kind: 'live-note'; bankId: string; instrumentId: string; note: number; velocity: number; bend?: number; on: boolean }
  | { kind: 'live-automation'; bankId: string; sourceId: string; parameter: string; value: number; active?: boolean }
  | { kind: 'loop-note'; bankId: string; voiceId: string; note: LoopNote; on: boolean }
  | { kind: 'loop-automation'; bankId?: string; owner: string; event?: LoopAutomation }
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

  private now: () => number

  constructor(now: () => number = () => performance.now()) { this.now = now }

  position() {
    return this.beat + (this.running ? (this.now() - this.started) * this.tempo / 60000 : 0)
  }

  start(tempo: number) {
    this.beat = 0
    this.tempo = tempo
    this.started = this.now()
    this.running = true
  }

  setTempo(tempo: number) {
    this.beat = this.position()
    this.started = this.now()
    this.tempo = tempo
  }

  stop() {
    this.beat = this.position()
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
type State = { id: string; enabled: boolean; index: number; origin: number; last: number; pending?: { index: number; at: number }; countInUntil?: number; lastCountBeat?: number; voices: Voice[] }
type Recording = { index: number; start: number; origin: number; quantize: LoopQuantize; note: Omit<LoopNote, 'position' | 'duration'> }

export class SequencedLoopEngine {
  private states = new Map<string, State>()
  private recordings = new Map<string, Recording[]>()
  private voiceId = 0
  private loops: () => Loop[]
  private position: () => number
  private send: (id: number, note: LoopNote, on: boolean) => void
  private sendAutomation: (loopId: string, event?: LoopAutomation) => void
  private bankId: string
  private clipIndex: (loop: Loop) => number
  private countInClick: (beat: number) => void

  constructor(
    loops: () => Loop[],
    position: () => number,
    send: (id: number, note: LoopNote, on: boolean) => void,
    sendAutomation: (loopId: string, event?: LoopAutomation) => void = () => {},
    bankId = '',
    clipIndex: (loop: Loop) => number = (loop) => loop.settings.clipIndex,
    countInClick: (beat: number) => void = () => {},
  ) { this.loops = loops; this.position = position; this.send = send; this.sendAutomation = sendAutomation; this.bankId = bankId; this.clipIndex = clipIndex; this.countInClick = countInClick }

  isEnabled(id: string) { return this.states.get(id)?.enabled ?? false }
  isPending(id: string) { return !!this.states.get(id)?.pending }
  isCounting(id: string) { return this.states.get(id)?.countInUntil !== undefined }

  private startTime(loop: Loop, now: number) {
    const length = loop.settings.barLength * 4
    const counting = loop.settings.armed && loop.settings.countIn
    const earliest = counting ? Math.max(0, Math.ceil(now - 0.05)) + 4 : now
    const at = loop.settings.syncMode === 'sync' ? Math.ceil(earliest / length) * length : earliest
    return { at, counting }
  }

  toggle(loop: Loop, now = this.position()) {
    const state = this.states.get(loop.id)
    if (state?.enabled) {
      this.release(state)
      this.states.delete(loop.id)
      return
    }
    const { at, counting } = this.startTime(loop, now)
    const index = this.clipIndex(loop)
    this.states.set(loop.id, { id: loop.id, enabled: true, index, origin: at,
      last: at - 1e-8, pending: at > now ? { index, at } : undefined,
      ...(counting ? { countInUntil: at, lastCountBeat: at - 5 } : {}), voices: [] })
  }

  private release(state: State) {
    for (const voice of state.voices) this.send(voice.id, voice.note, false)
    state.voices = []
    this.sendAutomation(state.id)
  }

  tick() {
    const now = this.position()
    const loops = this.loops()
    for (const [id, state] of this.states) {
      const loop = loops.find((item) => item.id === id)
      if (!loop) { this.release(state); this.states.delete(id); continue }
      const { barLength, syncMode, clips, automation } = loop.settings
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
    for (const note of notes) addDue(note.position, { note }, 0)
    for (const event of automation) addDue(event.position, { automation: event }, 1)
    events.sort((a, b) => a.at - b.at || a.order - b.order)
    const releaseUntil = (at: number) => {
      let active = 0
      for (const voice of state.voices) {
        if (voice.end <= at) this.send(voice.id, voice.note, false)
        else state.voices[active++] = voice
      }
      state.voices.length = active
    }
    for (const event of events) {
      releaseUntil(event.at)
      if ('automation' in event) { this.sendAutomation(state.id, event.automation); continue }
      const voice = { id: ++this.voiceId, note: event.note, end: event.at + event.note.duration }
      state.voices.push(voice)
      this.send(voice.id, voice.note, true)
    }

    releaseUntil(now)
    state.last = now
  }

  recordAutomation(sourceId: string, parameter: string, value: number, active?: boolean, bankId = this.bankId) {
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
      events.push({ sourceId, parameter, value, position, ...(bankId !== this.bankId ? { bankId } : {}), ...(active === undefined ? {} : { active }) })
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
