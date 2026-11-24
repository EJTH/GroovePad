import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bumpStagedVersions, nextPatchVersion } from '../scripts/version.mjs'

test('commit versions increment patch and synchronize both lockfile versions', () => {
  const head = { version: '0.5.1' }
  const pkg = { version: '0.5.1' }
  const lock = { version: '0.0.0', packages: { '': { version: '0.0.0' } } }
  bumpStagedVersions(head, pkg, lock)
  assert.equal(pkg.version, '0.5.2')
  assert.equal(lock.version, '0.5.2')
  assert.equal(lock.packages[''].version, '0.5.2')
  bumpStagedVersions(head, pkg, lock)
  assert.equal(pkg.version, '0.5.2')
})

test('commit version rejects invalid versions and unrelated manual version changes', () => {
  assert.throws(() => nextPatchVersion('1.2.3-beta'))
  assert.throws(() => nextPatchVersion('1.2.9007199254740991'))
  assert.throws(() => bumpStagedVersions(
    { version: '1.2.3' }, { version: '1.3.0' }, { packages: { '': {} } },
  ))
})
