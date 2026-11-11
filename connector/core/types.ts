/**
 * Shared types for the Eulerian Batch Reporting (flat aggregate) API.
 * This folder is pure TypeScript: no Tableau import, so it is unit-testable in Node.
 */

/** Predefined (`LAST_7_DAYS`), custom date-string, or epoch date range. */
export type DateRange =
	| { range: string }
	| { dateFrom: string; dateTo: string; dateFormat: string }
	| { from: number; to: number };

export type DateScale = "H" | "D" | "W" | "M";

/** A dimension or metric requested in a report. `field` must come from the discovery endpoints. */
export interface FieldRef {
	field: string;
	/** Free-form label returned in `columnHeader[].name`. */
	name?: string;
	/** Metric segmentation, e.g. `{ by: "ordertype" }` — expands into one column per segment value. */
	segment?: { by: string };
}

export interface FilterClause {
	field: string;
	operator: string;
	value: string | number | Array<string | number>;
}

export interface OrderBy {
	field: string;
	direction: "ASC" | "DESC";
}

/** Everything needed to run a report. The API token is NOT part of it (it travels as a secret). */
export interface ReportConfig {
	/** Customer API host, e.g. `acme.api.eulerian.com` (scheme optional). */
	host: string;
	/** Website name, e.g. `demo-fr`. */
	site: string;
	/** Data source, must start with `rt#`. */
	kind: string;
	/** Optional segmentation path from the segmentations endpoint. Omit to use the default. */
	path?: string;
	dimensions: FieldRef[];
	metrics: FieldRef[];
	/**
	 * 1 to 9 periods. With several, the request gets a `date_range` dimension (0-based index of the
	 * period of each row) unless it already has one: see query.ts (requestDimensions).
	 */
	dateRanges: DateRange[];
	dateScale?: DateScale;
	dateScalePer?: "H" | "D";
	language?: "en" | "fr" | "es";
	overwriteNameByAlias?: boolean;
	customLabels?: boolean;
	dimensionFilterClauses?: FilterClause[];
	metricFilterClauses?: FilterClause[];
	segmentFilterClauses?: FilterClause[];
	segments?: Array<Record<string, unknown>>;
	orderBy?: OrderBy[];
	/** Rows requested per API call and per period (default 1000): a page holds up to periods x pageSize rows. */
	pageSize?: number;
	/** Hard cap on rows fetched per period (default 100000): at most periods x maxRows rows in all. */
	maxRows?: number;
}

/** One entry of `columnHeader` as returned by the API (`affinity` per OpenAPI, `dataType` on every column). */
export interface ApiColumnHeader {
	field: string;
	name: string;
	type: "dimension" | "metric";
	dataType?: string;
	affinity?: string;
}

export interface FlatAggregateContent {
	kind: string;
	path?: string;
	rowCount: number;
	totalRowCount?: number;
	columnHeader: ApiColumnHeader[];
	data: Array<unknown[] | Record<string, unknown>>;
}

export type ColumnType = "string" | "date" | "datetime" | "int" | "float";

export interface NormalizedColumn {
	/** Stable column id: the API `field` (`__2` suffix when the API returns a field twice). */
	id: string;
	field: string;
	label: string;
	role: "dimension" | "metric";
	type: ColumnType;
	/** Ratio metric (`pct`): values are 0..1 and must not be summed. */
	percentage?: boolean;
}

export type CellValue = string | number | null;
export type NormalizedRow = Record<string, CellValue>;

export interface NormalizedPage {
	columns: NormalizedColumn[];
	rows: NormalizedRow[];
	path?: string;
	totalRowCount?: number;
}

export interface HttpRequest {
	method: "GET" | "POST";
	url: string;
	headers: Record<string, string>;
	body?: unknown;
}

/** Pluggable HTTP layer: Tableau's FetchUtils, the connector app, or `fetch` in tests. Returns parsed JSON. */
export type Transport = (req: HttpRequest) => Promise<unknown>;
