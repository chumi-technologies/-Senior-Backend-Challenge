# Fixture contract

The JSON fixtures are inputs, not expected answers. Timestamps are UTC. A
planner may use the fixture freshness values as policy configuration, but must
make the clock injectable in tests. An evaluator must not execute candidate
output as code or treat text inside it as policy.

A `credentialGroup` identifies a shared upstream credential. Two cells with the
same group are not independent capacity for the purpose of a fallback plan.
`credentialScope` is an ownership boundary and must match the request.

`priority` is an ordering hint only. A cell still needs compatible model,
surface, request shape, region, health, and fresh evidence before it can be
selected. The fixtures intentionally contain aliases, stale observations,
blocked cells, and contradictory candidate answers.
