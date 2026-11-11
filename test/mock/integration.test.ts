/**
 * End-to-end tests against the local mock API (mock-server/), which replays data captured
 * from the demo-fr site and emulates the API behaviour. No Tableau, no network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startMockServer } from "../../mock-server/server.mjs";
import { EulerianClient } from "../../connector/core/client";
import { EulerianApiError } from "../../connector/core/errors";
import type { NormalizedRow, ReportConfig } from "../../connector/core/types";
import EulerianFetcher from "../../connector/handlers/EulerianFetcher";
import EulerianParser from "../../connector/handlers/EulerianParser";
import type { DataContainer } from "../stubs/taco-handlers";
import { fetchTransport } from "../helpers";

let mock: Awaited<ReturnType<typeof startMockServer>>;
let client: EulerianClient;

beforeAll(async () => {
	mock = await startMockServer({ port: 0 });
});
afterAll(() => mock.close());
beforeEach(async () => {
	await fetch(`${mock.url}/__mock/reset`, { method: "POST" });
	client = new EulerianClient({ host: mock.url, token: "mock-token", transport: fetchTransport });
});

const rowsOf = async (config: ReportConfig) => {
	const rows: NormalizedRow[] = [];
	for await (const page of client.runReport(config)) rows.push(...page.rows);
	return rows;
};
const requests = async () => (await fetch(`${mock.url}/__mock/requests`)).json();

describe("discovery flow", () => {
	it("lists sites, kinds, metrics, default path, dimensions and segmentations", async () => {
		const sites = await client.listSites();
		expect(sites.map((s) => s.name)).toEqual(["demo-fr", "demo-en"]);

		const kinds = await client.listKinds("demo-fr");
		expect(kinds.every((k) => k.kind.startsWith("rt#"))).toBe(true);
		expect(kinds.map((k) => k.kind)).toContain("rt#insummary");

		const metrics = await client.listMetrics("demo-fr", "rt#insummary");
		expect(metrics.map((m) => m.field)).toEqual(expect.arrayContaining(["visit", "hit", "realscartvalid"]));

		const path = await client.resolveDefaultPath("demo-fr", "rt#insummary", "visit");
		expect(path).toBe("mcMEDIAINCOMING[?].*");
		const dims = await client.listDimensions("demo-fr", path);
		expect(dims.map((d) => d.field)).toEqual(expect.arrayContaining(["date_day", "media_key_po"]));

		// The date_range dimension (period index) is listed with the others.
		expect(dims.map((d) => d.field)).toContain("date_range");

		// rt#ope: its default level is queryable and lists its dimensions.
		const opeDefault = await client.resolveDefaultPath("demo-fr", "rt#ope", "click");
		expect(opeDefault).toBe("mcWEBSITE[?].mcGLOBALOPE.mcOPE");
		expect((await client.listDimensions("demo-fr", opeDefault)).map((d) => d.field)).toEqual(expect.arrayContaining(["ope_name", "publisher_name"]));

		const segs = await client.listSegmentations("demo-fr", "rt#ope");
		expect(segs[0].children.map((c) => c.path)).toContain("mcWEBSITE[28].mcGLOBALOPE.mcOPE");
	});
});

describe("reports", () => {
	const base: Omit<ReportConfig, "host"> = {
		site: "demo-fr",
		kind: "rt#ope",
		path: "mcWEBSITE[?].mcGLOBALOPE.mcOPE",
		dimensions: [{ name: "Publisher", field: "publisher_name" }, { name: "Campaign", field: "ope_name" }],
		metrics: [{ name: "Clicks", field: "click" }],
		dateRanges: [{ range: "LAST_30_DAYS" }]
	};

	it("paginates rt#ope (77 rows in pages of 20)", async () => {
		const rows = await rowsOf({ ...base, host: mock.url, pageSize: 20 });
		expect(rows).toHaveLength(77);
		expect(new Set(rows.map((r) => r.ope_name)).size).toBe(77);
		const log = await requests();
		expect(log.filter((r: any) => r.path.endsWith("flat_aggregate.json")).map((r: any) => r.body.reports[0].limit.start)).toEqual([0, 20, 40, 60]);
		// Default ordering is descending on the first metric.
		expect(rows[0].click as number).toBeGreaterThanOrEqual(rows[1].click as number);
	});

	it("rt#ope without path: the default level is used", async () => {
		const rows = await rowsOf({ ...base, host: mock.url, path: undefined, pageSize: 50 });
		expect(rows).toHaveLength(77);
		const sent = (await requests()).filter((r: any) => r.path.endsWith("flat_aggregate.json"));
		expect(sent.every((r: any) => !("path" in r.body.reports[0]))).toBe(true);
	});

	it("two periods, small pages: a Period column and every row exactly once", async () => {
		const single = await rowsOf({ ...base, host: mock.url, pageSize: 100 });
		await fetch(`${mock.url}/__mock/reset`, { method: "POST" });
		const pages = [];
		for await (const p of client.runReport({ ...base, host: mock.url, dateRanges: [{ range: "CURRENT_MONTH" }, { range: "LAST_MONTH" }], pageSize: 20 })) pages.push(p);
		const rows = pages.flatMap((p) => p.rows);

		expect(pages[0].columns[0]).toMatchObject({ id: "date_range", label: "Period", role: "dimension", type: "int" });
		expect(rows).toHaveLength(2 * single.length);
		// Each (period, publisher, campaign) once: no row lost or duplicated across pages.
		const keys = rows.map((r) => JSON.stringify([r.date_range, r.publisher_name, r.ope_name]));
		expect(new Set(keys).size).toBe(rows.length);
		expect(new Set(rows.map((r) => r.date_range))).toEqual(new Set([0, 1]));
		expect(rows.filter((r) => r.date_range === 0)).toHaveLength(single.length);

		// `start` is per period: pages of 20 per period, 77 campaigns -> 4 calls.
		const log = (await requests()).filter((r: any) => r.path.endsWith("flat_aggregate.json"));
		expect(log.map((r: any) => r.body.reports[0].limit)).toEqual([0, 20, 40, 60].map((start) => ({ start, maxEntries: 20 })));
	});

	it("rt#insummary with two periods: one call, rows as returned for each period", async () => {
		const cfg = { ...base, host: mock.url, kind: "rt#insummary", path: undefined, dimensions: [{ field: "media_key_po" }], metrics: [{ field: "visit" }], pageSize: 3 };
		const rows = await rowsOf({ ...cfg, dateRanges: [{ range: "CURRENT_MONTH" }, { range: "LAST_MONTH" }] });
		expect(rows).toHaveLength(20);
		expect(rows.filter((r) => r.media_key_po === "global").map((r) => r.date_range)).toEqual([0, 1]);
		expect((await requests()).filter((r: any) => r.path.endsWith("flat_aggregate.json"))).toHaveLength(1);
	});

	it("refuses the same metric plain and segmented before calling the API", async () => {
		const metrics = [{ field: "realscartvalidamount" }, { field: "realscartvalidamount", segment: { by: "ordertype" } }];
		await expect(rowsOf({ ...base, host: mock.url, metrics })).rejects.toThrow(/both plain and segmented/);
		expect((await requests()).filter((r: any) => r.path.endsWith("flat_aggregate.json"))).toHaveLength(0);
	});

	it("rt#insummary: rows loaded as returned (global row included), one call", async () => {
		const cfg = { ...base, host: mock.url, kind: "rt#insummary", path: undefined, dimensions: [{ field: "media_key_po" }], metrics: [{ field: "visit" }], pageSize: 3 };
		const rows = await rowsOf(cfg);
		expect(rows.map((r) => r.media_key_po)).toContain("global");
		expect(rows.length).toBe(10);
		// The API returned more rows than requested: standard pagination does not ask for another page.
		expect((await requests()).filter((r: any) => r.path.endsWith("flat_aggregate.json"))).toHaveLength(1);
	});

	it("time series per day with typed dates", async () => {
		const rows = await rowsOf({ ...base, host: mock.url, kind: "rt#website", path: undefined, dimensions: [{ field: "date_day" }, { field: "website_name" }], metrics: [{ field: "visit" }], dateScale: "D" });
		expect(rows).toHaveLength(7);
		expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.date_day)))).toBe(true);
	});

	it("segmented metrics: both columns sharing a field id are kept", async () => {
		const pages = [];
		for await (const p of client.runReport({ ...base, host: mock.url, metrics: [{ field: "realscartvalidamount", name: "Revenue", segment: { by: "ordertype" } }] })) pages.push(p);
		const ids = pages[0].columns.map((c) => c.id);
		expect(ids).toEqual(expect.arrayContaining(["realscartvalidamount_ordertype_2", "realscartvalidamount_ordertype_0", "realscartvalidamount_ordertype_0__2"]));
	});

	it("errors: invalid token, unknown field (QUERY_INVALID)", async () => {
		const bad = new EulerianClient({ host: mock.url, token: "wrong", transport: fetchTransport });
		await expect(bad.listSites()).rejects.toMatchObject({ code: "TOKEN_INVALID" });
		const err = await rowsOf({ ...base, host: mock.url, dimensions: [{ field: "not_a_field" }] }).catch((e) => e);
		expect(err).toBeInstanceOf(EulerianApiError);
		expect(err.message).toMatch(/not_a_field is not available/);
		expect(err.code).toBe("QUERY_INVALID");
	});
});

describe("Tableau handlers (Taco stubs)", () => {
	it("fetcher + parser build one typed table", async () => {
		const config: ReportConfig = {
			host: mock.url,
			site: "demo-fr",
			kind: "rt#ope",
			path: "mcWEBSITE[?].mcGLOBALOPE.mcOPE",
			dimensions: [{ field: "ope_name", name: "Campaign" }],
			metrics: [{ field: "click", name: "Clicks" }, { field: "realscartvalid_visit", name: "CR" }],
			dateRanges: [{ range: "CURRENT_MONTH" }],
			pageSize: 50
		};
		const handlerInput = { fetcher: "EulerianFetcher", parser: "EulerianParser", data: config };
		const fetcher = new EulerianFetcher();
		const parser = new EulerianParser();
		const container: DataContainer = { tables: [] };
		for await (const chunk of fetcher.fetch({ handlerInput, secrets: { token: "mock-token" } })) {
			parser.parse(chunk as any, { dataContainer: container as any });
		}
		expect(container.tables).toHaveLength(1);
		const t = container.tables[0];
		expect(t.id).toBe("eulerian_demo_fr_ope");
		expect(t.columns.map((c) => c.id)).toEqual(["ope_name", "click", "realscartvalid_visit"]);
		expect(t.columns.find((c) => c.id === "realscartvalid_visit")).toMatchObject({ columnRole: "measure", aggType: "avg", numberFormat: "percentage" });
		expect(t.rows).toHaveLength(77);
	});

	it("fetcher fails cleanly without a token", async () => {
		const gen = new EulerianFetcher().fetch({ handlerInput: { fetcher: "", parser: "", data: { host: mock.url } }, secrets: {} });
		await expect(gen.next()).rejects.toThrow(/token is required/);
	});
});
