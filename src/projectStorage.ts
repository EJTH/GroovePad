import { isSavedProject, migrateSavedProject, type SavedProject } from './project'
import { samplesInBanks } from './sampleAssets'
import { isBeta } from './appChannel'

interface StoredProject {
  project: unknown
  samples: { id: string; blob: Blob }[]
}

const blobs = new Map<string, Blob>()

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(isBeta ? 'groovepad-beta' : 'groovepad', 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open project storage.'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('Project storage is blocked by another open tab.'))
    }
  })
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Could not read a stored sample.'))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read a stored sample.'))
    reader.readAsDataURL(blob)
  })
}

export async function loadStoredProject(): Promise<SavedProject | undefined> {
  const db = await openDatabase()
  let stored: StoredProject | undefined
  try {
    stored = await new Promise((resolve, reject) => {
      const request = db.transaction('projects').objectStore('projects').get('current')
      request.onsuccess = () => resolve(request.result as StoredProject | undefined)
      request.onerror = () => reject(request.error ?? new Error('Could not read project storage.'))
    })
  } finally {
    db.close()
  }
  if (stored === undefined) return undefined
  if (!stored || !Array.isArray(stored.samples) || !stored.project) throw new Error('Stored project is invalid.')
  const sources = new Map<string, string>()
  for (const sample of stored.samples) {
    if (!sample || typeof sample.id !== 'string' || !(sample.blob instanceof Blob) || sources.has(sample.id)) {
      throw new Error('Stored samples are invalid.')
    }
    const source = await readDataUrl(sample.blob)
    sources.set(sample.id, source)
    blobs.set(source, sample.blob)
  }
  const data: unknown = JSON.parse(JSON.stringify(stored.project), (key, value: unknown) => {
    if ((key === 'source' || key === 'sample') && typeof value === 'string' && value.startsWith('indexeddb:')) {
      const source = sources.get(value)
      if (!source) throw new Error('A stored project sample is missing.')
      return source
    }
    return value
  })
  migrateSavedProject(data)
  if (!isSavedProject(data)) throw new Error('Stored project is invalid or unsupported.')
  return data
}

export async function saveStoredProject(project: SavedProject): Promise<void> {
  const assets = [...(project.assets ?? [])]
  for (const asset of samplesInBanks(project.banks)) {
    if (!assets.some((entry) => entry.source === asset.source)) assets.push(asset)
  }
  const ids = new Map(assets.map((asset, index) => [asset.source, `indexeddb:${index}`]))
  const snapshot: unknown = JSON.parse(JSON.stringify(project, (key, value: unknown) =>
    (key === 'source' || key === 'sample') && typeof value === 'string' ? (ids.get(value) ?? value) : value))
  const samples = await Promise.all(assets.map(async (asset) => {
    let blob = blobs.get(asset.source)
    if (!blob) {
      const response = await fetch(asset.source)
      if (!response.ok) throw new Error(`Could not read sample: ${asset.name}`)
      blob = await response.blob()
      blobs.set(asset.source, blob)
    }
    return { id: ids.get(asset.source)!, blob }
  }))
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite')
      transaction.objectStore('projects').put({ project: snapshot, samples } satisfies StoredProject, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not save project storage.'))
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save project storage.'))
    })
  } finally {
    db.close()
  }
  for (const source of blobs.keys()) if (!ids.has(source)) blobs.delete(source)
}
