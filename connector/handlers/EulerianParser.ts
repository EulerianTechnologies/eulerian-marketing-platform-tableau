import { DataContainer, ParseOptions, Parser, log } from "@tableau/taco-toolkit/handlers";
import type { ColumnHeader, DataRow } from "@tableau/taco-toolkit/handlers";
import { tableName, tableauId, toTableauColumns } from "../core/tableau-schema";
import type { NormalizedPage } from "../core/types";

export interface FetcherChunk {
	config: { site: string; kind: string };
	page: NormalizedPage;
}

/**
 * Receives every chunk yielded by EulerianFetcher and appends it to a single table.
 * The schema is taken from the first page; later pages only contribute rows
 * (columns unknown to the schema are dropped and logged).
 */
export default class EulerianParser extends Parser<FetcherChunk> {
	parse({ config, page }: FetcherChunk, { dataContainer }: ParseOptions): DataContainer {
		const containerBuilder = Parser.createContainerBuilder(dataContainer);
		const { id, name } = tableName(config.site, config.kind);
		const { isNew, tableBuilder } = containerBuilder.getTable(name);

		const columns = toTableauColumns(page.columns);
		if (isNew) {
			tableBuilder.setId(id);
			tableBuilder.addColumnHeaders(columns as unknown as ColumnHeader[]);
		}

		const known = new Set(columns.map((c) => c.id));
		const dropped = new Set<string>();
		const rows: DataRow[] = page.rows.map((r) => {
			const out: DataRow = {};
			for (const [k, v] of Object.entries(r)) {
				const key = tableauId(k);
				if (known.has(key)) out[key] = v;
				else dropped.add(key);
			}
			return out;
		});
		if (dropped.size) log(`Eulerian: columns not in schema were dropped: ${[...dropped].join(", ")}`);

		tableBuilder.addRows(rows);
		return containerBuilder.getDataContainer();
	}
}
