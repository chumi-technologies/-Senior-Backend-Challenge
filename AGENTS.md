# Senior Backend Challenge Agent Instructions

This repository is an interview challenge. AI tools are allowed and expected, but the candidate is responsible for directing, correcting, and validating AI output.

## Mandatory AI collaboration log

Every AI assistant working in this repository must append a short entry to:

`solutions/ai-collaboration-log.md`

after each meaningful step. Do not wait for a separate reminder. Keep the log updated automatically.

Each entry must include:

- timestamp
- user request or summarized prompt
- files inspected
- commands run
- assumptions made
- recommendation given
- whether the human accepted, rejected, or corrected the recommendation
- risks or unresolved questions

Use this format:

```md
## 2026-xx-xx HH:mm — Step title

### User prompt / intent
...

### AI action
...

### Files inspected
- ...

### Commands run
- ...

### Assumptions
- ...

### Human corrections / decisions
- ...

### Remaining risks
- ...
```

## Do not silently implement

For medium or high-risk backend, billing, routing, release, canary, failover, usage, ledger, or customer-facing contract changes:

1. First produce a short system understanding note.
2. Define the source of truth.
3. Identify ambiguous business terms.
4. Explain blast radius.
5. Only then modify code.

If the human corrects a semantic misunderstanding, record that correction in the AI collaboration log.

## Ambiguous terminology warning

This challenge intentionally contains overloaded terms. Do not assume these mean the same thing across files or Slack-style tickets:

- balance
- account
- usage
- cost
- total cost
- actual cost
- official cost
- credit
- prepaid
- stable
- production
- canary
- customer key
- provider key
- route
- fallback

Before changing code, define the exact meaning in the current context and record it in `solutions/decision-log.md`.

## Release safety rule

If public canary traffic is non-zero, do not update the canary service directly.

Before any release action, inspect and record:

- stable image
- canary image
- stable traffic weight
- canary traffic weight
- whether canary has public traffic
- rollback target

Append the decision to `solutions/release-command-log.md`.

## Submission expectation

The final repository must include:

- `solutions/spec.md`
- `solutions/ai-collaboration-log.md`
- `solutions/decision-log.md`
- `solutions/release-command-log.md`
- `solutions/part1-billing-semantics.md`
- `solutions/part2-release-interruption.md`
- `solutions/refactor-plan.md`
- `solutions/scale-plan.md`
- test evidence
- command output evidence

Run `pnpm run verify:submission` before submitting.
