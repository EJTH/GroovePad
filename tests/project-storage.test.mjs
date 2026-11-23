import assert from 'node:assert/strict'
import { test } from 'node:test'
import 'fake-indexeddb/auto'
import { createServer } from 'vite'

globalThis.FileReader ??= class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((bytes) => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`
      this.onload()
    }, (error) => {
      this.error = error
      this.onerror()
    })
  }
}

test('IndexedDB stores sample blobs and restores projects and shared samples', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { saveStoredProject, loadStoredProject } = await server.ssrLoadModule('/src/projectStorage.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const hit = createControl('hit', 0, 0, 'instrument-pad', 'sample-hit')
    const source = 'data:audio/wav;base64,YWJj'
    hit.settings.instrumentParams.sample = source
    hit.settings.instrumentParams.sampleName = 'beat.wav'
    const playingLoop = createControl('playing', 1, 0, 'sequenced-loop')
    const pausedLoop = createControl('paused', 2, 0, 'sequenced-loop')
    playingLoop.settings.playing = true
    pausedLoop.settings.playing = false
    const project = {
      version: 1, bpm: 120, infoText: '  Local   project info  ', infoScrollSpeed: 12.5, selectedBankId: 'A', assets: [{ name: 'beat.wav', source }],
      banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff',
        layout: { columns: 4, rows: 4, items: [hit, playingLoop, pausedLoop], connections: [] } }],
    }

    await saveStoredProject(project)
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('groovepad')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const stored = await new Promise((resolve, reject) => {
      const request = db.transaction('projects').objectStore('projects').get('current')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    assert.ok(stored.samples[0].blob instanceof Blob)
    assert.equal(stored.samples[0].blob.size, 3)
    assert.equal(stored.project.assets[0].source, stored.samples[0].id)
    assert.equal(stored.project.banks[0].layout.items[0].settings.instrumentParams.sample, stored.samples[0].id)
    assert.deepEqual(await loadStoredProject(), project)

    await saveStoredProject({ ...project, bpm: 135, assets: [], banks: [{
      ...project.banks[0], layout: { ...project.banks[0].layout, items: [] },
    }] })
    const updated = await loadStoredProject()
    assert.equal(updated.bpm, 135)
    assert.equal(updated.infoText, '  Local   project info  ')
    assert.equal(updated.infoScrollSpeed, 12.5)
    assert.deepEqual(updated.assets, [])
  } finally {
    await server.close()
  }
})
