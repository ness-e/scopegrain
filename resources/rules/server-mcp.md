# Server and Protocol Boundaries

Validate transport inputs, authorization context and serialized outputs.
Keep declared tools, versions and capabilities aligned with implementation.
Bound concurrency and expensive work using the actual server runtime.
Test errors, malformed requests, cancellation and clean shutdown as relevant.
Do not claim a metric is measured unless its data is collected and checked.
