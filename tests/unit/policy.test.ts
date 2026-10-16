import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { APP_URL, assetPath, developmentURL, isTrustedSender } from '../../src/main/policy';

describe('resource and sender policy', () => {
  it('serves only the app entry and generated assets', () => {
    expect(assetPath(APP_URL, '/bundle')).toBe(resolve('/bundle/index.html'));
    expect(assetPath('app://studio/assets/index-abc_123.js', '/bundle')).toBe(resolve('/bundle/assets/index-abc_123.js'));
  });
  it.each([
    'app://attacker/index.html', 'https://studio/index.html', 'app://studio:80/index.html',
    'app://user:password@studio/index.html', 'app://studio/index.html?file=secret',
    'app://studio/../../secret.txt', 'app://studio/assets/%2e%2e%2fsecret.js',
    'app://studio/assets/..%5csecret.js', 'file:///etc/passwd', 'app://studio/assets/%00.js',
    'app://studio/assets/index.js.map', 'app://studio/%zz', 'not a URL',
  ])('rejects unintended resource %s', (url) => { expect(assetPath(url, '/bundle')).toBeNull(); });
  it('requires both exact URL and main frame', () => {
    expect(isTrustedSender(APP_URL, APP_URL, true)).toBe(true);
    expect(isTrustedSender(APP_URL, APP_URL, false)).toBe(false);
    expect(isTrustedSender(`${APP_URL}?attacker`, APP_URL, true)).toBe(false);
    expect(isTrustedSender('app://attacker/index.html', APP_URL, true)).toBe(false);
    expect(isTrustedSender('', APP_URL, true)).toBe(false);
  });
  it('accepts only the explicit development origin and root', () => {
    expect(developmentURL(undefined)).toBeUndefined();
    expect(developmentURL('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/');
  });
  it.each(['https://example.com', 'http://localhost:5173', 'http://127.0.0.1:5173/secret', 'http://127.0.0.1:5173/?x', 'http://user@127.0.0.1:5173', 'bad'])('rejects dev URL %s', (url) => {
    expect(() => developmentURL(url)).toThrow();
  });
});
