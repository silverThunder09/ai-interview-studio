import { resolve, sep } from 'node:path';

export const APP_URL = 'app://studio/index.html';
export const PRODUCTION_CSP = "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
export const DEVELOPMENT_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; worker-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";

export function developmentURL(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const url = new URL(candidate);
  if (url.origin !== 'http://127.0.0.1:5173' || url.pathname !== '/' ||
      url.username || url.password || url.search || url.hash) throw new Error('Invalid development URL');
  return url.href;
}

export function isTrustedSender(senderURL: string, expectedURL: string, topFrame: boolean): boolean {
  return topFrame && senderURL === expectedURL;
}

// Only entry HTML and generated assets are served; no arbitrary filesystem IPC.
export function assetPath(requestURL: string, root: string): string | null {
  try {
    const url = new URL(requestURL);
    if (url.protocol !== 'app:' || url.hostname !== 'studio' || url.port ||
        url.username || url.password || url.search || url.hash) return null;
    const path = decodeURIComponent(url.pathname);
    if (path !== '/index.html' && !/^\/assets\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.(m?js|css|woff2?)$/.test(path)) return null;
    const full = resolve(root, '.' + path);
    return full.startsWith(resolve(root) + sep) ? full : null;
  } catch { return null; }
}
