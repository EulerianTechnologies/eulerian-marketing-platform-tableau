/** Stand-in for `@tableau/taco-toolkit` (app side). Not used by unit tests, kept for type-checking. */
export default class Connector {
	secrets: Record<string, string> | undefined;
	handlerInputs: unknown[] | undefined;
	constructor(onInit?: (c: Connector) => void) {
		onInit?.(this);
	}
	async get(_url: string, _o?: unknown) {
		return { body: {} as unknown };
	}
	async post(_url: string, _b?: object, _o?: unknown) {
		return { body: {} as unknown };
	}
	submit() {}
}
export { Connector };
