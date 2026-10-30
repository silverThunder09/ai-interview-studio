/** Converts a time-domain audio frame to a bounded mouth opening. */
export function audioMouthLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return 0;
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, Math.max(0, (rms - 0.015) * 5));
}
