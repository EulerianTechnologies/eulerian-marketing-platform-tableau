import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The Taco toolkit only runs inside Tableau's sandbox: tests use lightweight stubs instead.
const stub = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@tableau/taco-toolkit/handlers": stub("./test/stubs/taco-handlers.ts"),
			"@tableau/taco-toolkit": stub("./test/stubs/taco-app.ts")
		}
	},
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		testTimeout: 30000,
		coverage: { include: ["connector/core/**", "connector/handlers/**", "connector/app/form-model.ts"] }
	}
});
