import { describe, expect, it } from "vitest";
import { coerceValue, columnType, mapColumns, normalizeContent } from "../../connector/core/normalize";
import type { FlatAggregateContent } from "../../connector/core/types";
import { fixture } from "../helpers";

describe("columnType", () => {
	it("maps API types (affinity or dataType)", () => {
		expect(columnType({ field: "visit", name: "", type: "metric", dataType: "int" })).toBe("int");
		expect(columnType({ field: "click", name: "", type: "metric", affinity: "int" })).toBe("int");
		expect(columnType({ field: "x", name: "", type: "metric", dataType: "float" })).toBe("float");
		expect(columnType({ field: "cr", name: "", type: "metric", affinity: "pct" })).toBe("float");
		expect(columnType({ field: "date_day", name: "", type: "dimension", dataType: "date" })).toBe("date");
		expect(columnType({ field: "date_iso8601", name: "", type: "dimension", dataType: "date" })).toBe("datetime");
		expect(columnType({ field: "date_hour", name: "", type: "dimension", dataType: "date" })).toBe("datetime");
		expect(columnType({ field: "date_week", name: "", type: "dimension", dataType: "date" })).toBe("string");
		expect(columnType({ field: "m", name: "", type: "metric" })).toBe("float");
		expect(columnType({ field: "d", name: "", type: "dimension" })).toBe("string");
	});
});

describe("mapColumns", () => {
	it("keeps both columns when the API returns a field twice (second id suffixed, label kept)", () => {
		const ds = fixture("datasets/rt_ope.json") as FlatAggregateContent; // realscartvalidamount_ordertype_0 twice
		const cols = mapColumns(ds.columnHeader);
		const ids = cols.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(cols.filter((c) => c.field === "realscartvalidamount_ordertype_0").map((c) => [c.id, c.label])).toEqual([
			["realscartvalidamount_ordertype_0", "Revenue # N/A"],
			["realscartvalidamount_ordertype_0__2", "Revenue # N/A - 0"]
		]);
	});

	it("flags ratio metrics", () => {
		const cols = mapColumns([{ field: "realscartvalid_visit", name: "CR", type: "metric", affinity: "pct" }]);
		expect(cols[0]).toMatchObject({ id: "realscartvalid_visit", role: "metric", type: "float", percentage: true });
	});
});

describe("coerceValue", () => {
	it.each([
		[3586, "int", 3586],
		["12", "int", 12],
		[0.0, "int", 0],
		["abc", "float", null],
		[null, "string", null],
		["", "float", null],
		["2026-11-08", "date", "2026-11-08"],
		["2026-11-01 00:00:00.000", "datetime", "2026-11-01 00:00:00"],
		["2026-02-28T12", "datetime", "2026-02-28 12:00:00"],
		["nonsense", "date", null],
		[42, "string", "42"]
	] as const)("%j as %s -> %j", (v, t, expected) => expect(coerceValue(v, t)).toBe(expected));
});

describe("normalizeContent", () => {
	it("loads every row exactly as returned, including the rt#insummary `global` row", () => {
		const insummary = fixture("datasets/rt_insummary.json") as FlatAggregateContent;
		const page = normalizeContent(insummary);
		expect(page.rows).toHaveLength(insummary.data.length);
		expect(page.rows.some((r) => r.media_key_po === "global")).toBe(true);
		expect(page.columns.map((c) => c.id)).toEqual(insummary.columnHeader.map((c) => c.field));
	});

	it("keeps rows whatever their date value", () => {
		const content: FlatAggregateContent = {
			kind: "rt#website",
			rowCount: 2,
			columnHeader: [
				{ field: "date_day", name: "Day", type: "dimension", dataType: "date" },
				{ field: "visit", name: "Visits", type: "metric", dataType: "int" }
			],
			data: [
				["2026-11-10", 5],
				["1970-01-01", 0.0]
			]
		};
		expect(normalizeContent(content).rows).toEqual([
			{ date_day: "2026-11-10", visit: 5 },
			{ date_day: "1970-01-01", visit: 0 }
		]);
	});

	it("reads object rows (showAsObject)", () => {
		const content: FlatAggregateContent = {
			kind: "rt#ope",
			rowCount: 1,
			columnHeader: [
				{ field: "ope_name", name: "Campaign", type: "dimension", dataType: "string" },
				{ field: "click", name: "Clicks", type: "metric", affinity: "int" }
			],
			data: [{ click: 117543, ope_name: "google" }]
		};
		expect(normalizeContent(content).rows[0]).toEqual({ ope_name: "google", click: 117543 });
	});
});
