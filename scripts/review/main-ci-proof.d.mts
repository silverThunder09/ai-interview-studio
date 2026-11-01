export function verifyNativeMainCI(input: Record<string, unknown>): Promise<{ state: string }>;
export function mainCIFailure(error: unknown): { state: 'hold'; reason: 'main_ci_unavailable'; detail: string };
