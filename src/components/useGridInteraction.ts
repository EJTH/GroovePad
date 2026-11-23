import { computed, ref, type Ref } from 'vue'
import { canSwapItems, copyControl, isValidPlacement, type GridItem, type GridLayout } from '../grid'

interface Interaction {
  pointerId: number
  mode: 'move' | 'resize'
  startX: number
  startY: number
  original: GridItem
  candidate: GridItem
  moved: boolean
}

interface DropAction {
  original: GridItem
  candidate: GridItem
  swapId?: string
}

export function useGridInteraction(options: {
  getLayout: () => GridLayout
  isEditing: () => boolean
  grid: Ref<HTMLElement | null>
  message: Ref<string>
  openSettings: (item: GridItem) => void
  nextControlId: () => string
}) {
  const interaction = ref<Interaction | null>(null)
  const dropAction = ref<DropAction | null>(null)
  const canCopyDrop = computed(() => {
    const drop = dropAction.value
    return !!drop && isValidPlacement(options.getLayout(), copyControl(drop.candidate, options.nextControlId()))
  })

  function startInteraction(event: PointerEvent, item: GridItem, mode: 'move' | 'resize') {
    if (!options.isEditing() || interaction.value || event.button !== 0) return
    event.preventDefault()
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    target.setPointerCapture(event.pointerId)
    interaction.value = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      original: { ...item },
      candidate: { ...item },
      moved: false,
    }
  }

  function updateInteraction(event: PointerEvent) {
    const current = interaction.value
    const grid = options.grid.value
    const layout = options.getLayout()
    if (!current || current.pointerId !== event.pointerId || !grid) return
    const style = window.getComputedStyle(grid)
    const columnGap = parseFloat(style.columnGap) || 0
    const rowGap = parseFloat(style.rowGap) || 0
    const rect = grid.getBoundingClientRect()
    const stepX = (rect.width + columnGap) / layout.columns
    const stepY = (rect.height + rowGap) / layout.rows
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    current.moved ||= Math.abs(dx) > 5 || Math.abs(dy) > 5
    const deltaX = Math.round(dx / stepX)
    const deltaY = Math.round(dy / stepY)
    current.candidate = current.mode === 'move'
      ? { ...current.original, x: current.original.x + deltaX, y: current.original.y + deltaY }
      : { ...current.original, width: current.original.width + deltaX, height: current.original.height + deltaY }
  }

  function endInteraction(event: PointerEvent, cancelled = false) {
    const current = interaction.value
    const layout = options.getLayout()
    if (!current || current.pointerId !== event.pointerId) return
    if (!cancelled) updateInteraction(event)
    interaction.value = null
    if (cancelled) return
    if (!current.moved) {
      options.openSettings(current.original)
    } else if (current.mode === 'move') {
      const grid = options.grid.value
      if (!grid) return
      const rect = grid.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) {
        options.message.value = 'Drop the control inside the grid.'
        return
      }
      const x = Math.floor((event.clientX - rect.left) / rect.width * layout.columns)
      const y = Math.floor((event.clientY - rect.top) / rect.height * layout.rows)
      const target = layout.items.find((item) => item.id !== current.original.id &&
        x >= item.x && x < item.x + item.width && y >= item.y && y < item.y + item.height)
      if (target) {
        if (!canSwapItems(layout, current.original, target)) {
          options.message.value = 'These controls cannot be swapped without overlapping or leaving the grid.'
          return
        }
        dropAction.value = { original: current.original, candidate: current.candidate, swapId: target.id }
      } else if (current.candidate.x !== current.original.x || current.candidate.y !== current.original.y) {
        if (!isValidPlacement(layout, current.candidate)) {
          options.message.value = 'The control must fit inside the grid without overlapping another control.'
          return
        }
        dropAction.value = { original: current.original, candidate: current.candidate }
      }
      options.message.value = ''
    } else if (isValidPlacement(layout, current.candidate)) {
      const index = layout.items.findIndex((item) => item.id === current.original.id)
      if (index !== -1) layout.items[index] = current.candidate
      options.message.value = ''
    } else {
      options.message.value = 'The control must fit inside the grid without overlapping another control.'
    }
  }

  function completeDrop(action: 'move' | 'copy' | 'swap') {
    const drop = dropAction.value
    const layout = options.getLayout()
    if (!drop) return
    const index = layout.items.findIndex((item) => item.id === drop.original.id)
    if (index < 0) {
      options.message.value = 'The control no longer exists.'
    } else if (action === 'swap') {
      const otherIndex = layout.items.findIndex((item) => item.id === drop.swapId)
      const first = layout.items[index]
      const other = layout.items[otherIndex]
      if (!first || !other || !canSwapItems(layout, first, other)) {
        options.message.value = 'These controls cannot be swapped without overlapping or leaving the grid.'
      } else {
        layout.items[index] = { ...first, x: other.x, y: other.y }
        layout.items[otherIndex] = { ...other, x: first.x, y: first.y }
        options.message.value = ''
      }
    } else {
      const candidate = action === 'copy' ? copyControl(drop.candidate, options.nextControlId()) : drop.candidate
      if (!isValidPlacement(layout, candidate)) {
        options.message.value = 'The control must fit inside the grid without overlapping another control.'
      } else if (action === 'copy') {
        layout.items.push(candidate)
        options.message.value = ''
      } else {
        layout.items[index] = candidate
        options.message.value = ''
      }
    }
    dropAction.value = null
  }

  function itemStyle(item: GridItem) {
    const candidate = interaction.value?.original.id === item.id ? interaction.value.candidate : item
    const position = isValidPlacement(options.getLayout(), candidate) ? candidate : item
    return {
      gridColumn: `${position.x + 1} / span ${position.width}`,
      gridRow: `${position.y + 1} / span ${position.height}`,
    }
  }

  return { interaction, dropAction, canCopyDrop, startInteraction, updateInteraction, endInteraction, completeDrop, itemStyle }
}
