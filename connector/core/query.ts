import { ConfigError } from "./errors";
import type { DateRange, ReportConfig } from "./types";

export const MAX_METRICS = 35;
/** The API accepts up to 9 dateRanges per report. */
export const MAX_DATE_RANGES = 9;
/**
 * Dimension holding the 0-based index of the `dateRanges` entry of each row (an int).
 * It is what tells the periods apart when a report has several.
 */
export const DATE_RANGE_FIELD = "date_range";
/** Caption of the period column added by the connector. */
export const DATE_RANGE_NAME = "Period";
export const DEFAULT_PAGE_SIZE = 1000;
export const DEFAULT_MAX_ROWS = 100000;

/**
 * Eulerian API platforms. The user types the full endpoint URL; its host must end with one of
 * these suffixes (the token must never be sent elsewhere, and Tableau requires every domain
 * to be declared in connector.json anyway).
 */
export const ALLOWED_DOMAINS = ["api.eulerian.com", "api.eulerian.ca", "api.gouv.eulerian.fr"];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

/** `<grid>.api.eulerian.com`, `<grid>.api.eulerian.ca` or `<grid>.api.gouv.eulerian.fr`. */
const isAllowedHost = (hostname: string): boolean =>
	ALLOWED_DOMAINS.some((d) => new RegExp(`^[a-z0-9-]+\\.${d.replace(/\./g, "\\.")}$`, "i").test(hostname));

/**
 * Returns the API origin for the endpoint typed by the user (full URL or bare host).
 * - `https://acme.api.eulerian.com/ea/v2/` or `acme.api.eulerian.com` -> `https://acme.api.eulerian.com`
 * - `http://127.0.0.1:8787` is accepted for the mock server only.
 */
export function apiOrigin(host: string): string {
	const trimmed = String(host ?? "").trim().replace(/\/+$/, "");
	const m = trimmed.match(/^(https?):\/\/(.+)$/i);
	const scheme = m ? m[1].toLowerCase() : "https";
	const hostname = (m ? m[2] : trimmed).replace(/\/.*$/, "");
	if (LOCAL_HOST.test(hostname)) return `${scheme}://${hostname}`;
	if (!isAllowedHost(hostname)) {
		throw new ConfigError([`endpoint "${host}" must be https://<grid>.${ALLOWED_DOMAINS.join(", https://<grid>.")}`]);
	}
	if (scheme !== "https") throw new ConfigError([`host "${host}" must use https`]);
	return `https://${hostname.toLowerCase()}`;
}

/** Base URL of the v2 API, e.g. `https://acme.api.eulerian.com/ea/v2`. */
export const apiBase = (host: string): string => `${apiOrigin(host)}/ea/v2`;

/** Base URL of the batch reporting endpoints for a site. */
export const batchBase = (host: string, site: string): string =>
	`${apiBase(host)}/ea/${encodeURIComponent(site)}/report/batch`;

function validateDateRange(dr: DateRange, i: number): string[] {
	const where = `dateRanges[${i}]`;
	if (!dr || typeof dr !== "object") return [`${where} must be an object`];
	if ("range" in dr) {
		// Format check only: the API is the authority on which presets exist.
		return /^[A-Z0-9_]+$/.test(dr.range) ? [] : [`${where}.range "${dr.range}" is not a valid preset (e.g. LAST_7_DAYS)`];
	}
	if ("dateFrom" in dr) {
		const out: string[] = [];
		if (!dr.dateFormat) out.push(`${where}.dateFormat is required with dateFrom/dateTo`);
		if (!dr.dateTo) out.push(`${where}.dateTo is required`);
		if (dr.dateFormat === "YYYY-MM-DD" && dr.dateFrom > dr.dateTo) out.push(`${where}: dateFrom is after dateTo`);
		return out;
	}
	if ("from" in dr) {
		return Number.isInteger(dr.from) && Number.isInteger(dr.to) && dr.from < dr.to ? [] : [`${where}: from/to must be epoch seconds with from < to`];
	}
	return [`${where} must have "range", "dateFrom"/"dateTo" or "from"/"to"`];
}

/**
 * A metric field cannot be requested both plain and segmented in the same report: the API indexes metrics
 * by field, so the plain column would not hold the plain value. Such a report is refused before any call.
 * Two different segmentations of the same metric are fine.
 */
function checkPlainAndSegmented(metrics: ReportConfig["metrics"]): string[] {
	if (!Array.isArray(metrics)) return [];
	const plain = new Set(metrics.filter((m) => m?.field && !m.segment).map((m) => m.field));
	const segmented = new Set(metrics.filter((m) => m?.field && m.segment?.by).map((m) => m.field));
	return [...plain]
		.filter((f) => segmented.has(f))
		.map((f) => `metric "${f}" is requested both plain and segmented: request it in two separate reports`);
}

/**
 * Dimensions sent to the API. With several periods, rows are only told apart by the `date_range`
 * dimension: it is prepended (as "Period") unless the user already requested it. With one period
 * nothing is added.
 */
export function requestDimensions(config: ReportConfig): Array<{ name: string; field: string }> {
	const dims = config.dimensions.map((d) => ({ name: d.name ?? d.field, field: d.field }));
	const needsPeriod = config.dateRanges.length > 1 && !dims.some((d) => d.field === DATE_RANGE_FIELD);
	return needsPeriod ? [{ name: DATE_RANGE_NAME, field: DATE_RANGE_FIELD }, ...dims] : dims;
}

/** Validates a configuration and throws a ConfigError listing every problem found. */
export function validateConfig(config: ReportConfig): void {
	const p: string[] = [];
	if (!config || typeof config !== "object") throw new ConfigError(["configuration is missing"]);
	try {
		apiOrigin(config.host);
	} catch (e) {
		p.push(...((e as ConfigError).problems ?? [String(e)]));
	}
	if (!config.site) p.push("site is required");
	if (!config.kind || !config.kind.startsWith("rt#")) p.push(`kind "${config.kind ?? ""}" must start with rt#`);
	if (!Array.isArray(config.dimensions) || config.dimensions.length === 0) p.push("at least one dimension is required");
	if (!Array.isArray(config.metrics) || config.metrics.length === 0) p.push("at least one metric is required");
	else if (config.metrics.length > MAX_METRICS) p.push(`at most ${MAX_METRICS} metrics are allowed (got ${config.metrics.length})`);
	for (const [i, f] of [...(config.dimensions ?? []), ...(config.metrics ?? [])].entries()) {
		if (!f || !f.field) p.push(`field #${i + 1} has no "field"`);
	}
	if (!Array.isArray(config.dateRanges) || config.dateRanges.length === 0) p.push("at least one date range is required");
	else {
		if (config.dateRanges.length > MAX_DATE_RANGES) {
			p.push(`at most ${MAX_DATE_RANGES} periods are allowed (got ${config.dateRanges.length})`);
		}
		config.dateRanges.forEach((dr, i) => p.push(...validateDateRange(dr, i)));
	}
	p.push(...checkPlainAndSegmented(config.metrics));
	if (config.dateScale && !["H", "D", "W", "M"].includes(config.dateScale)) p.push(`dateScale "${config.dateScale}" must be H, D, W or M`);
	if (config.pageSize !== undefined && (!Number.isInteger(config.pageSize) || config.pageSize < 1)) p.push("pageSize must be a positive integer");
	if (p.length) throw new ConfigError(p);
}

/** Builds the JSON body of POST /report/batch/flat_aggregate.json for one page. */
export function buildFlatAggregateBody(config: ReportConfig, page: { start: number; maxEntries: number }) {
	const report: Record<string, unknown> = {
		kind: config.kind,
		language: config.language ?? "en",
		dateRanges: config.dateRanges,
		dimensions: requestDimensions(config),
		metrics: config.metrics.map((m) => ({ name: m.name ?? m.field, field: m.field, ...(m.segment ? { segment: m.segment } : {}) })),
		// A stable order is required for pagination to be deterministic.
		orderBy: config.orderBy?.length ? config.orderBy : [{ field: config.metrics[0].field, direction: "DESC" }],
		// With several periods, `limit` applies to each period (see runReport).
		limit: { start: page.start, maxEntries: page.maxEntries }
	};
	if (config.path) report.path = config.path;
	if (config.dateScale) {
		report.dateScale = config.dateScale;
		report.dateRangeSplitPerScale = true;
	}
	if (config.dateScalePer) report.dateScalePer = config.dateScalePer;
	if (config.overwriteNameByAlias) report.overwriteNameByAlias = true;
	if (config.customLabels) report.customLabels = true;
	for (const k of ["dimensionFilterClauses", "metricFilterClauses", "segmentFilterClauses", "segments"] as const) {
		if (config[k]?.length) report[k] = config[k];
	}
	// Synchronous mode, documented in the how-to (section 11 "async: false").
	return { async: false, reports: [report], output: { flat: true } };
}
