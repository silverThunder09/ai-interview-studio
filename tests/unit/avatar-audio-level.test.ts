import { describe, expect, it } from 'vitest';
import { audioMouthLevel } from '../../src/renderer/src/avatar/audio-level';

describe('audio-driven mouth level', () => {
  it('closes on silence and scales with measured audio energy', () => {
    expect(audioMouthLevel(new Float32Array())).toBe(0);
    expect(audioMouthLevel(new Float32Array([0, 0]))).toBe(0);
    const quiet = audioMouthLevel(new Float32Array([0.05, -0.05]));
    const loud = audioMouthLevel(new Float32Array([0.15, -0.15]));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(audioMouthLevel(new Float32Array([1, -1]))).toBe(1);
  });
  it('rejects invalid measurements without opening the mouth', () => {
    expect(audioMouthLevel(new Float32Array([NaN]))).toBe(0);
    expect(audioMouthLevel(new Float32Array([Infinity]))).toBe(0);
  });
});
