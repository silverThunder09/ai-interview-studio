export const REPO: string;
export const LOOP_BRANCH: string;
export function acceptsLoopWakeup(event: unknown): boolean;
export interface LoopTask { id: string; pr: number; phase: string; cycles: number; request: unknown; delivery: unknown; operation: unknown; applied: unknown; review: unknown; merged: unknown; reason: unknown; [key: string]: unknown }
export interface LoopState { schema: number; repository: string; revision: number; config_hash: string; lease: null | { owner: string; until: number }; bootstrap?: null | { main: string; key: string; ready: boolean; checks?: { main: string; key: string; ready: boolean }[] }; tasks: LoopTask[] }
export function emptyLoopState(config: unknown): LoopState;
export function parseLoopConfig(config: unknown): { enabled: boolean; tasks: unknown[] };
export function parseLoopState(state: unknown, config: unknown): LoopState;
export function buildReviewRequest(request: unknown): string;
export function parseReviewResult(comment: unknown, request: unknown): { findings: string[]; comment_id: number; task_url: string };
export function renderLoopPRBody(original: string, task: unknown, review: unknown): string;
export function gatherMergeEvidence(...args: unknown[]): Promise<unknown>;
export function runLoop(options: Record<string, unknown>): Promise<{ state: string; changes: number }>;
export class LoopStore { constructor(api: unknown, config: unknown); load(): Promise<{ head: string; tree: string; state: LoopState }>; save(old: unknown, next: unknown): Promise<unknown> }
