class RecordingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.channels = options?.processorOptions?.channels ?? 1
    this.samples = new Float32Array(4096 * this.channels)
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
    const input = inputs[0]
    if (input?.[0]) {
      for (let frame = 0; frame < input[0].length; frame++) {
        for (let channel = 0; channel < this.channels; channel++) {
          this.samples[this.length++] = input[channel]?.[frame] ?? 0
        }
        if (this.length === this.samples.length) this.flush()
      }
    }
    return true
  }
}

registerProcessor('recording-processor', RecordingProcessor)
