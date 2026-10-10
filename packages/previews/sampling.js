import { BridgeError, MAX_FRAMES } from '../protocol/index.js';
export function sampleFrames({ startFrame, endFrameExclusive, count = 8, policy = 'uniform', frames }) {
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrameExclusive) || startFrame < 0 || endFrameExclusive <= startFrame)
    throw new BridgeError('INVALID_ARGUMENT', 'Range must be [startFrame,endFrameExclusive) with nonnegative integers');
  if (!Number.isInteger(count) || count < 1 || count > MAX_FRAMES) throw new BridgeError('INVALID_ARGUMENT', `count must be 1..${MAX_FRAMES}`);
  if (policy === 'explicit') {
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > MAX_FRAMES || frames.some(f => !Number.isSafeInteger(f) || f < startFrame || f >= endFrameExclusive))
      throw new BridgeError('INVALID_ARGUMENT', 'Explicit frames must be distinct valid frames in range');
    if (new Set(frames).size !== frames.length) throw new BridgeError('INVALID_ARGUMENT', 'Duplicate explicit frames');
    return frames;
  }
  if (policy !== 'uniform') throw new BridgeError('UNSUPPORTED_CAPABILITY', `Sampling policy ${policy} is unsupported`);
  const length = endFrameExclusive - startFrame;
  const n = Math.min(count, length);
  if (n === 1) return [startFrame];
  return Array.from({ length: n }, (_, i) => startFrame + Math.round(i * (length - 1) / (n - 1)));
}
