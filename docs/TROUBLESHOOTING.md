# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `[TOKEN_INVALID] token is invalid` | wrong, expired or revoked token | create a new token in Eulerian |
| `endpoint "…" must be https://<grid>.api.eulerian.com…` | endpoint outside the allowed domains, or `http://` | use your grid URL, e.g. `https://mygrid.api.eulerian.com` |
| `site=… is not allowed` / empty website list | the token cannot read that site | ask an Eulerian admin to grant access |
| `dimension: field=… is not available for leaf=…` | the dimension does not exist at the chosen segmentation level | pick another level, or a dimension listed for this one |
| `at most 9 periods are allowed` | more than 9 periods | split the periods over several data sources |
| `metric "…" is requested both plain and segmented` | the same metric is requested plain and with *segment by* in one report | request it in two separate reports (one plain, one segmented) |
| `period N: select a preset or both "from" and "to" dates` | a custom period with a missing date | fill both dates or pick a preset |
| Rows look duplicated | several periods: each row exists once per period | use the `Period` column (0 = first period) to split or filter them |
| `check: orderBy must be an array` | `orderBy` given as an object in the advanced options | use `[{"field":"visit","direction":"DESC"}]` |
| No rows at all | the period has no data, or a filter excludes everything | widen the period or remove filters |
| Time breakdown rejected | period too long for the scale | H < 3 days, D < 90 days, W < 55 weeks, M < 15 months |
| Timeouts on large extracts | too many rows per call (periods × *Rows per API call*) | lower *Rows per API call*, shorten or remove periods, add filters |
| "connector is not signed" in Tableau | unsigned build (e.g. built from source) | use a signed release, or disable verification on a test machine ([INSTALL.md](INSTALL.md)) |
| Totals look doubled on `rt#insummary` | `rt#insummary` includes a `global` row holding the total of all channels | add a data source filter `media_key_po <> "global"` |
| Conversion rate looks wrong when aggregated | ratios are averaged | compute `SUM(numerator)/SUM(denominator)` |

## Logs

- Tableau Desktop: `My Tableau Repository/Logs/` (`log.txt` and the Taco/EPS logs). Look for lines starting with `Eulerian:`.
- Every API error message starts with the API's `error_code` in brackets (e.g. `[QUERY_INVALID]`).

To report an issue, open a GitHub issue with the error message, the kind, dimensions, metrics and
period, but **never your token**.
