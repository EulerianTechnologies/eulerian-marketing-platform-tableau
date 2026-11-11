import { ConfigError } from "../core/errors";
import { validateConfig } from "../core/query";
import type { DateRange, DateScale, FieldRef, ReportConfig } from "../core/types";

/** One date-range row of the form: either a preset or a custom from/to. */
export interface DateRangeInput {
	preset?: string;
	from?: string;
	to?: string;
}

/** Raw values of the connector form (DOM-free so it can be unit-tested). */
export interface FormState {
	host: string;
	site: string;
	kind: string;
	path?: string;
	dimensions: Array<{ field: string; name?: string }>;
	metrics: Array<{ field: string; name?: string; segmentBy?: string }>;
	/** 1 to 9 periods (MAX_DATE_RANGES in core/query.ts), in the order of the form rows (period 0 first). */
	dateRanges: DateRangeInput[];
	dateScale?: string;
	language?: string;
	pageSize?: number | string;
	/** Optional JSON object with advanced report options (filters, segments, orderBy...). */
	advancedJson?: string;
}

/** Keys accepted in the "advanced" JSON box; anything else is rejected to avoid silent typos. */
export const ADVANCED_KEYS = [
	"dimensionFilterClauses",
	"metricFilterClauses",
	"segmentFilterClauses",
	"segments",
	"orderBy",
	"overwriteNameByAlias",
	"customLabels",
	"dateScalePer",
	"maxRows"
] as const;

export const DATE_PRESETS = [
	"TODAY",
	"YESTERDAY",
	"LAST_7_DAYS",
	"LAST_14_DAYS",
	"LAST_30_DAYS",
	"LAST_90_DAYS",
	"CURRENT_WEEK",
	"LAST_WEEKEND",
	"CURRENT_MONTH",
	"LAST_MONTH",
	"CURRENT_YEAR"
];

/** `index` is 0-based; messages number periods from 1, like the form rows. */
function toDateRange(input: DateRangeInput, index: number): DateRange {
	if (input?.preset) return { range: input.preset.trim().toUpperCase() };
	if (input?.from && input?.to) return { dateFrom: input.from, dateTo: input.to, dateFormat: "YYYY-MM-DD" };
	throw new ConfigError([`period ${index + 1}: select a preset or both "from" and "to" dates`]);
}

export function parseAdvanced(json: string | undefined): Partial<ReportConfig> {
	if (!json || !json.trim()) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new ConfigError([`advanced options are not valid JSON: ${(e as Error).message}`]);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ConfigError(["advanced options must be a JSON object"]);
	const unknown = Object.keys(parsed).filter((k) => !(ADVANCED_KEYS as readonly string[]).includes(k));
	if (unknown.length) throw new ConfigError([`unsupported advanced option(s): ${unknown.join(", ")} (allowed: ${ADVANCED_KEYS.join(", ")})`]);
	return parsed as Partial<ReportConfig>;
}

/** Builds and validates the ReportConfig sent to the handlers. Throws ConfigError. */
export function buildConfig(state: FormState): ReportConfig {
	const dimensions: FieldRef[] = state.dimensions.map((d) => ({ field: d.field, ...(d.name ? { name: d.name } : {}) }));
	const metrics: FieldRef[] = state.metrics.map((m) => ({
		field: m.field,
		...(m.name ? { name: m.name } : {}),
		...(m.segmentBy ? { segment: { by: m.segmentBy } } : {})
	}));
	const config: ReportConfig = {
		host: state.host.trim(),
		site: state.site,
		kind: state.kind,
		...(state.path ? { path: state.path } : {}),
		dimensions,
		metrics,
		// The number of periods (1..9) is checked by validateConfig.
		dateRanges: (state.dateRanges ?? []).map(toDateRange),
		...(state.dateScale ? { dateScale: state.dateScale as DateScale } : {}),
		language: (state.language as ReportConfig["language"]) || "en",
		...(state.pageSize ? { pageSize: Number(state.pageSize) } : {}),
		...parseAdvanced(state.advancedJson)
	};
	validateConfig(config);
	return config;
}
