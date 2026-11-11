import { describe, expect, it } from "vitest";
import { apiBase, apiOrigin, batchBase, buildFlatAggregateBody, MAX_DATE_RANGES, validateConfig } from "../../connector/core/query";
import { ConfigError } from "../../connector/core/errors";
import type { ReportConfig } from "../../connector/core/types";

const base: ReportConfig = {
	host: "dem.api.eulerian.com",
	site: "demo-fr",
	kind: "rt#insummary",
	dimensions: [{ name: "Channel", field: "media_key_po" }],
	metrics: [{ name: "Visits", field: "visit" }],
	dateRanges: [{ range: "LAST_7_DAYS" }]
};

describe("apiOrigin", () => {
	it.each([
		["dem.api.eulerian.com", "https://dem.api.eulerian.com"],
		["https://DEM.api.eulerian.com/", "https://dem.api.eulerian.com"],
		["acme.api.eulerian.ca", "https://acme.api.eulerian.ca"],
		["https://acme.api.gouv.eulerian.fr", "https://acme.api.gouv.eulerian.fr"],
		["https://acme.api.eulerian.com/ea/v2", "https://acme.api.eulerian.com"],
		["http://127.0.0.1:8787", "http://127.0.0.1:8787"],
		["localhost:9000", "https://localhost:9000"]
	])("%s -> %s", (input, expected) => expect(apiOrigin(input)).toBe(expected));

	it.each(["evil.com", "acme.api.eulerian.com.evil.com", "acme.api.eulerian.fr", "a.b.api.eulerian.com", "http://acme.api.eulerian.com", ""])("rejects %s (token must not leak)", (h) => {
		expect(() => apiOrigin(h)).toThrow(ConfigError);
	});

	it("builds the batch base URL", () => {
		expect(apiBase("dem.api.eulerian.com")).toBe("https://dem.api.eulerian.com/ea/v2");
		expect(batchBase("dem.api.eulerian.com", "demo fr")).toBe("https://dem.api.eulerian.com/ea/v2/ea/demo%20fr/report/batch");
	});
});

describe("validateConfig", () => {
	it("accepts a minimal config", () => expect(() => validateConfig(base)).not.toThrow());

	it("lists every problem at once", () => {
		try {
			validateConfig({ ...base, site: "", kind: "cj#x", dimensions: [], metrics: [], dateRanges: [] });
			expect.unreachable();
		} catch (e) {
			expect((e as ConfigError).problems).toEqual([
				"site is required",
				'kind "cj#x" must start with rt#',
				"at least one dimension is required",
				"at least one metric is required",
				"at least one date range is required"
			]);
		}
	});

	it("enforces 35 metrics and 9 periods per report", () => {
		const metrics = Array.from({ length: 36 }, (_, i) => ({ field: `m${i}` }));
		expect(() => validateConfig({ ...base, metrics })).toThrow(/at most 35 metrics/);
		expect(MAX_DATE_RANGES).toBe(9);
		const periods = (n: number) => Array.from({ length: n }, () => ({ range: "LAST_7_DAYS" }));
		expect(() => validateConfig({ ...base, dateRanges: periods(2) })).not.toThrow();
		expect(() => validateConfig({ ...base, dateRanges: periods(9) })).not.toThrow();
		expect(() => validateConfig({ ...base, dateRanges: periods(10) })).toThrow(/at most 9 periods are allowed \(got 10\)/);
	});

	it("refuses a metric requested both plain and segmented", () => {
		const cfg = { ...base, metrics: [{ field: "realscartvalidamount" }, { field: "realscartvalidamount", segment: { by: "ordertype" } }] };
		try {
			validateConfig(cfg);
			expect.unreachable();
		} catch (e) {
			expect((e as ConfigError).problems).toEqual([
				'metric "realscartvalidamount" is requested both plain and segmented: request it in two separate reports'
			]);
		}
		// Order does not matter.
		expect(() => validateConfig({ ...cfg, metrics: [...cfg.metrics].reverse() })).toThrow(/both plain and segmented/);
	});

	it("accepts the same metric segmented two ways, and different metrics plain + segmented", () => {
		const metrics = [
			{ field: "realscartvalidamount", segment: { by: "ordertype" } },
			{ field: "realscartvalidamount", segment: { by: "orderpayment" } },
			{ field: "visit" },
			{ field: "realscartvalid", segment: { by: "ordertype" } }
		];
		expect(() => validateConfig({ ...base, metrics })).not.toThrow();
	});

	it("validates date ranges", () => {
		expect(() => validateConfig({ ...base, dateRanges: [{ range: "last 7 days" }] })).toThrow(/not a valid preset/);
		expect(() => validateConfig({ ...base, dateRanges: [{ dateFrom: "2026-05-02", dateTo: "2026-05-01", dateFormat: "YYYY-MM-DD" }] })).toThrow(/after dateTo/);
		expect(() => validateConfig({ ...base, dateRanges: [{ from: 10, to: 5 }] })).toThrow(/from < to/);
		expect(() => validateConfig({ ...base, dateRanges: [{ dateFrom: "2026-05-01", dateTo: "2026-05-31", dateFormat: "YYYY-MM-DD" }] })).not.toThrow();
	});

	it("rejects bad dateScale and pageSize", () => {
		expect(() => validateConfig({ ...base, dateScale: "Y" as never })).toThrow(/dateScale/);
		expect(() => validateConfig({ ...base, pageSize: 0 })).toThrow(/pageSize/);
	});
});

describe("buildFlatAggregateBody", () => {
	it("sends the period, sync mode (documented async:false) and flat output", () => {
		const body = buildFlatAggregateBody({ ...base, dateRanges: [{ range: "YESTERDAY" }] }, { start: 0, maxEntries: 100 });
		expect(body.async).toBe(false);
		expect(body.output).toEqual({ flat: true });
		expect(body.reports).toHaveLength(1);
		expect(body.reports[0].dateRanges).toEqual([{ range: "YESTERDAY" }]);
		expect(body.reports[0].limit).toEqual({ start: 0, maxEntries: 100 });
	});

	it("prepends the date_range dimension (Period) only with several periods", () => {
		const one = buildFlatAggregateBody(base, { start: 0, maxEntries: 10 }).reports[0];
		expect(one.dimensions).toEqual([{ name: "Channel", field: "media_key_po" }]);

		const two = buildFlatAggregateBody({ ...base, dateRanges: [{ range: "CURRENT_MONTH" }, { range: "LAST_MONTH" }] }, { start: 0, maxEntries: 10 }).reports[0];
		expect(two.dimensions).toEqual([
			{ name: "Period", field: "date_range" },
			{ name: "Channel", field: "media_key_po" }
		]);
		expect(two.dateRanges).toEqual([{ range: "CURRENT_MONTH" }, { range: "LAST_MONTH" }]);
	});

	it("does not add date_range when the user already requested it", () => {
		const dimensions = [{ field: "media_key_po" }, { field: "date_range", name: "My period" }];
		const two = buildFlatAggregateBody({ ...base, dimensions, dateRanges: [{ range: "TODAY" }, { range: "YESTERDAY" }] }, { start: 0, maxEntries: 10 }).reports[0];
		expect(two.dimensions).toEqual([
			{ name: "media_key_po", field: "media_key_po" },
			{ name: "My period", field: "date_range" }
		]);
		// Picked explicitly with one period: sent as is.
		const one = buildFlatAggregateBody({ ...base, dimensions }, { start: 0, maxEntries: 10 }).reports[0];
		expect(one.dimensions).toHaveLength(2);
	});

	it("orders by the first metric by default (deterministic pagination) and orderBy is an array", () => {
		const r = buildFlatAggregateBody(base, { start: 0, maxEntries: 10 }).reports[0];
		expect(r.orderBy).toEqual([{ field: "visit", direction: "DESC" }]);
		const r2 = buildFlatAggregateBody({ ...base, orderBy: [{ field: "visit", direction: "ASC" }] }, { start: 0, maxEntries: 10 }).reports[0];
		expect(r2.orderBy).toEqual([{ field: "visit", direction: "ASC" }]);
	});

	it("omits path unless provided, sets dateRangeSplitPerScale with dateScale", () => {
		const r = buildFlatAggregateBody(base, { start: 0, maxEntries: 10 }).reports[0];
		expect(r).not.toHaveProperty("path");
		expect(r).not.toHaveProperty("dateScale");
		const r2 = buildFlatAggregateBody({ ...base, path: "mcWEBSITE[?].mcGLOBALOPE.mcOPE", dateScale: "D" }, { start: 0, maxEntries: 10 }).reports[0];
		expect(r2.path).toBe("mcWEBSITE[?].mcGLOBALOPE.mcOPE");
		expect(r2.dateScale).toBe("D");
		expect(r2.dateRangeSplitPerScale).toBe(true);
	});

	it("passes metric segments and filters through", () => {
		const cfg: ReportConfig = {
			...base,
			metrics: [{ field: "realscartvalidamount", name: "Revenue", segment: { by: "ordertype" } }],
			segmentFilterClauses: [{ field: "device", operator: "IN", value: "Phone" }],
			dimensionFilterClauses: []
		};
		const r = buildFlatAggregateBody(cfg, { start: 0, maxEntries: 10 }).reports[0];
		expect(r.metrics).toEqual([{ name: "Revenue", field: "realscartvalidamount", segment: { by: "ordertype" } }]);
		expect(r.segmentFilterClauses).toEqual(cfg.segmentFilterClauses);
		expect(r).not.toHaveProperty("dimensionFilterClauses");
		expect(r.language).toBe("en");
	});
});
