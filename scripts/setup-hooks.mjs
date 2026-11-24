import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'

try {
  const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' })
  if (configured.error || configured.status === null || configured.status > 1) {
    throw configured.error ?? new Error('Could not read Git hook configuration.')
  }
  const current = configured.stdout.trim()
  if (current && current !== '.githooks') throw new Error(`Git already uses another hooks directory: ${current}`)
  if (!current) {
    for (const hook of ['pre-commit', 'pre-merge-commit']) {
      const path = execFileSync('git', ['rev-parse', '--git-path', `hooks/${hook}`], { encoding: 'utf8' }).trim()
      if (existsSync(path)) throw new Error(`An existing ${hook} hook would be bypassed: ${path}`)
    }
  }
  for (const hook of ['pre-commit', 'pre-merge-commit']) chmodSync(`.githooks/${hook}`, 0o755)
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
  console.log('Git version hooks installed for this clone.')
} catch (error) {
  console.error(`Could not install Git hooks: ${error.message}`)
  process.exitCode = 1
}
