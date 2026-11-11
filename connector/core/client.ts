import { assertApiOk, EulerianApiError } from "./errors";
import { normalizeContent } from "./normalize";
import { apiBase, batchBase, buildFlatAggregateBody, DEFAULT_MAX_ROWS, DEFAULT_PAGE_SIZE, validateConfig } from "./query";
import type { FlatAggregateContent, NormalizedPage, ReportConfig, Transport } from "./types";

/** Standard API list envelope: `{ data: { fields: [{name}], rows: [[...]] } }`. */
interface ListEnvelope {
	data?: { fields?: Array<{ name: string }>; rows?: unknown[][] };
}

export interface Site {
	id: string;
	name: string;
	timezone: string;
}
export interface Kind {
	kind: string;
	name: string;
}
export interface MetricInfo {
	field: string;
	name: string;
	type: string;
}
export interface DimensionInfo {
	field: string;
	name: string;
}
export interface Segmentation {
	path: string;
	text: string;
	children: Array<{ path: string; text: string }>;
}

/** Turns the standard `{ data: { fields, rows } }` envelope into objects. */
function rowsAsObjects(payload: ListEnvelope): Array<Record<string, unknown>> {
	const fields = payload.data?.fields;
	if (!Array.isArray(fields)) throw new EulerianApiError("Unexpected API response: missing data.fields");
	const names = fields.map((f) => f.name);
	return (payload.data?.rows ?? []).map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])));
}

export interface ClientOptions {
	host: string;
	token: string;
	transport: Transport;
}

/**
 * Thin client for the Batch Reporting API.
 * Discovery methods feed the UI; `runReport` streams normalized pages.
 */
export class EulerianClient {
	private readonly host: string;
	private readonly token: string;
	private readonly transport: Transport;

	constructor({ host, token, transport }: ClientOptions) {
		if (!token) throw new EulerianApiError("An Eulerian API token is required", "TOKEN_MISSING");
		this.host = host;
		this.token = token;
		this.transport = transport;
	}

	private headers(): Record<string, string> {
		return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "application/json" };
	}

	private async get<T>(url: string): Promise<T> {
		return assertApiOk((await this.transport({ method: "GET", url, headers: this.headers() })) as T);
	}

	private async post<T>(url: string, body: unknown): Promise<T> {
		return assertApiOk((await this.transport({ method: "POST", url, headers: this.headers(), body })) as T);
	}

	/** Websites the token can access. */
	async listSites(): Promise<Site[]> {
		const p = await this.get<ListEnvelope>(`${apiBase(this.host)}/er/account/getallowedwebsite.json`);
		return rowsAsObjects(p).map((r) => ({ id: String(r.website_id), name: String(r.website_name), timezone: String(r.website_tzone) }));
	}

	/** Real-time aggregate kinds only (`rt#...`): other families (cj#, mta#, hq#) use other endpoints. */
	async listKinds(site: string): Promise<Kind[]> {
		const p = await this.get<ListEnvelope>(`${batchBase(this.host, site)}/kinds.json`);
		return rowsAsObjects(p)
			.map((r) => ({ kind: String(r.kind), name: String(r.name) }))
			.filter((k) => k.kind.startsWith("rt#"));
	}

	async listMetrics(site: string, kind: string): Promise<MetricInfo[]> {
		const p = await this.get<ListEnvelope>(`${batchBase(this.host, site)}/metrics.json?kind=${encodeURIComponent(kind)}`);
		return rowsAsObjects(p).map((r) => ({ field: String(r.field), name: String(r.name), type: String(r.affinity ?? "") }));
	}

	async listDimensions(site: string, path: string): Promise<DimensionInfo[]> {
		const p = await this.get<ListEnvelope>(`${batchBase(this.host, site)}/dimensions.json?path=${encodeURIComponent(path)}`);
		return rowsAsObjects(p).map((r) => ({ field: String(r.field), name: String(r.name) }));
	}

	async listSegmentations(site: string, kind: string, path?: string): Promise<Segmentation[]> {
		const qs = `kind=${encodeURIComponent(kind)}${path ? `&path=${encodeURIComponent(path)}` : ""}`;
		const p = await this.get<ListEnvelope>(`${batchBase(this.host, site)}/segmentations.json?${qs}`);
		return rowsAsObjects(p).map((r) => ({
			path: String(r.path),
			text: String(r.text),
			children: ((r.segmentations as Array<{ path: string; text: string }>) ?? []).map((c) => ({ path: c.path, text: c.text }))
		}));
	}

	/**
	 * The dimensions endpoint needs a `path`, which is only known once the engine resolves the kind.
	 * A `dryRun` query (no data computed) returns that resolved path.
	 */
	async resolveDefaultPath(site: string, kind: string, metricField: string): Promise<string> {
		const body = {
			async: false,
			dryRun: true,
			reports: [{ kind, dateRanges: [{ range: "YESTERDAY" }], dimensions: [{ name: "d", field: "date_day" }], metrics: [{ name: "m", field: metricField }] }],
			output: { flat: true }
		};
		const p = await this.post<{ data?: { request?: { reports?: Array<{ path?: string }> } } }>(`${batchBase(this.host, site)}/flat_aggregate.json`, body);
		const path = p.data?.request?.reports?.[0]?.path;
		if (!path) throw new EulerianApiError(`Unable to resolve the default path of ${kind}`);
		return path;
	}

	/** Runs the query for one page. */
	async fetchPage(config: ReportConfig, start: number, maxEntries: number): Promise<FlatAggregateContent> {
		const body = buildFlatAggregateBody(config, { start, maxEntries });
		const p = await this.post<{ data?: { content?: FlatAggregateContent } }>(`${batchBase(this.host, config.site)}/flat_aggregate.json`, body);
		const content = p.data?.content;
		if (!content || !Array.isArray(content.columnHeader)) throw new EulerianApiError("Unexpected flat_aggregate response: missing data.content");
		return content;
	}

	/**
	 * Streams normalized pages. Standard pagination: the next page is requested only after a full page,
	 * until `totalRowCount` or `maxRows` is reached.
	 *
	 * With n periods, `limit` applies to EACH period: `{ start, maxEntries: P }` returns up to n x P rows
	 * (interleaved per entity: period 0, period 1, ...), `start` counts rows of one period, and
	 * `totalRowCount` counts all periods (n x the per-period count). So a full page is n x P rows, the
	 * per-period offset advances by got / n, and the per-period total is totalRowCount / n. `maxRows` caps
	 * the rows of each period. With n = 1 this is plain offset pagination.
	 * A page of any other size than n x P (shorter, or longer than requested) stops the loop.
	 */
	async *runReport(config: ReportConfig): AsyncGenerator<NormalizedPage> {
		validateConfig(config);
		const periods = config.dateRanges.length;
		const pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE;
		const maxRows = config.maxRows ?? DEFAULT_MAX_ROWS;
		let start = 0; // per-period offset
		for (;;) {
			const take = Math.min(pageSize, maxRows - start);
			const content = await this.fetchPage(config, start, take);
			yield normalizeContent(content);
			const got = content.data?.length ?? 0;
			start += got / periods;
			const reachedTotal = content.totalRowCount !== undefined && start >= content.totalRowCount / periods;
			if (got !== periods * take || reachedTotal || start >= maxRows) break;
		}
	}
}
