export function keepScreenAwake(doc: Document, nav: Navigator): () => void {
  if (!('wakeLock' in nav)) return () => {}

  let lock: WakeLockSentinel | undefined
  let pending = false
  let stopped = false
  let generation = 0

  function removeInteractionRetry() {
    doc.removeEventListener('pointerdown', retryOnInteraction, true)
  }

  function retryOnInteraction() {
    removeInteractionRetry()
    void request(false)
  }

  function allowInteractionRetry() {
    doc.addEventListener('pointerdown', retryOnInteraction, { capture: true, passive: true, once: true })
  }

  function release(sentinel: WakeLockSentinel) {
    void sentinel.release().catch((error: unknown) => console.warn('Could not release screen wake lock:', error))
  }

  async function request(retryOnNextInteraction = true) {
    if (stopped || pending || lock || doc.visibilityState !== 'visible') return
    pending = true
    const requestedGeneration = generation
    try {
      const sentinel = await nav.wakeLock.request('screen')
      if (stopped || doc.visibilityState !== 'visible' || generation !== requestedGeneration) {
        release(sentinel)
      } else if (sentinel.released) {
        console.warn('Screen wake lock was already released.')
        if (retryOnNextInteraction) allowInteractionRetry()
      } else {
        lock = sentinel
        removeInteractionRetry()
        sentinel.addEventListener('release', () => {
          if (lock === sentinel) {
            lock = undefined
            if (!stopped && doc.visibilityState === 'visible') {
              allowInteractionRetry()
            }
          }
        })
      }
    } catch (error) {
      console.warn('Could not keep the screen awake:', error)
      if (!stopped && doc.visibilityState === 'visible' && generation === requestedGeneration) {
        if (retryOnNextInteraction) allowInteractionRetry()
      }
    } finally {
      pending = false
      if (!stopped && generation !== requestedGeneration && doc.visibilityState === 'visible') void request()
    }
  }

  function visibilityChanged() {
    if (doc.visibilityState === 'visible') void request()
    else {
      generation++
      removeInteractionRetry()
      if (lock) {
        const previous = lock
        lock = undefined
        release(previous)
      }
    }
  }

  doc.addEventListener('visibilitychange', visibilityChanged)
  void request()
  return () => {
    stopped = true
    removeInteractionRetry()
    doc.removeEventListener('visibilitychange', visibilityChanged)
    if (lock) {
      release(lock)
      lock = undefined
    }
  }
}
