import type { ApiColumnHeader, CellValue, ColumnType, FlatAggregateContent, NormalizedColumn, NormalizedPage, NormalizedRow } from "./types";

/**
 * API type -> connector type.
 * The column type is read from `dataType` (set on every column), falling back to `affinity` (OpenAPI).
 * `date_range` (period index) is an int dimension, so it is loaded as a whole-number dimension.
 * Date fields: only formats observed on the API are typed as dates, other `date_*` dimensions stay strings.
 */
export function columnType(col: ApiColumnHeader): ColumnType {
	const t = (col.dataType ?? col.affinity ?? (col.type === "metric" ? "float" : "string")).toLowerCase();
	if (t === "date") {
		if (col.field === "date_day") return "date";
		if (col.field === "date_iso8601" || col.field === "date_hour") return "datetime";
		return "string";
	}
	if (t === "int") return "int";
	if (t === "float" || t === "pct" || t === "number") return "float";
	return "string";
}

/**
 * Maps `columnHeader` to normalized columns.
 * The API can give two different segment values the same field id (e.g. "N/A" and "N/A - 0" both as
 * `realscartvalidamount_ordertype_0`). Both columns are kept: the second id gets a
 * `__2` suffix and keeps its API label. Values are not changed.
 */
export function mapColumns(header: ApiColumnHeader[]): NormalizedColumn[] {
	const seen = new Map<string, number>();
	return header.map((col) => {
		const n = (seen.get(col.field) ?? 0) + 1;
		seen.set(col.field, n);
		const rawType = (col.dataType ?? col.affinity ?? "").toLowerCase();
		return {
			id: n === 1 ? col.field : `${col.field}__${n}`,
			field: col.field,
			label: col.name ?? col.field,
			role: col.type === "metric" ? "metric" : "dimension",
			type: columnType(col),
			...(rawType === "pct" ? { percentage: true } : {})
		};
	});
}

/** Converts a raw cell to the connector type. Dates become `YYYY-MM-DD`, datetimes `YYYY-MM-DD HH:MM:SS`. */
export function coerceValue(value: unknown, type: ColumnType): CellValue {
	if (value === null || value === undefined || value === "") return null;
	switch (type) {
		case "int":
		case "float": {
			const n = typeof value === "number" ? value : Number(value);
			if (!Number.isFinite(n)) return null;
			return type === "int" ? Math.round(n) : n;
		}
		case "date": {
			const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
			return m ? m[1] : null;
		}
		case "datetime": {
			// Documented formats: "2026-02-28 12:00:00.000" (date_iso8601) and "2026-02-28T12" (date_hour).
			const m = String(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2})(?::(\d{2}))?(?::(\d{2}))?/);
			return m ? `${m[1]} ${m[2]}:${m[3] ?? "00"}:${m[4] ?? "00"}` : null;
		}
		default:
			return String(value);
	}
}

/**
 * Turns one flat_aggregate `content` into typed rows keyed by column id.
 * Rows are loaded exactly as the API returns them (no row is added, removed or renamed).
 */
export function normalizeContent(content: FlatAggregateContent): NormalizedPage {
	const columns = mapColumns(content.columnHeader ?? []);
	const rows: NormalizedRow[] = (content.data ?? []).map((raw) => {
		// Object rows (showAsObject) are keyed by field: array rows are the only way to read both duplicates.
		const row: NormalizedRow = {};
		columns.forEach((col, i) => {
			const v = Array.isArray(raw) ? raw[i] : (raw as Record<string, unknown>)[col.field];
			row[col.id] = coerceValue(v, col.type);
		});
		return row;
	});
	return { columns, rows, path: content.path, totalRowCount: content.totalRowCount };
}
