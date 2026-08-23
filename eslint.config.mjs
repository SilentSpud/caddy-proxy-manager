import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

export default [
  {
    // public/maplibre holds maplibre-gl's minified worker bundle, staged from
    // node_modules at build time by scripts/copy-maplibre-worker.mjs.
    // `dist/**` and `coverage/**` are build/report output. They were not listed
    // before, so running `bun run build` (which emits dist/standalone) and then
    // `bun run lint` reported tens of thousands of errors in bundled code.
    ignores: [
      '.next/**',
      'dist/**',
      'coverage/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      '.claude/**',
      'public/maplibre/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@next/next/no-img-element': 'off',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
