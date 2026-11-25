// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { isSavedProject, migrateSavedProject, type SavedProject } from './project'
import { samplesInBanks, type SampleAsset } from './sampleAssets'

export async function saveProjectToFile(project: SavedProject): Promise<Blob> {
  if (!isSavedProject(project)) throw new Error('Project is invalid.')
  const assets = [...(project.assets ?? [])]
  for (const asset of samplesInBanks(project.banks)) {
    if (!assets.some((entry) => entry.source === asset.source)) assets.push(asset)
  }
  const usedNames = new Set<string>()
  const files: { asset: SampleAsset; path: string; blob: Blob }[] = []
  for (const asset of assets) {
    const name = asset.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+|[. ]+$/g, '') || 'sample'
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    let filename = name
    let suffix = 2
    while (usedNames.has(filename.toLowerCase())) filename = `${stem}-${suffix++}${extension}`
    usedNames.add(filename.toLowerCase())
    const response = await fetch(asset.source)
    if (!response.ok) throw new Error(`Could not read sample: ${asset.name}`)
    files.push({ asset, path: `samples/${filename}`, blob: await response.blob() })
  }
  const paths = new Map(files.map((file) => [file.asset.source, file.path]))
  const banks = project.banks.map((bank) => ({
    ...bank,
    layout: {
      ...bank.layout,
      items: bank.layout.items.map(function serializeItem(item): typeof item {
        if (item.type === 'sub-grid') return {
          ...item,
          settings: {
            ...item.settings,
            layout: {
              ...item.settings.layout,
              items: item.settings.layout.items.map(serializeItem),
            },
          },
        }
        if (item.type !== 'instrument-pad' ||
          (item.settings.instrumentType !== 'sample-hit' && item.settings.instrumentType !== 'sample-loop') ||
          !item.settings.instrumentParams.sample) return item
        const path = paths.get(item.settings.instrumentParams.sample)
        if (!path) throw new Error('A pad sample is missing from the project assets.')
        return { ...item, settings: { ...item.settings, instrumentParams: { ...item.settings.instrumentParams, sample: path } } }
      }),
    },
  }))
  const bankFiles = project.banks.map((_, index) => `banks/bank-${index + 1}.json`)
  const manifest = JSON.stringify({
    version: project.version, bpm: project.bpm, infoText: project.infoText, infoScrollSpeed: project.infoScrollSpeed,
    recordingFormat: project.recordingFormat,
    selectedBankId: project.selectedBankId, bankFiles,
    assets: files.map(({ asset, path }) => ({
      name: asset.name, path, type: asset.source.slice(5, asset.source.indexOf(';base64,')),
    })),
  }, null, 2)
  const bankJson = banks.map((bank) => JSON.stringify(bank, null, 2))
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  await writer.add('manifest.json', new TextReader(manifest))
  for (const [index, bank] of bankJson.entries()) await writer.add(bankFiles[index]!, new TextReader(bank))
  await writer.add('samples/', undefined, { directory: true })
  for (const file of files) await writer.add(file.path, new BlobReader(file.blob))
  await writer.add('loop_midi/', undefined, { directory: true })
  return writer.close()
}

export async function loadProjectFromFile(blob: Blob): Promise<SavedProject> {
  const reader = new ZipReader(new BlobReader(blob))
  try {
    const entries = await reader.getEntries()
    const names = entries.map((entry) => entry.filename)
    if (new Set(names).size !== names.length) throw new Error('Project contains duplicate archive entries.')
    if (entries.some((entry) => !entry.directory && entry.filename.startsWith('loop_midi/'))) {
      throw new Error('Projects containing MIDI files are not supported yet.')
    }
    async function readJson(path: string): Promise<unknown> {
      const entry = entries.find((item) => item.filename === path)
      if (!entry || entry.directory) throw new Error(`Missing project file: ${path}`)
      return JSON.parse(await entry.getData(new TextWriter(), { checkSignature: true })) as unknown
    }
    const manifest = await readJson('manifest.json')
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) throw new Error('Invalid project manifest.')
    if (!('version' in manifest) || manifest.version !== 1) throw new Error('Unsupported project version.')
    if (!('bankFiles' in manifest) || !Array.isArray(manifest.bankFiles) || !manifest.bankFiles.length ||
      manifest.bankFiles.length > 256 || !manifest.bankFiles.every((path: unknown) =>
        typeof path === 'string' && /^banks\/bank-[1-9]\d*\.json$/.test(path)) ||
      new Set(manifest.bankFiles).size !== manifest.bankFiles.length) throw new Error('Invalid project bank list.')
    const banks: unknown[] = []
    for (const path of manifest.bankFiles) banks.push(await readJson(path))
    const assets: SampleAsset[] = []
    const sources = new Map<string, SampleAsset>()
    if ('assets' in manifest && manifest.assets !== undefined) {
      if (!Array.isArray(manifest.assets)) throw new Error('Invalid project assets.')
      for (const item of manifest.assets) {
        if (typeof item !== 'object' || item === null || Array.isArray(item) ||
          typeof item.name !== 'string' || typeof item.path !== 'string' ||
          !/^samples\/[^/\\]+$/.test(item.path) || item.path === 'samples/.' || item.path === 'samples/..' ||
          typeof item.type !== 'string' || /[,\r\n]/.test(item.type) ||
          sources.has(item.path)) throw new Error('Invalid project asset.')
        const entry = entries.find((candidate) => candidate.filename === item.path)
        if (!entry || entry.directory) throw new Error(`Missing project sample: ${item.path}`)
        const bytes = new Uint8Array(await (await entry.getData(new BlobWriter(), { checkSignature: true })).arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
        }
        const asset = { name: item.name, source: `data:${item.type};base64,${btoa(binary)}` }
        if (!assets.some((existing) => existing.source === asset.source)) assets.push(asset)
        sources.set(item.path, asset)
      }
    }
    if (entries.some((entry) => !entry.directory && entry.filename.startsWith('samples/') && !sources.has(entry.filename))) {
      throw new Error('Project contains an unlisted sample file.')
    }
    function restoreLayout(layout: unknown) {
      if (typeof layout !== 'object' || layout === null || !('items' in layout) ||
        !Array.isArray(layout.items)) return
      for (const item of layout.items) {
        if (typeof item !== 'object' || item === null) continue
        if (item.type === 'sub-grid' && typeof item.settings === 'object' && item.settings !== null &&
          'layout' in item.settings) restoreLayout(item.settings.layout)
        if (item.type !== 'instrument-pad' ||
          typeof item.settings !== 'object' || item.settings === null ||
          (item.settings.instrumentType !== 'sample-hit' && item.settings.instrumentType !== 'sample-loop') ||
          typeof item.settings.instrumentParams !== 'object' || item.settings.instrumentParams === null) continue
        const params = item.settings.instrumentParams
        if (typeof params.sample !== 'string' || !params.sample.startsWith('samples/')) continue
        const asset = sources.get(params.sample)
        if (!asset) throw new Error(`Missing project sample: ${params.sample}`)
        params.sample = asset.source
      }
    }
    for (const bank of banks) {
      if (typeof bank === 'object' && bank !== null && 'layout' in bank) restoreLayout(bank.layout)
    }
    const project: unknown = { ...manifest, banks, assets }
    migrateSavedProject(project)
    if (!isSavedProject(project)) throw new Error('Project data is invalid.')
    return project
  } finally {
    await reader.close()
  }
}
