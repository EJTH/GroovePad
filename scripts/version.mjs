export function nextPatchVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!match || !Number.isSafeInteger(Number(match[3])) || Number(match[3]) >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`Cannot bump invalid or unsupported version: ${version}`)
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

export function bumpStagedVersions(head, pkg, lock) {
  const next = nextPatchVersion(head.version)
  if (pkg.version !== head.version && pkg.version !== next) {
    throw new Error('The staged package version was changed manually; commit that change with the hook disabled.')
  }
  if (!lock.packages?.['']) throw new Error('The package lock has no root package entry.')
  pkg.version = next
  lock.version = next
  lock.packages[''].version = next
}
