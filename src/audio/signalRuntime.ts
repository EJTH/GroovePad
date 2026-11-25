const refreshInterval = 1000 / 30
const visualRefreshes = new Set<(time: number) => void>()
const pendingRefreshes = new Set<() => void>()
let refreshFrame: number | undefined
let lastRefresh = Number.NEGATIVE_INFINITY

function scheduleRefresh() {
  if (refreshFrame === undefined && (visualRefreshes.size || pendingRefreshes.size)) {
    refreshFrame = requestAnimationFrame(runRefresh)
  }
}

function cancelRefreshIfIdle() {
  if (!visualRefreshes.size && !pendingRefreshes.size && refreshFrame !== undefined) {
    cancelAnimationFrame(refreshFrame)
    refreshFrame = undefined
  }
}

function runRefresh(time: number) {
  refreshFrame = undefined
  if (time - lastRefresh < refreshInterval) {
    scheduleRefresh()
    return
  }
  lastRefresh = time
  for (const refresh of [...visualRefreshes]) refresh(time)
  const pending = [...pendingRefreshes]
  pendingRefreshes.clear()
  for (const refresh of pending) refresh()
  scheduleRefresh()
}

export function subscribeVisualRefresh(refresh: (time: number) => void): () => void {
  visualRefreshes.add(refresh)
  scheduleRefresh()
  return () => {
    visualRefreshes.delete(refresh)
    cancelRefreshIfIdle()
  }
}

export class SignalRuntime {
  readonly values = new Map<string, number>()
  private readonly subscribers = new Set<() => void>()
  private pending = false
  private disposed = false
  private readonly flush = () => {
    this.pending = false
    if (!this.disposed) for (const subscriber of [...this.subscribers]) subscriber()
  }

  set(key: string, value: number, immediate = false) {
    if (this.disposed || this.values.get(key) === value) return
    this.values.set(key, value)
    this.scheduleFlush(immediate)
  }

  delete(key: string, immediate = false) {
    if (this.disposed || !this.values.delete(key)) return
    this.scheduleFlush(immediate)
  }

  refresh() {
    if (!this.disposed) this.scheduleFlush(false)
  }

  subscribe(subscriber: () => void) {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  dispose() {
    this.disposed = true
    this.values.clear()
    this.subscribers.clear()
    if (this.pending) pendingRefreshes.delete(this.flush)
    this.pending = false
    cancelRefreshIfIdle()
  }

  private scheduleFlush(immediate: boolean) {
    if (immediate) {
      pendingRefreshes.delete(this.flush)
      this.pending = false
      this.flush()
      return
    }
    if (this.pending) return
    this.pending = true
    pendingRefreshes.add(this.flush)
    scheduleRefresh()
  }
}
