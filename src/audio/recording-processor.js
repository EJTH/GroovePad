class RecordingProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.samples = new Float32Array(4096)
    this.length = 0
    this.stopped = false
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this.flush()
        this.stopped = true
        this.port.postMessage({ type: 'stopped' })
      }
    }
  }

  flush() {
    if (!this.length) return
    const samples = this.samples.slice(0, this.length)
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer])
    this.length = 0
  }

  process(inputs) {
    if (this.stopped) return false
    const input = inputs[0]?.[0]
    if (input) {
      for (const sample of input) {
        this.samples[this.length++] = sample
        if (this.length === this.samples.length) this.flush()
      }
    }
    return true
  }
}

registerProcessor('recording-processor', RecordingProcessor)
