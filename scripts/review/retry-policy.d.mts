export function planRetry(input: unknown, now: number): { action: 'hold' | 'wait' | 'retry'; reason?: string; due_at?: string };
