// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { InjectionKey, Ref } from 'vue'
import type { Bank } from './project'
import type { SampleHitParams, SampleLoopParams } from './instruments/types'

export interface SampleAsset {
  name: string
  source: string
}

export interface SampleAssetStore {
  assets: Ref<SampleAsset[]>
  add: (asset: SampleAsset) => void
  remove: (source: string) => void
  swap: (source: string, replacement: SampleAsset) => void
}

export const sampleAssetKey: InjectionKey<SampleAssetStore> = Symbol('sample-assets')

export function setSample(params: SampleHitParams | SampleLoopParams, asset?: SampleAsset) {
  params.sample = asset?.source ?? ''
  params.sampleName = asset?.name ?? ''
  if ('start' in params) {
    params.start = 0
    params.end = 1
  } else {
    params.loopStart = 0
    params.loopEnd = 1
  }
  params.cuts = []
  params.playback = 'loopMode' in params && params.loopMode !== 'once' ? 'loop' : 'order'
}

export function samplesInBanks(banks: Bank[]): SampleAsset[] {
  const assets: SampleAsset[] = []
  const collectLayout = (layout: import('./grid').GridLayout) => {
    for (const item of layout.items) {
      if (item.type === 'sub-grid') collectLayout(item.settings.layout)
      if (item.type !== 'instrument-pad') continue
      const { instrumentType, instrumentParams } = item.settings
      if ((instrumentType === 'sample-hit' || instrumentType === 'sample-loop') && instrumentParams.sample &&
        !assets.some((asset) => asset.source === instrumentParams.sample)) {
        assets.push({ name: instrumentParams.sampleName, source: instrumentParams.sample })
      }
    }
  }
  for (const bank of banks) {
    collectLayout(bank.layout)
  }
  return assets
}

export function replaceSampleInBanks(banks: Bank[], source: string, replacement?: SampleAsset) {
  const replaceLayout = (layout: import('./grid').GridLayout) => {
    for (const item of layout.items) {
      if (item.type === 'sub-grid') replaceLayout(item.settings.layout)
      if (item.type !== 'instrument-pad') continue
      const { instrumentType, instrumentParams } = item.settings
      if ((instrumentType === 'sample-hit' || instrumentType === 'sample-loop') && instrumentParams.sample === source) {
        setSample(instrumentParams as SampleHitParams | SampleLoopParams, replacement)
      }
    }
  }
  for (const bank of banks) {
    replaceLayout(bank.layout)
  }
}

export async function readSampleFile(file: Blob): Promise<{ source: string; buffer: AudioBuffer }> {
  const context = new AudioContext()
  const sourcePromise = new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the file.'))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
  try {
    const [source, buffer] = await Promise.all([sourcePromise, file.arrayBuffer().then((data) => context.decodeAudioData(data))])
    return { source, buffer }
  } finally {
    await context.close()
  }
}
