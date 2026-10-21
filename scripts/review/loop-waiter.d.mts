export interface WaitRequest { pr: string; head: string; base: string; checkout: string; key: string }
export function parseWaitRequest(value: unknown): WaitRequest;
export function isPendingWakeup(state: unknown, input: unknown): boolean;
export function waitForCI(options: { api: { request(method: string, path: string, body?: unknown): Promise<unknown> }; loadState(): Promise<unknown>; input: unknown; now?: () => number; sleep?: (ms: number) => Promise<unknown>; timeout?: number; allowDispatch?: boolean }): Promise<{ state: string; ci_run?: number }>;
