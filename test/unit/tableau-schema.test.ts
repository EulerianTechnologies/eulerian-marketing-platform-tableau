import { describe, expect, it } from "vitest";
import { tableName, tableauId, toTableauColumns } from "../../connector/core/tableau-schema";
import { mapColumns } from "../../connector/core/normalize";

describe("toTableauColumns", () => {
	it("maps roles, aggregation and formats", () => {
		const cols = toTableauColumns(
			mapColumns([
				{ field: "media_key_po", name: "Channel", type: "dimension", dataType: "string" },
				{ field: "visit", name: "Visits", type: "metric", dataType: "int" },
				{ field: "realscartvalid_visit", name: "CR", type: "metric", affinity: "pct" }
			])
		);
		expect(cols.map((c) => [c.id, c.columnRole, c.aggType, c.numberFormat])).toEqual([
			["media_key_po", "dimension", undefined, undefined],
			["visit", "measure", "sum", undefined],
			["realscartvalid_visit", "measure", "avg", "percentage"]
		]);
		expect(cols[1].alias).toBe("Visits");
	});
});

describe("date_range (period index)", () => {
	it("is an int dimension in Tableau", () => {
		const [col] = toTableauColumns(mapColumns([{ field: "date_range", name: "Period", type: "dimension", dataType: "int" }]));
		expect(col).toMatchObject({ id: "date_range", alias: "Period", dataType: "int", columnRole: "dimension" });
		expect(col.aggType).toBeUndefined();
	});
});

describe("naming", () => {
	it("sanitizes ids and names tables", () => {
		expect(tableauId("a#b-c.d")).toBe("a_b_c_d");
		expect(tableName("demo-fr", "rt#insummary")).toEqual({ id: "eulerian_demo_fr_insummary", name: "Eulerian insummary (demo-fr)" });
	});
});
