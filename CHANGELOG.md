# Changelog

## 1.0.0 — 2026-11-11

First release of the Tableau Web Data Connector 3.0 for the Eulerian Marketing Platform Batch Reporting API.

- Connection dialog listing websites, kinds, segmentation levels, dimensions and metrics from the API.
- Every `rt#` kind usable on its default level; segmentation level optional.
- Up to 9 periods per report (presets or custom dates). With several periods, a `Period` column (`date_range`,
  0 = first period) is added.
- Time breakdown per hour, day, week or month.
- Metric segmentation, dimension, metric and segment filters, aliases and custom labels.
- Automatic pagination, with a configurable page size and row cap.
- Typed Tableau columns: text, date, date & time, whole and decimal numbers; ratios shown as percentages.
- API token stored as a Tableau secret.
- Clear error messages, including the API error code.
