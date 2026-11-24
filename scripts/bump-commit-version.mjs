import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { bumpStagedVersions } from './version.mjs'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

try {
  const diff = spawnSync('git', ['diff', '--quiet', '--', 'package.json', 'package-lock.json'], { stdio: 'inherit' })
  if (diff.error || diff.status === null || diff.status > 1) throw diff.error ?? new Error('Could not inspect version files.')
  if (diff.status === 1) throw new Error('Stage or discard unstaged changes to package.json and package-lock.json before committing.')

  const head = JSON.parse(git('show', 'HEAD:package.json'))
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  bumpStagedVersions(head, pkg, lock)
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
  writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`)
  git('add', '--', 'package.json', 'package-lock.json')
  console.log(`Commit version: ${pkg.version}`)
} catch (error) {
  console.error(`Version bump failed: ${error.message}`)
  process.exitCode = 1
}
