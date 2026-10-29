export function probeWriter(input: { credentials: { client(): Promise<unknown>; dispose(): Promise<unknown> }; checkMain(): Promise<void> }): Promise<{ state: string; reason?: string }>;
