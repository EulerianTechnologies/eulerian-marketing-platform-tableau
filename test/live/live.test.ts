/**
 * Opt-in tests against a REAL Eulerian account. Skipped unless EMP_TOKEN is set:
 *   EMP_HOST=https://dem.api.eulerian.com EMP_SITE=demo-fr EMP_TOKEN=... npm run test:live
 * Read-only: only discovery and flat_aggregate queries are sent.
 */
import { describe, expect, it } from "vitest";
import { EulerianClient } from "../../connector/core/client";
import type { NormalizedRow } from "../../connector/core/types";
import { fetchTransport } from "../helpers";

const { EMP_HOST = "", EMP_SITE = "", EMP_TOKEN = "" } = process.env;

describe.skipIf(!EMP_TOKEN || !EMP_HOST || !EMP_SITE)("live API", () => {
	const client = () => new EulerianClient({ host: EMP_HOST, token: EMP_TOKEN, transport: fetchTransport });

	it("discovers the site", async () => {
		const c = client();
		expect((await c.listSites()).map((s) => s.name)).toContain(EMP_SITE);
		const kinds = await c.listKinds(EMP_SITE);
		expect(kinds.length).toBeGreaterThan(0);
		const path = await c.resolveDefaultPath(EMP_SITE, "rt#insummary", "visit");
		expect((await c.listDimensions(EMP_SITE, path)).length).toBeGreaterThan(0);
	});

	it("runs a channel report on the first week of October 2026", async () => {
		const rows: NormalizedRow[] = [];
		for await (const p of client().runReport({
			host: EMP_HOST,
			site: EMP_SITE,
			kind: "rt#insummary",
			dimensions: [{ field: "media_key_po", name: "Channel" }],
			metrics: [{ field: "visit", name: "Visits" }],
			dateRanges: [{ dateFrom: "2026-10-01", dateTo: "2026-10-07", dateFormat: "YYYY-MM-DD" }]
		}))
			rows.push(...p.rows);
		expect(rows.some((r) => Number(r.visit) > 0)).toBe(true);
	});

	it("runs a daily time series", async () => {
		const rows: NormalizedRow[] = [];
		for await (const p of client().runReport({
			host: EMP_HOST,
			site: EMP_SITE,
			kind: "rt#website",
			dimensions: [{ field: "date_day" }, { field: "website_name" }],
			metrics: [{ field: "visit" }, { field: "realscartvalid_visit" }],
			dateRanges: [{ dateFrom: "2026-10-01", dateTo: "2026-10-07", dateFormat: "YYYY-MM-DD" }],
			dateScale: "D"
		}))
			rows.push(...p.rows);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => /^2026-10-0[1-7]$/.test(String(r.date_day)))).toBe(true);
	});

	it("paginates rt#ope", async () => {
		const rows: NormalizedRow[] = [];
		for await (const p of client().runReport({
			host: EMP_HOST,
			site: EMP_SITE,
			kind: "rt#ope",
			path: "mcWEBSITE[?].mcGLOBALOPE.mcOPE",
			dimensions: [{ field: "ope_name" }],
			metrics: [{ field: "click" }],
			dateRanges: [{ dateFrom: "2026-10-01", dateTo: "2026-10-07", dateFormat: "YYYY-MM-DD" }],
			pageSize: 5
		}))
			rows.push(...p.rows);
		expect(rows.length).toBeGreaterThan(5);
		expect(new Set(rows.map((r) => r.ope_name)).size).toBe(rows.length);
	});
});
