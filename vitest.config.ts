import { defineConfig } from 'vitest/config';
// Pin the settings tests depend on so a developer's own shell/.env can't change results.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], env: { ONEPAGE_SECTIONS: '', FULL_SECTIONS: '' } } });
