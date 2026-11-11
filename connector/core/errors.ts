/** Raised when the connector configuration is invalid (before any API call). */
export class ConfigError extends Error {
	readonly problems: string[];
	constructor(problems: string[]) {
		super(`Invalid Eulerian connector configuration:\n - ${problems.join("\n - ")}`);
		this.name = "ConfigError";
		this.problems = problems;
	}
}

/**
 * Raised when the API answers `{ "error": true }`.
 * NB: the Eulerian API reports errors with HTTP 200, so the body must always be checked.
 */
export class EulerianApiError extends Error {
	readonly code?: string;
	constructor(message: string, code?: string) {
		super(code ? `[${code}] ${message}` : message);
		this.name = "EulerianApiError";
		this.code = code;
	}
}

interface ApiEnvelope {
	error?: boolean;
	error_code?: string;
	error_msg?: string;
}

/** Throws EulerianApiError when the payload is an API error, otherwise returns it untouched. */
export function assertApiOk<T>(payload: T): T {
	const p = payload as unknown as ApiEnvelope | null;
	if (!p || typeof p !== "object") throw new EulerianApiError("Empty or non-JSON response from the Eulerian API");
	if (p.error === true) throw new EulerianApiError(p.error_msg ?? "Unknown Eulerian API error", p.error_code);
	return payload;
}
