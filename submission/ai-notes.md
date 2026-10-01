# AI Notes

How AI (Claude Code) was used on this challenge, what I verified myself, and
where I corrected or rejected its suggestions. The intent is a reproducible,
honest record — not a transcript.

## Workflow

Each slice followed the same loop, which I enforced explicitly in my prompts:
**understand the evidence → decide the open questions myself → document the
decision → write tests (red) → implement → verify (green) → commit.** AI drafted
code and docs; I owned every decision and checked each result against the
fixtures and the test runner before accepting it.

I made the design doc a living tracking artifact first, with a
**REQUIRED / OPEN / DECIDED** legend, so that AI's assumptions could never
masquerade as challenge requirements (see corrections below).

## Prompts that shaped the work (in order)

1. **Read-only recon.** "Read the README and inspect the repo structure,
   scripts, fixtures etc. Do not modify anything yet." Used to understand the
   contract and build the design doc.
2. **Design doc + phased TODO**, concise, no code yet, nothing marked complete
   unless verified.
3. **Revise the design doc**: label every decision REQUIRED/OPEN/DECIDED; never
   DECIDED unless I chose it; separate challenge-required fixture outcomes from
   open-decision-dependent ones; inspect real repo conventions before proposing
   file locations and mark them tentative; TODO flow =
   "understand → decide → document → test → implement → verify".
4. **Final design-doc corrections**: the release check script is *required* (only
   its blocking rules / exit code were open); model matching must **not** assume
   alias semantics; filtering order is an implementation detail unless it changes
   observable behavior.
5. **Routing, decision-first.** Before any code I had AI walk me through **r-001
   only** — the request, candidate cells, why each is eligible/ineligible, and
   which behavior depended on an open decision — with no implementation. I then
   handed AI the full decision list (injected clock, stale probe/price =
   temporarily ineligible, lower `priority` = higher, credential-group dedup,
   fallback ordering, refused vs. retryable).
6. **Reference-timestamp investigation.** I asked AI to search README,
   CONTRACT.md, and the fixtures for an explicit "current time." It found none
   and listed the available timestamp evidence; I then deliberately chose
   `now = 2026-09-23T19:55:00Z` (the latest observation, so nothing is
   future-dated).
7. **Evaluator decisions**: deterministic matching only (no NLP), the
   criterion→signal mapping, and `fail > abstain > pass` aggregation; plus two
   clarifications I supplied — empty `mustMention`/insufficient reference →
   abstain, and correctness is *allowed to pass* when deterministic checks pass.
8. **Release decisions**: four hard-blocker gate, backward-compatible-only
   changes during public canary, rollback version ∈ `writerVersions`, separate
   route/catalog vs. evaluation gate checklists, and the exit-code contract.

## Generated artifacts (AI-drafted, I reviewed)

- `route-planner.ts` + 24 contract tests against `routing-cases.json`.
- `evaluator.ts` + 20 tests, `evaluate-replay.ts` CLI, `evaluation-report.json`.
- `release-gate.ts` + 16 tests, `check-release-plan.ts` CLI, `release-runbook.md`.
- Design doc, decision record, these notes.

## What I verified myself

- `pnpm test` → **exit 0**, 61/61 (routing 24, evaluation 20, release 16,
  baseline 1).
- `pnpm run verify:challenge` → **exit 0**, all checks pass.
- `pnpm run check:release` → **exit 1**, 19s PROCEED / 19t WAIT. The non-zero
  exit is the correct refusal (19t legitimately waits), not a failure.
- Each suite was confirmed **red on the stub before implementation**, so the
  tests exercise real logic rather than tautologies.
- Checked every fixture outcome by hand against the snapshots/cases; the outcome
  tables in the design doc and decision record are mine.
- **Routing insight I confirmed independently:** the fixture deliberately makes
  the BYOK cells unservable at any valid `now` — their probes are at 19:30, 25
  min before the latest observation, while the probe window is 15 min — which
  forces r-003/r-004 to be `retryable`. I verified this was intended, not a bug
  to route around.

## Suggestions I rejected or corrected

- **Decisions dressed up as requirements.** AI's first design doc presented its
  own assumptions as if stated in the challenge. I required the
  REQUIRED/OPEN/DECIDED legend and that nothing be DECIDED unless I chose it.
- **Premature aggregation "fix" (e-005).** AI leaned toward changing aggregation
  so a criterion couldn't abstain while another failed. I rejected that:
  correctness and evidence may abstain while safety fails, and overall still
  fails. Kept the layered `fail > abstain > pass` rule.
- **Model "alias" semantics.** AI assumed alias/normalization. I removed it —
  matching is exact membership against the names a cell declares; any
  normalization stays an explicitly open future concern.
- **Release check framed as optional.** AI initially treated the check script as
  optional. It is required; only its blocking rules and exit-code behavior were
  open, which I then decided (PROCEED → 0, any WAIT → 1).
- **Semantic / stemmed matching in the evaluator.** Rejected for this phase to
  keep evaluation deterministic and auditable ("billed" ≠ "billing",
  "success" ≠ "successful answer"). Flagged as possible later work behind an
  explicit online flag.
- **Filtering order presented as a decision.** I downgraded it to an
  implementation detail, since it doesn't change observable behavior.

## Operational note (git), honestly recorded

Pushing over HTTPS failed with "Password authentication is not supported," and
after I forked the repo an HTTPS push to the fork returned 403. With AI's help I
diagnosed a stale osxkeychain credential, verified SSH access
(`ssh -T git@github.com` → "Hi lucaspan!"), switched the remote to SSH, and the
push succeeded. No credentials or tokens were pasted into the repo or these
notes.

## Boundaries

All work is deterministic and offline — no network calls, no credentials, no
provider contact, and no claim that any probe or deployment actually ran. The
planner does not mutate the catalog; the evaluator never executes or interprets
candidate output (the prompt-injection text in e-001 is ignored by design).

## Commands run (final)

```bash
pnpm install               # exit 0
pnpm test                  # exit 0 — 61/61
pnpm run verify:challenge  # exit 0
pnpm run evaluate:replay   # exit 0 — regenerates evaluation-report.json
pnpm run check:release     # exit 1 — 19s PROCEED, 19t WAIT (expected)
```
