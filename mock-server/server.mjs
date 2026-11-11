#!/usr/bin/env node
/**
 * Mock Eulerian Marketing Platform API (Batch Reporting subset).
 *
 * Zero dependencies (Node >= 18). It replays fixtures captured from the `demo-fr` demo site and
 * emulates the API behaviour:
 *
 *  - errors are returned with HTTP 200 and `{ "error": true, "error_code", "error_msg" }`
 *    (`QUERY_INVALID` for flat_aggregate errors)
 *  - `orderBy` must be an array
 *  - every kind works without `path` (its default level is used); dimensions.json accepts `kind` alone
 *  - several `dateRanges`: the `date_range` dimension holds the 0-based period index; `limit` applies to
 *    each period (a page holds up to periods x maxEntries rows) and `totalRowCount` counts all periods
 *  - `rt#insummary` returns all its rows whatever `limit`, and a `global` total row
 *  - a segmented metric expands into one column per segment value; the captured rt#ope dataset holds
 *    two segment columns sharing the `..._ordertype_0` field id
 *  - metric columns carry both `dataType` and `affinity`, dimension columns `dataType`
 *  - async submission returns `{ data: { fields, rows }, rows }`
 *
 * Usage:
 *   node mock-server/server.mjs                 # listens on 127.0.0.1:8787
 *   MOCK_PORT=0 node mock-server/server.mjs     # random port (printed on stdout)
 *   MOCK_TOKEN=secret node mock-server/server.mjs
 *
 * Test helpers:
 *   GET  /__mock/requests  -> list of requests received (method, path, query, body)
 *   POST /__mock/reset     -> clear the request log
 *
 * Programmatic use: `import { startMockServer } from "./server.mjs"`.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const API_PREFIX = "/ea/v2";

/** Default path resolved by the engine for each kind (as returned by dryRun on demo-fr). */
const DEFAULT_PATHS = {
	"rt#insummary": "mcMEDIAINCOMING[?].*",
	"rt#ope": "mcWEBSITE[?].mcGLOBALOPE.mcOPE",
	"rt#website": "mcWEBSITE[?]#mgWEBSITE"
};

/** Which dimensions fixture answers a given `path` query parameter. */
const DIMENSIONS_BY_PATH = [
	[/^mcMEDIAINCOMING/, "insummary"],
	[/mcGLOBALOPE/, "ope"],
	[/^mcWEBSITE\[[^\]]*\]#mgWEBSITE$/, "website"]
];

const readFixture = (rel) => JSON.parse(readFileSync(join(FIXTURES, rel), "utf8"));
const fixtureName = (kind) => String(kind).replace("#", "_");

const meta = () => ({ tm: Math.floor(Date.now() / 1000), host: "mock", reqid: Math.random().toString(16).slice(2) });
const ok = (payload) => ({ error: false, ...payload, meta: meta() });
const fail = (error_msg, error_code) => ({ error: true, ...(error_code ? { error_code } : {}), error_msg, meta: meta() });
/** flat_aggregate errors carry `QUERY_INVALID`, like the real API. */
const queryFail = (error_msg) => fail(error_msg, "QUERY_INVALID");

/** The `date_range` dimension: 0-based index of the `dateRanges` entry of each row. */
const DATE_RANGE = "date_range";

/** Raw column type, the API uses either `dataType` or `affinity`. */
const rawType = (col) => col.dataType ?? col.affinity;

/**
 * Emulates the flat aggregate engine on top of a captured dataset:
 * projection of the requested columns, re-aggregation when a captured
 * dimension (e.g. date_day) is not requested, ordering and pagination.
 */
export function runFlatAggregate(body) {
	if (!body || !Array.isArray(body.reports) || body.reports.length !== 1) {
		return queryFail("batch::check : check: exactly one report is allowed");
	}
	const report = body.reports[0];
	if (!report.kind || !String(report.kind).startsWith("rt#")) return queryFail("batch::check : check: kind must start with rt#");
	if (!Array.isArray(report.dateRanges) || report.dateRanges.length === 0) return queryFail("batch::check : check: dateRanges is mandatory");
	if (report.dateRanges.length > 9) return queryFail("batch::check : check: max 9 dateRanges");
	if (!Array.isArray(report.dimensions) || report.dimensions.length === 0) return queryFail("batch::check : check: dimensions is mandatory");
	if (!Array.isArray(report.metrics) || report.metrics.length === 0) return queryFail("batch::check : check: metrics is mandatory");
	if (report.metrics.length > 35) return queryFail("batch::check : check: max 35 metrics");
	if (report.orderBy !== undefined && !Array.isArray(report.orderBy)) return queryFail("batch::check@2047 : check: orderBy must be an array");

	const file = `datasets/${fixtureName(report.kind)}.json`;
	if (!existsSync(join(FIXTURES, file))) return queryFail(`kind=${report.kind} is not available in the mock server`);
	const ds = readFixture(file);
	const path = report.path ?? DEFAULT_PATHS[report.kind];

	if (body.dryRun) {
		return ok({ data: { request: { ...body, reports: [{ ...report, path }] } } });
	}

	// --- Column projection --------------------------------------------------
	// `date_range` is not in the captured dataset: it is added after re-aggregation (see below).
	const nPeriods = report.dateRanges.length;
	const rangePos = report.dimensions.findIndex((d) => d.field === DATE_RANGE);
	const rangeName = rangePos >= 0 ? report.dimensions[rangePos].name ?? "Date Range" : null;
	const selected = []; // { idx, header }
	for (const d of report.dimensions) {
		if (d.field === DATE_RANGE) continue;
		const idx = ds.columnHeader.findIndex((c) => c.type === "dimension" && c.field === d.field);
		if (idx < 0) {
			return queryFail(`rt::fetch : dimension: field=${d.field} is not available for leaf=${path} check the dimensions endpoint to find which ones are allowed.`);
		}
		selected.push({ idx, header: { ...ds.columnHeader[idx], name: d.name ?? ds.columnHeader[idx].name } });
	}
	for (const m of report.metrics) {
		if (m.segment?.by) {
			const prefix = `${m.field}_${m.segment.by}_`;
			const matches = ds.columnHeader.map((c, idx) => ({ c, idx })).filter(({ c }) => c.type === "metric" && c.field.startsWith(prefix));
			if (!matches.length) return queryFail(`metric: field=${m.field} cannot be segmented by ${m.segment.by}`);
			for (const { c, idx } of matches) {
				const suffix = c.name.includes(" # ") ? c.name.slice(c.name.indexOf(" # ")) : "";
				selected.push({ idx, header: withTypeKeys({ ...c, name: `${m.name ?? m.field}${suffix}` }) });
			}
			continue;
		}
		const idx = ds.columnHeader.findIndex((c) => c.type === "metric" && c.field === m.field);
		if (idx < 0) return queryFail(`metric: field=${m.field} is not available for kind=${report.kind}`);
		selected.push({ idx, header: withTypeKeys({ ...ds.columnHeader[idx], name: m.name ?? ds.columnHeader[idx].name }) });
	}

	// --- Re-aggregation when not every captured dimension is requested -----
	const dimSel = selected.filter((s) => s.header.type === "dimension");
	const allDims = ds.columnHeader.filter((c) => c.type === "dimension").length;
	let rows = ds.data.map((r) => selected.map((s) => r[s.idx]));
	if (dimSel.length < allDims) {
		const groups = new Map();
		for (const r of rows) {
			const key = JSON.stringify(r.slice(0, dimSel.length));
			const g = groups.get(key);
			if (!g) groups.set(key, { row: [...r], n: 1 });
			else {
				g.n += 1;
				for (let i = dimSel.length; i < r.length; i++) g.row[i] = (Number(g.row[i]) || 0) + (Number(r[i]) || 0);
			}
		}
		// Ratios cannot be summed: the mock averages them (approximation, see README).
		rows = [...groups.values()].map(({ row, n }) =>
			row.map((v, i) => (i >= dimSel.length && rawType(selected[i].header) === "pct" ? Number((v / n).toFixed(6)) : v))
		);
	}

	// --- Ordering -------------------------------------------------------------
	for (const ob of [...(report.orderBy ?? [])].reverse()) {
		const i = selected.findIndex((s) => s.header.field === ob.field || s.header.field.startsWith(`${ob.field}_`));
		if (i < 0) return queryFail(`orderBy: field=${ob.field} is not part of the requested metrics`);
		const dir = String(ob.direction ?? "DESC").toUpperCase() === "ASC" ? 1 : -1;
		rows.sort((a, b) => (a[i] > b[i] ? dir : a[i] < b[i] ? -dir : 0));
	}

	// --- Periods and pagination ------------------------------------------------
	// The mock ignores dates: every period holds the same rows. Like the real API, `limit` applies to each
	// period, rows are interleaved by entity (period 0, period 1, ...) and totalRowCount counts all periods.
	// rt#insummary returns all its rows whatever `limit`.
	const totalRowCount = rows.length * nPeriods;
	if (report.limit && report.kind !== "rt#insummary") {
		const start = Number(report.limit.start ?? 0);
		const max = Number(report.limit.maxEntries ?? rows.length);
		rows = rows.slice(start, start + max);
	}
	let columnHeader = selected.map((s) => s.header);
	if (rangePos >= 0) {
		columnHeader = [...columnHeader];
		columnHeader.splice(rangePos, 0, { type: "dimension", field: DATE_RANGE, name: rangeName, dataType: "int" });
	}
	rows = rows.flatMap((r) =>
		Array.from({ length: nPeriods }, (_, period) => {
			if (rangePos < 0) return r;
			const out = [...r];
			out.splice(rangePos, 0, period);
			return out;
		})
	);

	const data = body.output?.typeOptions?.showAsObject
		? rows.map((r) => Object.fromEntries(columnHeader.map((c, i) => [c.field, r[i]])))
		: rows;

	return ok({ data: { content: { kind: report.kind, path, rowCount: rows.length, totalRowCount, columnHeader, data } } });
}

/** Metric columns carry both type keys with the same value, like the real API. */
function withTypeKeys(header) {
	const t = rawType(header);
	return t ? { ...header, dataType: t, affinity: t } : header;
}

/** Start the mock server. Resolves with { server, url, port, close }. */
export function startMockServer({ port = 8787, host = "127.0.0.1", token = "mock-token" } = {}) {
	const log = [];
	const jobs = new Map();

	const server = createServer(async (req, res) => {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const raw = Buffer.concat(chunks).toString("utf8");
		let body;
		try {
			body = raw ? JSON.parse(raw) : undefined;
		} catch {
			body = raw;
		}

		const send = (status, payload) => {
			res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
			res.end(JSON.stringify(payload));
		};

		if (url.pathname === "/__mock/requests") return send(200, log);
		if (url.pathname === "/__mock/reset") {
			log.length = 0;
			return send(200, { ok: true });
		}
		if (req.method === "OPTIONS") {
			res.writeHead(204, {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers": "Authorization, Content-Type",
				"Access-Control-Allow-Methods": "GET, POST, OPTIONS"
			});
			return res.end();
		}

		log.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, authorization: req.headers.authorization });

		if (!url.pathname.startsWith(API_PREFIX)) return send(404, fail("not found"));
		// Real API: invalid token => HTTP 200 + TOKEN_INVALID.
		if (req.headers.authorization !== `Bearer ${token}`) return send(200, fail("token is invalid", "TOKEN_INVALID"));

		const p = url.pathname.slice(API_PREFIX.length);
		if (p === "/er/account/getallowedwebsite.json") return send(200, readFixture("websites.json"));

		const m = p.match(/^\/ea\/([^/]+)\/report\/batch\/([a-z_]+)\.json$/);
		if (!m) return send(200, fail(`action not found for ${p}`, "NOTFOUND_ACTION"));
		const [, site, action] = m;
		const sites = readFixture("websites.json").data.rows.map((r) => r[3]);
		if (!sites.includes(decodeURIComponent(site))) return send(200, fail(`site=${site} is not allowed for this token`, "SITE_NOTALLOWED"));

		const q = url.searchParams;
		switch (action) {
			case "kinds":
				return send(200, readFixture("kinds.json"));
			case "metrics": {
				const f = `metrics/${fixtureName(q.get("kind"))}.json`;
				return send(200, existsSync(join(FIXTURES, f)) ? readFixture(f) : fail(`unknown kind=${q.get("kind")}`));
			}
			case "dimensions": {
				// `path`, or `kind` alone (the kind's default level).
				const path = q.get("path") ?? DEFAULT_PATHS[q.get("kind")];
				if (!path) return send(200, fail("missing path parameter | "));
				const hit = DIMENSIONS_BY_PATH.find(([re]) => re.test(path));
				if (!hit) return send(200, fail(`unknown path=${path}`));
				// The captured lists do not include the `date_range` dimension, which the API lists for every level.
				const dims = readFixture(`dimensions/${hit[1]}.json`);
				if (!dims.data.rows.some((r) => r[0] === DATE_RANGE)) {
					dims.data.rows.push([DATE_RANGE, "Date Range"]);
					dims.data.rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
				}
				return send(200, dims);
			}
			case "segmentations": {
				const f = `segmentations/${fixtureName(q.get("kind"))}.json`;
				return send(200, existsSync(join(FIXTURES, f)) ? readFixture(f) : fail(`unknown kind=${q.get("kind")}`));
			}
			case "flat_aggregate": {
				if (req.method !== "POST") return send(405, fail("POST required"));
				const result = runFlatAggregate(body);
				if (body?.async === false || result.error || body?.dryRun) return send(200, result);
				// Async (default on the real API): returns a job id, in data.rows and at the top level.
				const id = String(Date.now()) + String(jobs.size);
				jobs.set(id, result);
				return send(200, { data: { fields: [{ name: "jobrun_id" }], rows: [[Number(id)]] }, rows: [[Number(id)]], error: false, meta: meta() });
			}
			case "status": {
				const id = q.get("jobrun-id");
				return send(200, jobs.has(id) ? ok({ jobrun_status: "COMPLETED" }) : fail(`unknown jobrun-id=${id}`));
			}
			case "download": {
				const id = q.get("jobrun-id");
				return send(200, jobs.has(id) ? jobs.get(id) : fail("unable to find temporary file", "FILE_NOTFOUND"));
			}
			default:
				return send(200, fail(`action=${action} not found`, "NOTFOUND_ACTION"));
		}
	});

	return new Promise((resolve) => {
		server.listen(port, host, () => {
			const actual = server.address().port;
			resolve({
				server,
				port: actual,
				url: `http://${host}:${actual}`,
				close: () => new Promise((r) => server.close(r))
			});
		});
	});
}

// CLI entry point
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const { url } = await startMockServer({
		port: Number(process.env.MOCK_PORT ?? 8787),
		host: process.env.MOCK_HOST ?? "127.0.0.1",
		token: process.env.MOCK_TOKEN ?? "mock-token"
	});
	console.log(`Eulerian mock API listening on ${url}${API_PREFIX}`);
}
