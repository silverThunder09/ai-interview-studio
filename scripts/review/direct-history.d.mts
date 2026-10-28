export function installDirectInventory(input: Record<string, unknown>): Promise<{ state: string; count?: number }>;
export function createDirectHistoryVerifier(input: Record<string, unknown>): (input: { task: unknown; state: unknown }) => Promise<boolean>;
