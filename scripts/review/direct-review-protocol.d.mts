export function directReviewArtifactPath(request: unknown): string;
export function buildDirectReviewRequest(request: unknown, allowedPaths: string[]): string;
export function parseDirectReviewDiff(patch: string, request: unknown, allowedPaths: string[]): {
  schema: 1; repository: string; pr_number: number; request_key: string; head_sha: string; base_sha: string;
  outcome: 'complete' | 'blocked'; reason: string;
  findings: { path: string; line: number; severity: 'P0' | 'P1' | 'P2' | 'P3'; title: string; evidence: string; impact: string; acceptance: string }[];
};
