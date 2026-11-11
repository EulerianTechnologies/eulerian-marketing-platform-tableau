# User guide

## Connecting

1. *Connect > To a Server > Eulerian Marketing Platform*.
2. **API endpoint URL**: the URL of your grid, e.g. `https://mygrid.api.eulerian.com`
   (`.api.eulerian.ca` and `.api.gouv.eulerian.fr` are also accepted). Paths such as `/ea/v2` are ignored.
3. **API token**, then **Connect**. The dialog then lists the websites the token can read.

## Building the report

| Step | What to choose | Notes |
|---|---|---|
| Website | one of your sites | timezone shown in brackets. Dates follow that timezone. |
| Kind | the data source (`rt#insummary`, `rt#ope`, `rt#website`, `rt#browser`…) | only real-time aggregate kinds (`rt#`) are listed |
| Segmentation level | optional drill-down path (e.g. *acquisition campaign*) | *Default* uses the kind's default level |
| Dimensions | at least one | the list depends on the kind and level, and comes from the API. If the API returns an error, it is shown as is |
| Metrics | 1 to 35 | each metric can be **segmented** (by order type, payment, region…): one column per segment value. A metric cannot be requested both plain and segmented in the same report (see below) |
| Periods | 1 to 9, each a preset (`LAST_7_DAYS`, `CURRENT_MONTH`…) or custom dates (inclusive) | **Add period** adds a row, ✕ removes one. With several periods a `Period` column is added (see below) |
| Time breakdown | none, hour, day, week, month | hour < 3 days, day < 90 days, week < 55 weeks, month < 15 months |

Then **Get data**.

### Typical recipes

| Need | Kind | Dimensions | Metrics |
|---|---|---|---|
| Visits & sales per channel | `rt#insummary` | `media_key_po` | `visit`, `realscartvalid`, `realscartvalidamount` |
| Campaign performance | `rt#ope` | `publisher_name`, `ope_name` | `click`, `cost`, `realscartvalidamount` |
| This month vs last month per channel | `rt#insummary`, periods `CURRENT_MONTH` + `LAST_MONTH` | `media_key_po` | `visit` |
| Daily website trend | `rt#website` + time breakdown *Day* | `date_day`, `website_name` | `visit`, `hit` |

## The resulting table

One table named `Eulerian <kind> (<site>)`, with the rows exactly as the API returns them:

| Column | Meaning |
|---|---|
| `Period` (`date_range`) | only with several periods: whole number, the period of the row in the order of the dialog (**0 = first period**, 1 = second…) |
| dimensions | text, except `date_day` (date), `date_iso8601` / `date_hour` (date & time) |
| metrics | numbers. **Ratios** (conversion rate…) are decimals shown as percentages and **averaged** by default |

Column captions are the API labels in the chosen language. The underlying field name is in each
column's description.

### Several periods

With two periods or more, every row exists once per period and the `Period` column tells them apart
(`0` = first period of the dialog). The connector adds it automatically; you can also pick the `date_range`
dimension yourself (then it is not added twice). To compare periods in Tableau, put `Period` on Columns or
Color, or create calculated fields such as `IF [Period] = 0 THEN [Visits] END`. Without filtering on `Period`,
sums add up all periods.

> **Ratios.** An average of daily conversion rates is not the period's conversion rate.
> For exact ratios, bring in both components (e.g. `realscartvalid` and `visit`) and compute
> `SUM([realscartvalid]) / SUM([visit])` in Tableau.

## Options

- **Labels language**: `en`, `fr`, `es`. This also changes dimension values such as channel names.
- **Rows per API call**: page size per period (default 1000): with several periods, one call returns up to
  periods × this number of rows. Lower it if you get timeouts.
- **Advanced options (JSON)**: an object with any of
  `dimensionFilterClauses`, `metricFilterClauses`, `segmentFilterClauses`, `segments`, `orderBy`,
  `overwriteNameByAlias`, `customLabels`, `dateScalePer`, `maxRows` (row cap per period, default 100000).

```json
{
  "segmentFilterClauses": [{ "field": "device", "operator": "IN", "value": "Phone" }],
  "dimensionFilterClauses": [{ "field": "publisher_name", "operator": "CONTAINS", "value": "google" }],
  "metricFilterClauses": [{ "field": "click", "operator": "GREATER_THAN", "value": "100" }],
  "overwriteNameByAlias": true
}
```

Operators: dimensions `IS, CONTAINS, NOT_CONTAINS, STARTS_WITH, ENDS_WITH, IN, EREGEXP`;
metrics `EQUALS, NOT_EQUALS, LOWER_THAN, LOWER_THAN_EQUALS, GREATER_THAN, GREATER_THAN_EQUALS`;
segments `IS, IN, NOT_IN, CONTAINS, NOT_CONTAINS, STARTS_WITH, ENDS_WITH, EREGEXP`.

## Limitations

- **Same metric plain and segmented**: a metric cannot be requested both plain and segmented in the same report.
  Such a report is refused with the message
  `metric "<field>" is requested both plain and segmented: request it in two separate reports`.
  Use two reports, one plain and one segmented. The same metric segmented in two different ways is fine.
- When the API returns two segment columns with the same field id, the second one is named `<field>__2`
  and keeps its own caption.

## Good to know

- **`rt#insummary` includes a `global` row** holding the total of all channels. Exclude
  `media_key_po = "global"` (data source filter) before summing channels.
- Customer-journey (`cj#`) and MTA (`mta#`) reports are not supported. They use other endpoints.
