import type { NormalizedColumn } from "./types";

/**
 * Tableau column header, expressed with the string values of the Taco toolkit enums
 * (DataType.Int === "int", ColumnRole.Measure === "measure", ...) so this file
 * does not depend on the toolkit and can be unit-tested.
 */
export interface TableauColumnHeader {
	id: string;
	alias: string;
	dataType: "string" | "date" | "datetime" | "int" | "float";
	columnRole: "dimension" | "measure";
	aggType?: "sum" | "avg";
	numberFormat?: "percentage";
	description?: string;
}

/** Tableau identifiers: keep letters, digits and underscores only. */
export const tableauId = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, "_");

/**
 * - metrics => measures; counts/amounts are summed, ratios (pct) are averaged
 *   (a ratio must not be summed; for exact ratios recompute them in Tableau from their components).
 * - dimensions => dimensions.
 */
export function toTableauColumns(columns: NormalizedColumn[]): TableauColumnHeader[] {
	return columns.map((c) => {
		const header: TableauColumnHeader = {
			id: tableauId(c.id),
			alias: c.label,
			dataType: c.type,
			columnRole: c.role === "metric" ? "measure" : "dimension",
			description: `Eulerian field: ${c.field}`
		};
		if (c.role === "metric") header.aggType = c.percentage ? "avg" : "sum";
		if (c.percentage) header.numberFormat = "percentage";
		return header;
	});
}

/** Table identifier/name shown in Tableau. */
export function tableName(site: string, kind: string): { id: string; name: string } {
	const short = kind.replace(/^rt#/, "");
	return { id: tableauId(`eulerian_${site}_${short}`), name: `Eulerian ${short} (${site})` };
}
