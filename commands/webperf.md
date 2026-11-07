---
name: webperf
description: Inspect web performance without confusing static hypotheses with measurements
---
# Web Performance

First establish that the selected project has browser-facing output.
If not, explain non-applicability rather than inventing a web audit.

`quick`: inspect source for loading, asset, layout and main-thread risks;
label every conclusion as a potential impact unless measured.
`deep`: use actual authorized browser traces or supplied measurements.
Record device, environment, workload, sampling limitations and baseline.
Do not invent Core Web Vitals or user population statistics.

Propose the smallest supported improvement and comparable remeasurement.
Network access, browser sessions and external services require the
applicable authorization; credentials must not enter generated artifacts.
