export function cloudTasks(): Promise<unknown[]>;
export function cloudDiff(id: string): Promise<string>;
export function inspectDirectResult(input: Record<string, unknown>): Promise<{ state: string; task_id?: string; files?: { path: string; content: string }[] }>;
