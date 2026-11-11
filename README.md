# Eulerian Marketing Platform — Tableau connector

Tableau **Web Data Connector 3.0** for the Eulerian Marketing Platform
[Batch Reporting API](https://doc.api.eulerian.com). Pick a website, a kind (data source),
dimensions, metrics and one or more periods, and get a typed Tableau extract.

## Features

- Websites, kinds, segmentation levels, dimensions and metrics are listed from the API: nothing is hard-coded.
- Time series per hour, day, week or month.
- Metric segmentation (`segment.by`), dimension, metric and segment filters, aliases and custom labels.
- Up to 9 periods per report. With several periods, a `Period` column (`date_range`, 0 = first period) tells
  them apart.
- Automatic pagination.
- Every `rt#` kind works on its default level: picking a segmentation level is optional.
- The API token is stored as a Tableau **secret**, never in the workbook.

Supported endpoints: `https://<grid>.api.eulerian.com`, `https://<grid>.api.eulerian.ca`,
`https://<grid>.api.gouv.eulerian.fr`.

## Requirements

- Tableau Desktop or Tableau Server **2025.2** or later.
- An Eulerian API token with read access to the websites to report on.
- Network access from Tableau to the Eulerian API over HTTPS.

## Documentation

- [Installation](docs/INSTALL.md)
- [User guide](docs/USER-GUIDE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Build from source

Requires Node.js 20 or later.

```bash
npm ci
npm test
npm run connector:install
npm run package          # -> eulerian-marketing-platform-<version>.taco
```

## License

MIT © Eulerian Technologies. See [LICENSE](LICENSE).
