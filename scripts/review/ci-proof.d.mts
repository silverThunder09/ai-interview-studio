export interface ExpectedCI { repository: string; pr_number: number; context: string; head_sha: string; base_sha: string; checkout_sha: string }
export interface CIEvidence extends ExpectedCI { run_id: string }
export function latestCheck(checks: unknown, context: string): Record<string, unknown>;
export function readJobCIEvidence(expected: ExpectedCI, checks: unknown, run: unknown, job: unknown, log: unknown): CIEvidence;
export function readAllReviews(api: { request(method: 'GET', path: string): Promise<unknown> }, prNumber: number): Promise<unknown[]>;
