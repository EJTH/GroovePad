<script setup lang="ts">
import type { ADSREnvelope } from '../instruments/types'

interface Props {
  envelope: ADSREnvelope
  width?: number
  height?: number
}

const props = withDefaults(defineProps<Props>(), {
  width: 200,
  height: 50,
})

function getPathData(): string {
  const { attack, decay, sustain, release } = props.envelope

  const w = props.width
  const h = props.height

  const totalTime = attack + decay + 0.5 + release

  const x1 = (attack / totalTime) * w
  const x2 = x1 + (decay / totalTime) * w
  const x3 = x2 + (0.5 / totalTime) * w
  const x4 = w

  const y0 = h
  const y1 = h * 0.1
  const y2 = h - h * sustain
  const y3 = y2
  const y4 = h

  return `M 0 ${y0} L ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} L ${x4} ${y4}`
}

function getLabels(): Array<{ label: string; x: string; y: string }> {
  const labels: Array<{ label: string; x: string; y: string }> = []

  const { attack, decay, sustain, release } = props.envelope
  const w = props.width
  const h = props.height

  const totalTime = attack + decay + 0.5 + release

  const attackX = (attack / totalTime) * w * 0.5
  const decayX = (attack / totalTime) * w + (decay / totalTime) * w * 0.5
  const sustainX = (attack / totalTime) * w + (decay / totalTime) * w + (0.5 / totalTime) * w * 0.5
  const releaseX = w - (release / totalTime) * w * 0.5

  labels.push(
    { label: `A: ${attack.toFixed(3)}`, x: `${attackX}`, y: `${h * 0.3}` },
    { label: `D: ${decay.toFixed(3)}`, x: `${decayX}`, y: `${h * 0.3}` },
    { label: `S: ${(sustain * 100).toFixed(0)}%`, x: `${sustainX}`, y: `${h * 0.5}` },
    { label: `R: ${release.toFixed(3)}`, x: `${releaseX}`, y: `${h * 0.3}` },
  )

  return labels
}
</script>

<template>
  <div class="adsr-visualizer">
    <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none">
      <defs>
        <linearGradient id="adsr-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color: #b8d986; stop-opacity: 0.4" />
          <stop offset="100%" style="stop-color: #b8d986; stop-opacity: 0.1" />
        </linearGradient>
      </defs>
      <path :d="getPathData()" fill="url(#adsr-gradient)" stroke="#b8d986" stroke-width="2" />
      <line x1="0" :y1="height" :x2="width" :y2="height" stroke="#b8d986" stroke-width="1" opacity="0.3" />
      <text
        v-for="(label, idx) in getLabels()"
        :key="idx"
        :x="label.x"
        :y="label.y"
        font-size="10"
        fill="#e9face"
        text-anchor="middle"
      >
        {{ label.label }}
      </text>
    </svg>
  </div>
</template>

<style scoped>
.adsr-visualizer {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  background: #0a0a0a;
  border-radius: 4px;
  border: 1px solid #b8d986;
  padding: 8px;
  font-size: 11px;
}

svg {
  width: 100%;
  height: auto;
}
</style>
