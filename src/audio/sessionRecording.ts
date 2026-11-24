// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BaseContext, getDestination } from 'tone'
import { encodeWav } from './wav'

type Output = Pick<ReturnType<typeof getDestination>, 'connect' | 'disconnect'>
type Session = { stop: () => void; dispose: () => void }

export const RECORDING_FORMATS = [
  { id: 'ogg', label: 'Ogg (Opus)', mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
  { id: 'wav', label: 'WAV (16-bit PCM)', mimeType: '', extension: 'wav' },
  { id: 'mp3', label: 'MP3', mimeType: 'audio/mpeg', extension: 'mp3' },
  { id: 'm4a', label: 'M4A (MP4 audio)', mimeType: 'audio/mp4', extension: 'm4a' },
  { id: 'webm', label: 'WebM (Opus)', mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
] as const
export type RecordingFormat = typeof RECORDING_FORMATS[number]['id']

export function supportedRecordingFormats(): RecordingFormat[] {
  return RECORDING_FORMATS.filter((format) => format.id === 'wav'
    ? typeof AudioWorkletNode !== 'undefined' && globalThis.isSecureContext === true
    : typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported(format.mimeType)).map((format) => format.id)
}

export async function startSessionRecording(
  context: BaseContext,
  output: Output,
  format: RecordingFormat,
  onComplete: (audio: Blob) => void,
  onError: (error: Error) => void,
): Promise<Session> {
  const selected = RECORDING_FORMATS.find((item) => item.id === format)
  if (!selected || !supportedRecordingFormats().includes(format)) {
    throw new Error('The selected recording format is not supported in this browser. Choose another in project settings.')
  }
  if (format === 'wav') return startWavRecording(context, output, onComplete, onError)
  return startEncodedRecording(context, output, selected.mimeType, onComplete, onError)
}

function startEncodedRecording(
  context: BaseContext, output: Output, mimeType: string,
  onComplete: (audio: Blob) => void, onError: (error: Error) => void,
): Session {
  const destination = context.createMediaStreamDestination()
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(destination.stream, { mimeType })
    output.connect(destination)
  } catch (error) {
    destination.stream.getTracks().forEach((track) => track.stop())
    throw error
  }

  const chunks: Blob[] = []
  let finished = false
  let stopping = false

  function cleanup() {
    output.disconnect(destination)
    destination.stream.getTracks().forEach((track) => track.stop())
  }

  function fail(error: Error) {
    if (finished) return
    finished = true
    cleanup()
    if (recorder.state !== 'inactive') {
      try { recorder.stop() } catch (cause) { console.error('Could not stop failed session recording:', cause) }
    }
    onError(error)
  }

  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  recorder.onerror = (event) => {
    const cause = (event as Event & { error?: DOMException }).error
    fail(new Error(`Session recording failed${cause ? `: ${cause.message}` : '.'}`))
  }
  recorder.onstop = () => {
    if (finished) return
    if (!stopping) {
      fail(new Error('Session recording stopped unexpectedly.'))
      return
    }
    finished = true
    cleanup()
    const audio = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type })
    if (!audio.size) onError(new Error('The session recording was empty.'))
    else onComplete(audio)
  }

  try {
    recorder.start(1000)
  } catch (error) {
    finished = true
    cleanup()
    throw error
  }

  return {
    stop() {
      if (finished || stopping) return
      stopping = true
      try { recorder.stop() } catch (error) {
        fail(new Error(`Could not stop session recording: ${error instanceof Error ? error.message : String(error)}`))
      }
    },
    dispose() {
      if (finished) return
      finished = true
      cleanup()
      if (recorder.state !== 'inactive') {
        try { recorder.stop() } catch (error) { console.error('Could not stop session recording:', error) }
      }
    },
  }
}

async function startWavRecording(
  context: BaseContext, output: Output,
  onComplete: (audio: Blob) => void, onError: (error: Error) => void,
): Promise<Session> {
  const audioContext = context.rawContext
  if (typeof AudioWorkletNode === 'undefined' || !audioContext.audioWorklet) {
    throw new Error('WAV recording requires AudioWorklet support and a secure context (HTTPS or localhost).')
  }
  await audioContext.audioWorklet.addModule(new URL('./recording-processor.js', import.meta.url).href)
  const node = context.createAudioWorkletNode('recording-processor', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    channelCount: 2, channelCountMode: 'explicit', processorOptions: { channels: 2 },
  })
  const mute = audioContext.createGain()
  mute.gain.value = 0
  try {
    node.connect(mute)
    mute.connect(audioContext.destination)
    output.connect(node)
  } catch (error) {
    node.disconnect()
    mute.disconnect()
    throw error
  }

  const chunks: Float32Array[] = []
  let finished = false
  let stopping = false
  function cleanup() {
    output.disconnect(node)
    node.disconnect()
    mute.disconnect()
    node.port.close()
  }
  function fail(error: Error) {
    if (finished) return
    finished = true
    cleanup()
    onError(error)
  }
  node.onprocessorerror = () => fail(new Error('Session WAV recording failed.'))
  node.port.onmessage = (event: MessageEvent<{ type: string; samples?: Float32Array }>) => {
    if (finished) return
    if (event.data.type === 'samples' && event.data.samples) chunks.push(event.data.samples)
    if (event.data.type !== 'stopped') return
    if (!stopping) {
      fail(new Error('Session recording stopped unexpectedly.'))
      return
    }
    finished = true
    cleanup()
    try { onComplete(encodeWav(chunks, audioContext.sampleRate, 2)) } catch (error) {
      onError(new Error(`Could not finish session recording: ${error instanceof Error ? error.message : String(error)}`))
    }
  }
  return {
    stop() {
      if (finished || stopping) return
      stopping = true
      try { node.port.postMessage('stop') } catch (error) {
        fail(new Error(`Could not stop session recording: ${error instanceof Error ? error.message : String(error)}`))
      }
    },
    dispose() {
      if (finished) return
      finished = true
      cleanup()
    },
  }
}
