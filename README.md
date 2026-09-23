# Senior Backend Challenge: Routing and Evaluation Control Plane

## Brief

You are joining a team that operates an OpenAI-compatible gateway. The gateway
accepts requests from several tenants and chooses a provider cell for each
request. The team is adding an evaluation service that replays captured cases
against candidate routes before a release is promoted.

The repository is a small, intentionally imperfect TypeScript service. It has a
legacy HTTP app, a queue worker, a local persistence adapter, and deployment
fixtures. You may change the code, add tests, and add documents. Keep the
change narrow enough that another engineer could review it in one sitting.

## Timebox

Plan for **4 hours**. A complete submission may take up to **8 hours** if you
choose the extension. State how much time you spent and what you left out.

## Starting facts

The production team has these facts, but no single document is authoritative:

- A request names a tenant, public model, API surface, stream mode, region, and
  fallback consent.
- A route cell has a model declaration, surface capabilities, a credential
  scope, a health state, a last probe time, and a price observation.
- A provider may expose several vendor names while using one credential group.
- A canary release can run beside stable code. A migration can be applied while
  an older task definition is still serving traffic.
- Evaluation inputs include model output, a reference answer, a rubric, and
  free-form text that may contain instructions intended for the evaluator.

The `challenge/fixtures/` and `ops/` files are the complete input for this
exercise. Do not assume that a field named `balance`, `cost`, `status`, or
`stable` has one meaning everywhere.

## Work to complete

### 1. Request routing slice (required)

Create a small, deterministic route planner and tests. It should accept the
request and cell fixtures in `challenge/fixtures/routing-cases.json` and return
one of:

- a selected cell and an ordered attempt plan;
- an explicit refusal with a machine-readable reason; or
- a retryable outcome that does not make an outbound call.

Document the decisions you make about freshness, model aliases, credential
groups, fallback consent, request shape, and missing evidence. The planner must
not mutate the catalog or contact a provider. Keep tenant and credential scope
in the decision boundary.

Suggested location (you may choose another):

```text
apps/legacy-app/src/routing/route-planner.ts
apps/legacy-app/test/route-planner.spec.ts
```

### 2. Evaluation replay slice (required)

Build a local replay command that reads
`challenge/fixtures/evaluation-cases.json` and produces a JSON report. The
report must include a case id, per-criterion result, an overall decision, and a
reason when the evaluator abstains. It must be deterministic in offline mode.

The candidate output and the case's free-form text are untrusted input. Do not
let an instruction in an output change the rubric or read files from the
machine. If a reference or rubric is insufficient to decide, represent that
uncertainty instead of inventing a score.

Suggested location:

```text
scripts/evaluate-replay.ts
apps/legacy-app/test/evaluate-replay.spec.ts
```

### 3. Release and CI control (required)

Read both release snapshots in `ops/` and the generated artefact notes in
`challenge/fixtures/`. Write a short runbook that answers:

- which train may proceed and which must wait;
- what is safe to change while public canary traffic is non-zero;
- how you choose a rollback target when an older writer is still running;
- which checks gate a route/catalog change and an evaluation change;
- what evidence is recorded before promotion and after rollback.

Add a lightweight local check or script if it makes the rule executable. It is
fine to refuse promotion; do not simulate a successful deployment.

Suggested location:

```text
submission/release-runbook.md
scripts/check-release-plan.ts
```

### 4. Extension (optional)

Pick one narrow reliability improvement in the existing legacy/worker path.
Add a characterization test first, explain the boundary, and show how the
change behaves under duplicate delivery or a delayed worker. Do not rewrite
the application or introduce a second queue, ledger, or routing framework.

## Submission

Create these files (additional focused files are welcome):

```text
submission/decision-record.md
submission/release-runbook.md
submission/evaluation-report.json
submission/ai-notes.md
```

The decision record should state assumptions, source-of-truth choices, rejected
alternatives, and unresolved questions. The AI notes should list meaningful
prompts or generated patches, what you verified yourself, and any suggestion
you rejected or corrected. Do not paste credentials, private customer data, or
provider secrets.

Run the local checks before submitting:

```bash
pnpm install
pnpm test
pnpm run verify:challenge
```

Include the commands you ran and their exit status. If a dependency or service
is unavailable, record the exact limitation and the strongest offline evidence
you produced.

## Working agreement

- Keep public behavior unchanged outside the paths you explicitly document.
- Prefer a small pure function and contract tests over a framework.
- Treat generated files, release state, and observed provider evidence as
  separate facts.
- Never claim that a test, probe, or deployment ran when it did not.
- A partial submission with clear boundaries and reproducible evidence is more
  useful than a broad rewrite.
