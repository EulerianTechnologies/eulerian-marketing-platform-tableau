/**
 * Minimal stand-in for `@tableau/taco-toolkit/handlers` so handlers run under Vitest.
 * Only the surface used by EulerianFetcher / EulerianParser is reproduced, with the
 * same shapes as the real toolkit (v2.2.0 type definitions).
 */
export type DataRow = Record<string, string | number | boolean | object | null>;
export type ColumnHeader = { id: string; dataType: string; [k: string]: unknown };
export interface DataTable {
	id: string;
	name: string;
	columns: ColumnHeader[];
	rows: DataRow[];
	properties: Record<string, unknown>;
}
export interface DataContainer {
	tables: DataTable[];
}
export interface FetchOptions {
	handlerInput: { fetcher: string; parser: string; data: any };
	secrets?: Record<string, string | string[] | undefined>;
}
export interface ParseOptions {
	dataContainer: DataContainer;
	handlerInput?: unknown;
}

export const logs: string[] = [];
export const log = (msg: string) => void logs.push(msg);

/** Same contract as FetchUtils.fetchJson: parses JSON, rejects on HTTP errors. */
export const FetchUtils = {
	async fetchJson(url: string, opts: { method?: string; headers?: Record<string, unknown>; body?: string | object } = {}) {
		const res = await fetch(url, {
			method: opts.method ?? "GET",
			headers: opts.headers as Record<string, string>,
			body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	}
};

export abstract class Fetcher {
	abstract fetch(options: FetchOptions): AsyncGenerator;
}

class DataTableBuilder {
	constructor(private readonly table: DataTable) {}
	setId(id: string) {
		this.table.id = id;
	}
	addColumnHeaders(cols: ColumnHeader[]) {
		this.table.columns.push(...cols);
	}
	addRows(rows: DataRow[]) {
		this.table.rows.push(...rows);
	}
}

class DataContainerBuilder {
	constructor(private readonly container: DataContainer) {}
	getTable(name: string) {
		let table = this.container.tables.find((t) => t.name === name);
		const isNew = !table;
		if (!table) {
			table = { id: name, name, columns: [], rows: [], properties: {} };
			this.container.tables.push(table);
		}
		return { isNew, tableBuilder: new DataTableBuilder(table) };
	}
	getDataContainer() {
		return this.container;
	}
}

export abstract class Parser<T = any> {
	static createContainerBuilder(dc: DataContainer) {
		return new DataContainerBuilder(dc);
	}
	abstract parse(fetcherResult: T, options: ParseOptions): DataContainer;
}
