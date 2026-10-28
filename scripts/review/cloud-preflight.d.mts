export interface CloudTask { id: string; status: string; known_status: boolean }
export function readTaskPages(run: (args: string[]) => Promise<string>, maxPages?: number): Promise<CloudTask[]>;
export function diagnose(input: { list: () => Promise<CloudTask[]>; limits: () => Promise<unknown> }): Promise<{ cloud: { state: string }; limits: { state: string }; dispatch_authorized: boolean }>;
