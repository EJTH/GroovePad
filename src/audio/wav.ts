export function encodeWav(samples: Float32Array[], sampleRate: number, channels = 1): Blob {
  const length = samples.reduce((total, chunk) => total + chunk.length, 0)
  if (!length) throw new Error('The recording was empty. Please try again.')
  if (!Number.isInteger(channels) || channels < 1 || channels > 2 || length % channels !== 0) {
    throw new Error('The recording has invalid audio channels.')
  }
  if (length > (0xffffffff - 36) / 2) throw new Error('The recording is too large to encode as WAV.')
  const data = new ArrayBuffer(44 + length * 2)
  const view = new DataView(data)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, data.byteLength - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, length * 2, true)
  let offset = 44
  for (const chunk of samples) {
    for (const sample of chunk) {
      const value = Math.max(-1, Math.min(1, sample))
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([data], { type: 'audio/wav' })
}
