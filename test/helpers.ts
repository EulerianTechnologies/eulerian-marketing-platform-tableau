import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Transport } from "../connector/core/types";

/** Transport based on the global fetch (Node >= 18). */
export const fetchTransport: Transport = async (req) => {
	const res = await fetch(req.url, {
		method: req.method,
		headers: req.headers,
		body: req.body === undefined ? undefined : JSON.stringify(req.body)
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
};

/** Loads a mock-server fixture (captured from the demo-fr site). */
export const fixture = (rel: string) =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../mock-server/fixtures/${rel}`, import.meta.url)), "utf8"));
