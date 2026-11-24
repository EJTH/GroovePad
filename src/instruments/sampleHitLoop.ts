// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

export interface HitLoopPlan {
  buffer: AudioBuffer
  startFrame: number
  endFrame: number
  loopStartFrame: number
  loopEndFrame: number
  loopStartOffset: number
  loopEndOffset: number
  firstPassLength: number
  reverse: boolean
  backAndForth: boolean
}

export function createSliceLoop(source: AudioBuffer, start: number, sliceEnd: number, end: number): HitLoopPlan {
  const startFrame = Math.min(source.length - 1, Math.floor(start * source.length))
  const endFrame = Math.min(source.length, Math.max(startFrame + 1, Math.floor(end * source.length)))
  const loopEndFrame = Math.max(startFrame + 1, Math.min(endFrame, Math.floor(sliceEnd * source.length)))
  const length = loopEndFrame - startFrame
  return {
    buffer: source, startFrame, endFrame, loopStartFrame: startFrame, loopEndFrame,
    loopStartOffset: 0, loopEndOffset: length, firstPassLength: length, reverse: false, backAndForth: false,
  }
}

export function createHitLoop(
  source: AudioBuffer,
  start: number,
  end: number,
  cuts: number[],
  reverse: boolean,
  backAndForth: boolean,
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer,
): HitLoopPlan {
  const startFrame = Math.min(source.length - 1, Math.floor(start * source.length))
  const endFrame = Math.min(source.length, Math.max(startFrame + 1, Math.floor(end * source.length)))
  const loopStartFrame = cuts.length > 1
    ? Math.max(startFrame, Math.min(endFrame - 1, Math.floor(cuts[0]! * source.length))) : startFrame
  const loopEndFrame = cuts.length
    ? Math.max(loopStartFrame + 1, Math.min(endFrame, Math.floor(cuts[cuts.length - 1]! * source.length))) : endFrame
  const loopLength = loopEndFrame - loopStartFrame
  const loopStartOffset = reverse ? endFrame - loopEndFrame : loopStartFrame - startFrame
  const firstPassLength = reverse ? endFrame - loopStartFrame : loopEndFrame - startFrame
  const outputLength = backAndForth ? firstPassLength + Math.max(0, loopLength - 2) : endFrame - startFrame
  const loopEndOffset = backAndForth ? outputLength : firstPassLength
  const buffer = createBuffer(source.numberOfChannels, outputLength, source.sampleRate)
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel)
    const output = buffer.getChannelData(channel)
    for (let i = 0; i < (backAndForth ? firstPassLength : outputLength); i++) {
      output[i] = input[reverse ? endFrame - 1 - i : startFrame + i]!
    }
    if (backAndForth) {
      for (let i = 0; i < loopLength - 2; i++) {
        output[firstPassLength + i] = input[reverse ? loopStartFrame + 1 + i : loopEndFrame - 2 - i]!
      }
    }
  }
  return { buffer, startFrame, endFrame, loopStartFrame, loopEndFrame, loopStartOffset, loopEndOffset, firstPassLength, reverse, backAndForth }
}

export function hitLoopPosition(plan: HitLoopPlan, elapsedFrames: number): { frame: number; reverse: boolean } {
  const elapsed = Math.max(0, Math.floor(elapsedFrames))
  const offset = elapsed < plan.loopEndOffset ? elapsed :
    plan.loopStartOffset + (elapsed - plan.loopStartOffset) % (plan.loopEndOffset - plan.loopStartOffset)
  const returning = plan.backAndForth && offset >= plan.firstPassLength
  const frame = returning
    ? (plan.reverse ? plan.loopStartFrame + 1 + offset - plan.firstPassLength : plan.loopEndFrame - 2 - (offset - plan.firstPassLength))
    : (plan.reverse ? plan.endFrame - 1 - offset : plan.startFrame + offset)
  let reverse = returning ? !plan.reverse : plan.reverse
  if (plan.backAndForth && frame >= plan.loopStartFrame && frame < plan.loopEndFrame) {
    if (frame === plan.loopEndFrame - 1 && plan.loopEndFrame - plan.loopStartFrame > 1) reverse = true
    if (frame === plan.loopStartFrame && plan.loopEndFrame - plan.loopStartFrame > 1) reverse = false
  }
  return { frame, reverse }
}

export function scheduleLoopRelease(
  plan: HitLoopPlan, elapsedFrames: number, releaseFrames: number,
): { waitFrames: number; frame: number; reverse: boolean; tailFrames: number } | undefined {
  const elapsed = Math.max(0, elapsedFrames)
  const end = elapsed + releaseFrames
  const cycle = plan.loopEndOffset - plan.loopStartOffset
  const directions = [{ reverse: plan.reverse, first: plan.firstPassLength }]
  if (plan.backAndForth && plan.loopEndFrame - plan.loopStartFrame > 1) {
    directions.push({ reverse: !plan.reverse, first: plan.loopEndOffset + 1 })
  }
  const hasTail = directions.some(({ reverse }) => reverse
    ? plan.loopStartFrame > plan.startFrame : plan.loopEndFrame < plan.endFrame)
  if (!hasTail) return undefined
  let best: { waitFrames: number; frame: number; reverse: boolean; tailFrames: number } | undefined
  let bestEnd = -Infinity
  for (const { reverse, first } of directions) {
    const tailFrames = reverse ? plan.loopStartFrame - plan.startFrame : plan.endFrame - plan.loopEndFrame
    if (!tailFrames) continue
    const cycles = Math.floor((end - tailFrames - first) / cycle)
    const boundary = first + cycles * cycle
    if (cycles < 0 || boundary < elapsed) continue
    const finish = boundary + tailFrames
    if (finish < bestEnd || (finish === bestEnd && best && boundary - elapsed <= best.waitFrames)) continue
    bestEnd = finish
    best = {
      waitFrames: boundary - elapsed,
      frame: reverse ? plan.loopStartFrame - 1 : plan.loopEndFrame,
      reverse,
      tailFrames,
    }
  }
  if (best) return best
  const position = hitLoopPosition(plan, elapsed)
  return {
    waitFrames: 0,
    frame: position.frame,
    reverse: position.reverse,
    tailFrames: position.reverse ? position.frame - plan.startFrame + 1 : plan.endFrame - position.frame,
  }
}
