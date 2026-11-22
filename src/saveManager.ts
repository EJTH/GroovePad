import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { isSavedProject, type SavedProject } from './project'

const maxJsonSize = 2 * 1024 * 1024
const maxArchiveSize = 20 * 1024 * 1024

export async function saveProjectToFile(project: SavedProject): Promise<Blob> {
  if (!isSavedProject(project)) throw new Error('Project is invalid.')
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  const bankFiles = project.banks.map((_, index) => `banks/bank-${index + 1}.json`)
  await writer.add('manifest.json', new TextReader(JSON.stringify({
    version: project.version, bpm: project.bpm, selectedBankId: project.selectedBankId, bankFiles,
  }, null, 2)))
  for (const [index, bank] of project.banks.entries()) {
    await writer.add(bankFiles[index]!, new TextReader(JSON.stringify(bank, null, 2)))
  }
  await writer.add('samples/', undefined, { directory: true })
  await writer.add('loop_midi/', undefined, { directory: true })
  return writer.close()
}

export async function loadProjectFromFile(blob: Blob): Promise<SavedProject> {
  if (blob.size > maxArchiveSize) throw new Error('Project archive is too large.')
  const reader = new ZipReader(new BlobReader(blob))
  try {
    const entries = await reader.getEntries()
    const names = entries.map((entry) => entry.filename)
    if (new Set(names).size !== names.length) throw new Error('Project contains duplicate archive entries.')
    if (entries.some((entry) => !entry.directory &&
      (entry.filename.startsWith('samples/') || entry.filename.startsWith('loop_midi/')))) {
      throw new Error('Projects containing sample or MIDI files are not supported yet.')
    }
    async function readJson(path: string): Promise<unknown> {
      const entry = entries.find((item) => item.filename === path)
      if (!entry || entry.directory) throw new Error(`Missing project file: ${path}`)
      if (entry.uncompressedSize > maxJsonSize) throw new Error(`Project file is too large: ${path}`)
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
    const project: unknown = { ...manifest, banks }
    if (!isSavedProject(project)) throw new Error('Project data is invalid.')
    return project
  } finally {
    await reader.close()
  }
}
