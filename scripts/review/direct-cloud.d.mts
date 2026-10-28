export function launchCloud(input: { environment: string; branch: string; body: string }): Promise<{ id: string }>;
export function dispatchApprovedCloud(input: Record<string, unknown>): Promise<{ state: string; task_id?: string }>;
