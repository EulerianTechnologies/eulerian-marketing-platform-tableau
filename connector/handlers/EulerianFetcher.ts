import { Fetcher, FetchUtils, FetchOptions, log } from "@tableau/taco-toolkit/handlers";
import { EulerianClient } from "../core/client";
import type { ReportConfig, Transport } from "../core/types";

/** Adapts Tableau's sandboxed FetchUtils to the core Transport interface. */
export const tacoTransport: Transport = (req) =>
	FetchUtils.fetchJson(req.url, {
		method: req.method,
		headers: req.headers,
		...(req.body !== undefined ? { body: req.body as object } : {})
	});

/**
 * Runs inside the Tableau extract process (EPS sandbox).
 * `handlerInput.data` carries the ReportConfig built by the connector app,
 * `secrets.token` carries the API token (never stored in the workbook).
 */
export default class EulerianFetcher extends Fetcher {
	async *fetch({ handlerInput, secrets }: FetchOptions) {
		const config = handlerInput.data as ReportConfig;
		const token = String(secrets?.token ?? "");
		const client = new EulerianClient({ host: config.host, token, transport: tacoTransport });

		let pages = 0;
		for await (const page of client.runReport(config)) {
			pages += 1;
			log(`Eulerian: page ${pages}: ${page.rows.length} rows`);
			yield { config: { site: config.site, kind: config.kind }, page };
		}
	}
}
