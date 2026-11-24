// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

export function pointerTap(activate: () => void) {
  const pointers = new Set<number>()

  function down(event: PointerEvent) {
    if ((event.pointerType !== 'touch' && event.button !== 0) || pointers.has(event.pointerId)) return
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    if (event.pointerType === 'touch') event.preventDefault()
    target.setPointerCapture(event.pointerId)
    pointers.add(event.pointerId)
  }

  function up(event: PointerEvent) {
    if (!pointers.delete(event.pointerId) || !(event.currentTarget instanceof HTMLElement)) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom) activate()
  }

  function cancel(event: PointerEvent) {
    pointers.delete(event.pointerId)
  }

  function click(event: MouseEvent) {
    if (event.detail === 0) activate()
  }

  return { down, up, cancel, click }
}
