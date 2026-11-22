type PointerSample = Pick<PointerEvent, 'pointerType' | 'pressure' | 'clientX' | 'clientY'>
type Bounds = Pick<DOMRect, 'top' | 'left' | 'height' | 'width'>

export class ExpressionTracker {
  private readonly contacts = new Map<string | number, { value: number; pressureSupported: boolean }>()

  updatePointer(id: number, event: PointerSample, bounds: Bounds, axis: 'x' | 'y' = 'y'): number {
    const previous = this.contacts.get(id)
    const pressureSupported = event.pointerType !== 'mouse' &&
      (previous?.pressureSupported || (event.pressure > 0 && (event.pointerType === 'pen' || event.pressure !== 0.5)))
    const size = axis === 'y' ? bounds.height : bounds.width
    const position = size > 0 ? (axis === 'y' ? event.clientY - bounds.top : event.clientX - bounds.left) / size : 0
    const value = Math.round(Math.max(0, Math.min(1, pressureSupported ? event.pressure : position)) * 127)
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
    let value = 0
    for (const contact of this.contacts.values()) value = contact.value
    return value
  }
}
