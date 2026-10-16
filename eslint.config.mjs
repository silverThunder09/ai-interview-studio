import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['out/**', 'release/**', 'release-notices/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
);
