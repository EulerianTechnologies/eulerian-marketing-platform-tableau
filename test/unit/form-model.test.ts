import { describe, expect, it } from "vitest";
import { buildConfig, parseAdvanced } from "../../connector/app/form-model";
import type { FormState } from "../../connector/app/form-model";

const state: FormState = {
	host: " https://dem.api.eulerian.com ",
	site: "demo-fr",
	kind: "rt#ope",
	path: "mcWEBSITE[?].mcGLOBALOPE.mcOPE",
	dimensions: [{ field: "publisher_name", name: "Publisher" }],
	metrics: [{ field: "click", name: "Clicks" }, { field: "realscartvalidamount", segmentBy: "ordertype" }],
	dateRanges: [{ preset: "current_month" }],
	dateScale: "",
	language: "fr",
	pageSize: "500"
};

describe("buildConfig", () => {
	it("maps the form to a ReportConfig", () => {
		const c = buildConfig(state);
		expect(c.host).toBe("https://dem.api.eulerian.com");
		expect(c.metrics[1]).toEqual({ field: "realscartvalidamount", segment: { by: "ordertype" } });
		expect(c.dateRanges).toEqual([{ range: "CURRENT_MONTH" }]);
		expect(buildConfig({ ...state, dateRanges: [{ from: "2026-10-01", to: "2026-10-31" }] }).dateRanges).toEqual([
			{ dateFrom: "2026-10-01", dateTo: "2026-10-31", dateFormat: "YYYY-MM-DD" }
		]);
		expect(c).not.toHaveProperty("dateScale");
		expect(c.pageSize).toBe(500);
		expect(c.language).toBe("fr");
	});

	it("maps several periods in row order (period 0 first)", () => {
		const c = buildConfig({ ...state, dateRanges: [{ preset: "current_month" }, { from: "2026-10-01", to: "2026-10-31" }, { preset: "LAST_MONTH" }] });
		expect(c.dateRanges).toEqual([
			{ range: "CURRENT_MONTH" },
			{ dateFrom: "2026-10-01", dateTo: "2026-10-31", dateFormat: "YYYY-MM-DD" },
			{ range: "LAST_MONTH" }
		]);
	});

	it("accepts 1 to 9 periods", () => {
		const n = (k: number) => Array.from({ length: k }, () => ({ preset: "LAST_7_DAYS" }));
		expect(buildConfig({ ...state, dateRanges: n(9) }).dateRanges).toHaveLength(9);
		expect(() => buildConfig({ ...state, dateRanges: n(10) })).toThrow(/at most 9 periods/);
		expect(() => buildConfig({ ...state, dateRanges: [] })).toThrow(/at least one date range/);
	});

	it("requires complete custom dates and names the faulty period", () => {
		expect(() => buildConfig({ ...state, dateRanges: [{ preset: "TODAY" }, { from: "2026-10-01" }] })).toThrow(/period 2: select a preset or both/);
	});

	it("refuses the same metric plain and segmented", () => {
		expect(() => buildConfig({ ...state, metrics: [{ field: "click" }, { field: "click", segmentBy: "ordertype" }] })).toThrow(/both plain and segmented/);
	});

	it("merges advanced options", () => {
		const c = buildConfig({ ...state, advancedJson: '{"segmentFilterClauses":[{"field":"device","operator":"IN","value":"Phone"}]}' });
		expect(c.segmentFilterClauses).toEqual([{ field: "device", operator: "IN", value: "Phone" }]);
	});
});

describe("parseAdvanced", () => {
	it("rejects invalid JSON, arrays and unknown keys", () => {
		expect(() => parseAdvanced("{")).toThrow(/not valid JSON/);
		expect(() => parseAdvanced("[]")).toThrow(/JSON object/);
		expect(() => parseAdvanced('{"kind":"rt#x"}')).toThrow(/unsupported advanced option/);
		expect(parseAdvanced("  ")).toEqual({});
	});
});
