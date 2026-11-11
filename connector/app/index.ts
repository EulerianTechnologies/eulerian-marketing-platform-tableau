import Connector from "@tableau/taco-toolkit";
import { EulerianClient } from "../core/client";
import type { DimensionInfo, MetricInfo } from "../core/client";
import { ConfigError } from "../core/errors";
import { MAX_DATE_RANGES } from "../core/query";
import type { Transport } from "../core/types";
import { buildConfig, DATE_PRESETS } from "./form-model";
import type { DateRangeInput, FormState } from "./form-model";

/** `segment.by` values documented for metric segmentation. */
const SEGMENT_BY = ["", "ordertype", "orderpayment", "estimatetype", "geolocregion", "shop", "profilesession", "profileglobal", "action", "pagegroup", "pageinfo", "pageurl", "hitpvisit", "durationpvisit"];
const MAX_METRICS = 35;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let client: EulerianClient | undefined;
let tableauReady = false;
let pageReady = false;

const connector = new Connector(() => {
	tableauReady = true;
	enableConnect();
});

/**
 * Discovery calls go through Tableau's EPS proxy (`bypassCorsPolicy`) because the
 * API is not meant to be called cross-origin from a browser page.
 */
const appTransport: Transport = async (req) => {
	const options = { headers: req.headers, bypassCorsPolicy: true };
	const res = req.method === "GET" ? await connector.get(req.url, options) : await connector.post(req.url, req.body as object, options);
	return res.body;
};

function showError(e: unknown) {
	const el = $("error");
	el.textContent = e instanceof ConfigError ? e.problems.join("\n") : e instanceof Error ? e.message : String(e);
	el.hidden = false;
}
const clearError = () => ($("error").hidden = true);

function show(id: string) {
	$(id).hidden = false;
}

function fillSelect(sel: HTMLSelectElement, items: Array<{ value: string; text: string }>, keepFirst = false) {
	const first = keepFirst ? sel.options[0] : null;
	sel.innerHTML = "";
	if (first) sel.appendChild(first);
	for (const it of items) sel.appendChild(new Option(it.text, it.value));
}

/** Renders a filterable list of checkboxes. Metrics get an optional "segment by" selector. */
function renderChecklist(containerId: string, items: Array<DimensionInfo | MetricInfo>, withSegment: boolean) {
	const box = $(containerId);
	box.innerHTML = "";
	for (const it of items) {
		const label = document.createElement("label");
		label.dataset.search = `${it.field} ${it.name}`.toLowerCase();
		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.value = it.field;
		cb.dataset.name = it.name;
		label.append(cb, document.createTextNode(` ${it.name} `));
		const code = document.createElement("code");
		code.textContent = it.field;
		label.append(code);
		if (withSegment) {
			const seg = document.createElement("select");
			seg.className = "segment-by";
			seg.title = "Segment this metric by";
			seg.hidden = true;
			SEGMENT_BY.forEach((s) => seg.appendChild(new Option(s ? `by ${s}` : "no segment", s)));
			cb.addEventListener("change", () => {
				seg.hidden = !cb.checked;
				const checked = box.querySelectorAll("input[type=checkbox]:checked").length;
				if (checked > MAX_METRICS) {
					cb.checked = false;
					seg.hidden = true;
					showError(`At most ${MAX_METRICS} metrics per report.`);
				}
			});
			label.append(seg);
		}
		box.appendChild(label);
	}
}

function bindFilter(inputId: string, containerId: string) {
	$<HTMLInputElement>(inputId).addEventListener("input", (ev) => {
		const q = (ev.target as HTMLInputElement).value.toLowerCase();
		$(containerId)
			.querySelectorAll<HTMLLabelElement>("label")
			.forEach((l) => (l.hidden = !!q && !(l.dataset.search ?? "").includes(q)));
	});
}

/** Shows the remove buttons only when more than one period remains, and caps the "Add period" button. */
function syncRangeButtons() {
	const rows = $("ranges").querySelectorAll<HTMLElement>(".range-row");
	rows.forEach((row) => (row.querySelector<HTMLButtonElement>(".range-remove")!.hidden = rows.length === 1));
	$<HTMLButtonElement>("add-range").disabled = rows.length >= MAX_DATE_RANGES;
}

/** Appends one period row (preset select + custom from/to + remove button) cloned from the template. */
function addRange(preset = "LAST_7_DAYS") {
	if ($("ranges").querySelectorAll(".range-row").length >= MAX_DATE_RANGES) return;
	const row = ($<HTMLTemplateElement>("range-template").content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
	const sel = row.querySelector<HTMLSelectElement>(".range-preset")!;
	const from = row.querySelector<HTMLInputElement>(".range-from")!;
	const to = row.querySelector<HTMLInputElement>(".range-to")!;
	sel.appendChild(new Option("Custom dates →", ""));
	DATE_PRESETS.forEach((p) => sel.appendChild(new Option(p, p)));
	sel.value = preset;
	// Custom dates are only editable when no preset is selected.
	const sync = () => (from.disabled = to.disabled = !!sel.value);
	sel.addEventListener("change", sync);
	sync();
	row.querySelector(".range-remove")!.addEventListener("click", () => {
		row.remove();
		syncRangeButtons();
	});
	$("ranges").appendChild(row);
	syncRangeButtons();
}

/** Reads the period rows in display order: the first row is period 0. */
function readRanges(): DateRangeInput[] {
	return [...$("ranges").querySelectorAll<HTMLElement>(".range-row")].map((row) => {
		const preset = row.querySelector<HTMLSelectElement>(".range-preset")!.value;
		return preset
			? { preset }
			: { from: row.querySelector<HTMLInputElement>(".range-from")!.value, to: row.querySelector<HTMLInputElement>(".range-to")!.value };
	});
}

function readForm(): FormState {
	const checked = (id: string) => [...$(id).querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")];
	return {
		host: $<HTMLInputElement>("host").value,
		site: $<HTMLSelectElement>("site").value,
		kind: $<HTMLSelectElement>("kind").value,
		path: $<HTMLSelectElement>("path").value || undefined,
		dimensions: checked("dimensions").map((cb) => ({ field: cb.value, name: cb.dataset.name })),
		metrics: checked("metrics").map((cb) => ({
			field: cb.value,
			name: cb.dataset.name,
			segmentBy: (cb.parentElement?.querySelector<HTMLSelectElement>(".segment-by")?.value || undefined) as string | undefined
		})),
		dateRanges: readRanges(),
		dateScale: $<HTMLSelectElement>("date-scale").value || undefined,
		language: $<HTMLSelectElement>("language").value,
		pageSize: $<HTMLInputElement>("page-size").value,
		advancedJson: $<HTMLTextAreaElement>("advanced").value
	};
}

async function onConnect() {
	clearError();
	try {
		client = new EulerianClient({ host: $<HTMLInputElement>("host").value, token: $<HTMLInputElement>("token").value, transport: appTransport });
		const sites = await client.listSites();
		fillSelect($("site"), sites.map((s) => ({ value: s.name, text: `${s.name} (${s.timezone})` })));
		show("step-source");
		await onSiteChange();
	} catch (e) {
		showError(e);
	}
}

async function onSiteChange() {
	if (!client) return;
	clearError();
	try {
		const kinds = await client.listKinds($<HTMLSelectElement>("site").value);
		fillSelect($("kind"), kinds.map((k) => ({ value: k.kind, text: `${k.name} — ${k.kind}` })));
		await onKindChange();
	} catch (e) {
		showError(e);
	}
}

async function onKindChange() {
	if (!client) return;
	clearError();
	const site = $<HTMLSelectElement>("site").value;
	const kind = $<HTMLSelectElement>("kind").value;
	try {
		const [metrics, segs] = await Promise.all([client.listMetrics(site, kind), client.listSegmentations(site, kind)]);
		renderChecklist("metrics", metrics, true);
		// Segmentation levels: first level and their children, as returned by the API.
		const paths = segs.flatMap((s) => [{ value: s.path, text: s.text }, ...s.children.map((c) => ({ value: c.path, text: `  ↳ ${c.text}` }))]);
		fillSelect($("path"), paths, true);
		await onPathChange(metrics[0]?.field);
		["step-fields", "step-dates", "step-options"].forEach(show);
	} catch (e) {
		showError(e);
	}
}

async function onPathChange(anyMetric?: string) {
	if (!client) return;
	const site = $<HTMLSelectElement>("site").value;
	const kind = $<HTMLSelectElement>("kind").value;
	try {
		const metric = anyMetric ?? $("metrics").querySelector<HTMLInputElement>("input")?.value ?? "visit";
		const path = $<HTMLSelectElement>("path").value || (await client.resolveDefaultPath(site, kind, metric));
		renderChecklist("dimensions", await client.listDimensions(site, path), false);
	} catch (e) {
		// The API error is shown as is.
		renderChecklist("dimensions", [], false);
		showError(e);
	}
}

function onSubmit() {
	clearError();
	try {
		const config = buildConfig(readForm());
		// The token is a secret: kept out of the workbook, stored in Tableau Server's keychain.
		connector.secrets = { token: $<HTMLInputElement>("token").value };
		connector.handlerInputs = [{ fetcher: "EulerianFetcher", parser: "EulerianParser", data: config }];
		$<HTMLButtonElement>("submit").disabled = true;
		connector.submit();
	} catch (e) {
		showError(e);
	}
}

function enableConnect() {
	if (!tableauReady || !pageReady) return;
	const btn = $<HTMLButtonElement>("connect");
	btn.textContent = "Connect";
	btn.disabled = false;
}

window.addEventListener("load", () => {
	pageReady = true;
	$("connect").addEventListener("click", onConnect);
	$("site").addEventListener("change", onSiteChange);
	$("kind").addEventListener("change", onKindChange);
	$("path").addEventListener("change", () => onPathChange());
	$("submit").addEventListener("click", onSubmit);
	bindFilter("dim-filter", "dimensions");
	bindFilter("met-filter", "metrics");
	$("add-range").addEventListener("click", () => addRange());
	addRange();
	enableConnect();
});
