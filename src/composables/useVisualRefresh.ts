import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useVisualRefresh(target: Ref<Element | null>, fps: number, refresh: () => void) {
  const visible = ref(false)
  let mounted = false
  let intersecting = false
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastRefresh = performance.now()
  let observer: IntersectionObserver | undefined

  function schedule() {
    if (!mounted || !visible.value || !dirty || timer !== undefined) return
    const delay = Math.ceil(Math.max(0, 1000 / fps - (performance.now() - lastRefresh)))
    timer = setTimeout(() => {
      timer = undefined
      if (!mounted || !visible.value || !dirty) return
      if (performance.now() - lastRefresh < 1000 / fps) {
        schedule()
        return
      }
      dirty = false
      lastRefresh = performance.now()
      refresh()
    }, delay)
  }

  function request() {
    dirty = true
    schedule()
  }

  function updateVisibility() {
    visible.value = intersecting && document.visibilityState !== 'hidden'
    if (!visible.value && timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    schedule()
  }

  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', updateVisibility)
    if (typeof IntersectionObserver === 'undefined') {
      intersecting = true
      updateVisibility()
    } else {
      observer = new IntersectionObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === target.value)
        if (!entry) return
        intersecting = entry.isIntersecting
        updateVisibility()
      })
      if (target.value) observer.observe(target.value)
    }
  })

  onBeforeUnmount(() => {
    mounted = false
    if (timer !== undefined) clearTimeout(timer)
    observer?.disconnect()
    document.removeEventListener('visibilitychange', updateVisibility)
  })

  return { request, visible }
}
