export function plannedSeed(definition: unknown): string;
export function verifyPlannedSeed(api: unknown, definition: unknown, head: string): Promise<void>;
export function verifyPlannedSpec(api: unknown, definition: unknown, main: string): Promise<void>;
export function preparePlannedPR(options: Record<string, unknown>): Promise<{ number: number }>;
