import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['dist/', '.astro/', 'node_modules/', 'public/', 'data/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  // Client-side code (the <script> in admin and src/scripts) runs in the browser.
  { files: ['src/scripts/**', '**/*.astro'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);
