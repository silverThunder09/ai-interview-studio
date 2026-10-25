export class AppCredentials {
  constructor(options: Record<string, unknown>);
  client(): Promise<unknown>;
  dispose(): Promise<void>;
  ready(query: string, variables: unknown): Promise<unknown>;
}
export class ProductWriter {
  constructor(options: Record<string, unknown>);
  bind(context: Record<string, unknown>): { request(method: string, path: string, body?: unknown): Promise<unknown>; graphql(query: string, variables: unknown): Promise<unknown> };
}
