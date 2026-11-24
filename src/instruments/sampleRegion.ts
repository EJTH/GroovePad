// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

export function oneShotGateDuration(duration: number, attack: number, release: number): number {
  return Math.max(Math.min(attack, duration), duration - release)
}

export function createSampleRegion(
  source: AudioBuffer,
  start: number,
  end: number,
  reverse: boolean,
  backAndForth: boolean,
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer,
): AudioBuffer {
  const first = Math.min(source.length - 1, Math.floor(start * source.length))
  const last = Math.min(source.length, Math.max(first + 1, Math.floor(end * source.length)))
  const length = last - first
  const outputLength = backAndForth && length > 1 ? length * 2 - 2 : length
  const output = createBuffer(source.numberOfChannels, outputLength, source.sampleRate)
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel)
    const data = output.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] = input[reverse ? last - 1 - i : first + i]!
    if (backAndForth) {
      for (let i = 1; i < length - 1; i++) data[length + i - 1] = data[length - 1 - i]!
    }
  }
  return output
}
