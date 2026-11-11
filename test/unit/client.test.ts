import { describe, expect, it } from "vitest";
import { EulerianClient } from "../../connector/core/client";
import { EulerianApiError } from "../../connector/core/errors";
import type { FlatAggregateContent, HttpRequest, ReportConfig } from "../../connector/core/types";

const config: ReportConfig = {
	host: "https://dem.api.eulerian.com",
	site: "demo-fr",
	kind: "rt#ope",
	dimensions: [{ field: "ope_name" }],
	metrics: [{ field: "click" }],
	dateRanges: [{ range: "LAST_7_DAYS" }],
	pageSize: 2
};

const content = (rows: unknown[][], totalRowCount?: number): { error: false; data: { content: FlatAggregateContent } } => ({
	error: false,
	data: {
		content: {
			kind: "rt#ope",
			rowCount: rows.length,
			totalRowCount,
			columnHeader: [
				{ field: "ope_name", name: "Campaign", type: "dimension", dataType: "string" },
				{ field: "click", name: "Clicks", type: "metric", affinity: "int" }
			],
			data: rows
		}
	}
});

/** Fake transport answering from a queue and recording requests. */
function fakeTransport(responses: unknown[]) {
	const calls: HttpRequest[] = [];
	const transport = async (req: HttpRequest) => {
		calls.push(req);
		if (!responses.length) throw new Error("unexpected extra call");
		return responses.shift();
	};
	return { calls, transport };
}

const collect = async (gen: AsyncGenerator<{ rows: unknown[] }>) => {
	const pages = [];
	for await (const p of gen) pages.push(p);
	return pages;
};

describe("EulerianClient.runReport pagination", () => {
	it("pages until a short page", async () => {
		const { calls, transport } = fakeTransport([content([["a", 3], ["b", 2]], 3), content([["c", 1]], 3)]);
		const pages = await collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport(config));
		expect(pages.map((p) => p.rows.length)).toEqual([2, 1]);
		expect(calls.map((c) => (c.body as any).reports[0].limit)).toEqual([
			{ start: 0, maxEntries: 2 },
			{ start: 2, maxEntries: 2 }
		]);
		expect(calls[0].headers.Authorization).toBe("Bearer t");
		expect(calls[0].url).toBe("https://dem.api.eulerian.com/ea/v2/ea/demo-fr/report/batch/flat_aggregate.json");
	});

	it("stops when totalRowCount is reached on a full page", async () => {
		const { calls, transport } = fakeTransport([content([["a", 3], ["b", 2]], 2)]);
		await collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport(config));
		expect(calls).toHaveLength(1);
	});

	it("standard pagination: a page longer than requested is not followed by another call", async () => {
		const { calls, transport } = fakeTransport([content([["a", 3], ["b", 2], ["c", 1]], 3)]);
		const pages = await collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport(config));
		expect(calls).toHaveLength(1);
		expect(pages[0].rows).toHaveLength(3);
	});

	it("honours maxRows", async () => {
		const { calls, transport } = fakeTransport([content([["a", 3], ["b", 2]], 100)]);
		await collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport({ ...config, maxRows: 2 }));
		expect(calls).toHaveLength(1);
	});

	it("rejects an invalid config (same metric plain and segmented) before calling the API", async () => {
		const { calls, transport } = fakeTransport([]);
		const metrics = [{ field: "click" }, { field: "click", segment: { by: "ordertype" } }];
		await expect(collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport({ ...config, metrics }))).rejects.toThrow(/both plain and segmented/);
		expect(calls).toHaveLength(0);
	});

	it("surfaces API errors returned with HTTP 200", async () => {
		const { transport } = fakeTransport([{ error: true, error_code: "TOKEN_INVALID", error_msg: "token is invalid" }]);
		await expect(collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport(config))).rejects.toThrow(EulerianApiError);
	});

	it("rejects an unexpected payload", async () => {
		const { transport } = fakeTransport([{ error: false, data: {} }]);
		await expect(collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport(config))).rejects.toThrow(/missing data.content/);
	});

	it("requires a token", () => {
		expect(() => new EulerianClient({ host: config.host, token: "", transport: async () => ({}) })).toThrow(/token is required/);
	});
});

/** Page of a 2-period report: each entity comes once per period (period 0, period 1), as the API interleaves them. */
const twoPeriodContent = (entities: string[], totalRowCount?: number) => ({
	error: false,
	data: {
		content: {
			kind: "rt#ope",
			rowCount: entities.length * 2,
			totalRowCount,
			columnHeader: [
				{ field: "date_range", name: "Period", type: "dimension", dataType: "int" },
				{ field: "ope_name", name: "Campaign", type: "dimension", dataType: "string" },
				{ field: "click", name: "Clicks", type: "metric", dataType: "int", affinity: "int" }
			],
			data: entities.flatMap((e, i) => [
				[0, e, 10 - i],
				[1, e, 5 - i]
			])
		}
	}
});

describe("EulerianClient.runReport pagination with several periods", () => {
	const two: ReportConfig = { ...config, dateRanges: [{ range: "CURRENT_MONTH" }, { range: "LAST_MONTH" }] };
	const limits = (calls: HttpRequest[]) => calls.map((c) => (c.body as any).reports[0].limit);

	it("limit is per period: full pages hold n x P rows, start advances by P", async () => {
		// 3 entities x 2 periods: totalRowCount = 6, per-period count = 3.
		const { calls, transport } = fakeTransport([twoPeriodContent(["a", "b"], 6), twoPeriodContent(["c"], 6)]);
		const pages = await collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport(two));
		expect(pages.map((p) => p.rows.length)).toEqual([4, 2]);
		expect(limits(calls)).toEqual([
			{ start: 0, maxEntries: 2 },
			{ start: 2, maxEntries: 2 }
		]);
		expect((calls[0].body as any).reports[0].dimensions[0]).toEqual({ name: "Period", field: "date_range" });
		expect(pages[0].rows[0]).toEqual({ date_range: 0, ope_name: "a", click: 10 });
		expect(pages[0].rows[1]).toEqual({ date_range: 1, ope_name: "a", click: 5 });
	});

	it("stops when the per-period start reaches totalRowCount / n on a full page", async () => {
		const { calls, transport } = fakeTransport([twoPeriodContent(["a", "b"], 8), twoPeriodContent(["c", "d"], 8)]);
		await collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport(two));
		// totalRowCount 8 = 2 x 4: two full pages of 4 rows, no third call.
		expect(limits(calls)).toEqual([
			{ start: 0, maxEntries: 2 },
			{ start: 2, maxEntries: 2 }
		]);
	});

	it("a page of P rows (not n x P) is a short page", async () => {
		// Only one entity (2 rows = P): not a full page for 2 periods.
		const { calls, transport } = fakeTransport([twoPeriodContent(["a"], 100)]);
		await collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport(two));
		expect(calls).toHaveLength(1);
	});

	it("more rows than n x P (limit ignored, e.g. rt#insummary) stops after the first page", async () => {
		const { calls, transport } = fakeTransport([twoPeriodContent(["a", "b", "c"], 6)]);
		const pages = await collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport(two));
		expect(calls).toHaveLength(1);
		expect(pages[0].rows).toHaveLength(6);
	});

	it("maxRows caps the rows of each period", async () => {
		const { calls, transport } = fakeTransport([twoPeriodContent(["a", "b"], 100), twoPeriodContent(["c"], 100)]);
		const pages = await collect(new EulerianClient({ host: config.host, token: "t", transport }).runReport({ ...two, maxRows: 3 }));
		// Second page asks for the 1 remaining row per period.
		expect(limits(calls)).toEqual([
			{ start: 0, maxEntries: 2 },
			{ start: 2, maxEntries: 1 }
		]);
		expect(pages.flatMap((p) => p.rows)).toHaveLength(6);
	});
});

describe("EulerianClient discovery", () => {
	it("parses the standard list envelope and rejects one without `fields`", async () => {
		const { transport } = fakeTransport([
			{ error: false, data: { fields: [{ name: "field" }, { name: "name" }, { name: "affinity" }], rows: [["click", "inbound clicks", "int"]] } },
			{ error: false, data: { fields: [{ name: "kind" }, { name: "name" }], rows: [["rt#insummary", "acquisition"], ["cj#bias-simple", "bias"]] } },
			{ error: false, data: { rows: [["x", "y"]] } }
		]);
		const c = new EulerianClient({ host: config.host, token: "t", transport });
		expect(await c.listMetrics("demo-fr", "rt#ope")).toEqual([{ field: "click", name: "inbound clicks", type: "int" }]);
		expect(await c.listKinds("demo-fr")).toEqual([{ kind: "rt#insummary", name: "acquisition" }]);
		await expect(c.listDimensions("demo-fr", "p")).rejects.toThrow(/missing data.fields/);
	});

	it("encodes kind and path in query strings", async () => {
		const { calls, transport } = fakeTransport([{ error: false, data: { fields: [], rows: [] } }, { error: false, data: { fields: [], rows: [] } }]);
		const c = new EulerianClient({ host: config.host, token: "t", transport });
		await c.listMetrics("demo-fr", "rt#ope");
		await c.listDimensions("demo-fr", "mcWEBSITE[?].mcGLOBALOPE.mcOPE");
		expect(calls[0].url).toMatch(/metrics\.json\?kind=rt%23ope$/);
		expect(calls[1].url).toMatch(/dimensions\.json\?path=mcWEBSITE%5B%3F%5D\.mcGLOBALOPE\.mcOPE$/);
	});
});
