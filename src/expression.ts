// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

type PointerSample = Pick<PointerEvent, 'pointerType' | 'pressure' | 'clientX' | 'clientY'>
type Bounds = Pick<DOMRect, 'top' | 'left' | 'height' | 'width'>

export class ExpressionTracker {
  private readonly contacts = new Map<string | number, { value: number; pressureSupported: boolean }>()

  updatePointer(id: number, event: PointerSample, bounds: Bounds, axis: 'x' | 'y' = 'y', reverse = false, usePressure = true): number {
    const previous = this.contacts.get(id)
    const pressureSupported = usePressure && event.pointerType !== 'mouse' &&
      (previous?.pressureSupported || (event.pressure > 0 && (event.pointerType === 'pen' || event.pressure !== 0.5)))
    const size = axis === 'y' ? bounds.height : bounds.width
    const position = size > 0 ? (axis === 'y' ? event.clientY - bounds.top : event.clientX - bounds.left) / size : 0
    const value = Math.round(Math.max(0, Math.min(1, pressureSupported ? event.pressure : reverse ? 1 - position : position)) * 127)
    this.set(id, value, pressureSupported)
    return value
  }

  set(id: string | number, value: number, pressureSupported = false) {
    this.contacts.delete(id)
    this.contacts.set(id, { value, pressureSupported })
  }

  remove(id: string | number) {
    this.contacts.delete(id)
  }

  clear() {
    this.contacts.clear()
  }

  get pressure(): number {
    let total = 0
    for (const contact of this.contacts.values()) total += contact.value
    return this.contacts.size ? Math.round(total / this.contacts.size) : 0
  }

  get active(): boolean {
    return this.contacts.size > 0
  }
}
