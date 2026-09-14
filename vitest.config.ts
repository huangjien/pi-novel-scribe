/**
 * Vitest config. Coverage is enabled via @vitest/coverage-v8 on top of
 * the zero-config defaults. `extensions/wiki/db.ts` imports
 * `node:sqlite` via `createRequire(import.meta.url)` so Vite's SSR
 * loader is bypassed — no aliasing or external config needed.
 */
import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["extensions/**/*.ts"],
			exclude: [
				"**/*.test.ts",
				"**/*.d.ts",
				"**/node_modules/**",
				"**/dist/**",
				"extensions/index.ts",
			],
			thresholds: {
				// Informational only — surfaced in `npm run coverage`.
				// The tool wrappers + agents need ModelRegistry mocks to
				// lift the floor; defer to a follow-up.
				lines: 0,
				functions: 0,
				branches: 0,
				statements: 0,
			},
		},
	},
})
