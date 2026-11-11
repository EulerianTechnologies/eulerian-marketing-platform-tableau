# Mock Eulerian API

A zero-dependency Node (>= 18) server emulating the Batch Reporting endpoints used by the connector,
so the connector can be developed and tested **without an Eulerian account and without the BI tool**.

```bash
node mock-server/server.mjs                      # http://127.0.0.1:8787/ea/v2
MOCK_PORT=9000 MOCK_TOKEN=secret node mock-server/server.mjs
```

Use `http://127.0.0.1:8787` as the endpoint and `mock-token` as the token.

## What it serves

| Endpoint | Source |
|---|---|
| `GET /ea/v2/er/account/getallowedwebsite.json` | `fixtures/websites.json` (`demo-fr`, `demo-en`) |
| `GET .../report/batch/kinds.json` | `fixtures/kinds.json` (111 kinds) |
| `GET .../metrics.json?kind=` | `fixtures/metrics/rt_<kind>.json` (`insummary`, `ope`, `website`) |
| `GET .../dimensions.json?path=` | `fixtures/dimensions/*.json`, chosen by path prefix |
| `GET .../segmentations.json?kind=` | `fixtures/segmentations/rt_<kind>.json` |
| `POST .../flat_aggregate.json` | emulated on `fixtures/datasets/rt_<kind>.json` |
| `GET .../status.json`, `download.json` | async jobs |

The `flat_aggregate` emulation projects the requested dimensions/metrics from the captured
dataset, re-aggregates when a captured dimension (e.g. `date_day`) is not requested, applies `orderBy`
and `limit`, `showAsObject`, `dryRun`, and metric `segment.by` (expansion into one column per segment).
It ignores dates and filters: every query returns the captured period, and every period of a multi-period
request holds the same rows.

## Behaviour emulated

HTTP 200 errors with `error_code` (`QUERY_INVALID` for `flat_aggregate`), `TOKEN_INVALID`, `orderBy must be an array`,
no-`path` queries on the kind's default level, `dimensions.json?kind=` without `path`, the `date_range` dimension and
per-period `limit` with several `dateRanges`, the `rt#insummary` `global` total row and its rows returned in one call,
two segment columns sharing one field id, `dataType` + `affinity` on metric columns.

## Fixtures

Captured from `demo-fr` on 2026-11-11 (`meta` removed). Captured periods:
`rt#insummary` and `rt#website` daily 2026-11-02..2026-11-08, `rt#ope` 2026-10-10..2026-11-08.

In `datasets/rt_ope.json`, the plain `realscartvalidamount` column holds the sum of its order-type segments.

Ratio metrics (`pct`) are **averaged** when the mock re-aggregates. That is only an approximation.

## Test helpers

- `GET /__mock/requests`: every request received (method, path, query, body, authorization).
- `POST /__mock/reset`: clears that log.
- `import { startMockServer } from "./server.mjs"`, then `await startMockServer({ port: 0 })` returns `{ url, port, close }`.
