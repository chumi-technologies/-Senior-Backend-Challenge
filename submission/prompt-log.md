# Full Prompt Log

Every user prompt from the Senior Backend Challenge, deduplicated and
in chronological order. **25 unique prompts** across 2 sessions.

---

## Prompt 1

Read the README and inspect the repo structure, scripts, fixtures etc. Do not modify anything yet. I want you to help me understand the requirements, and what I need to do.

---

## Prompt 2

Now create a concise design doc for the 3 required tasks.

For each task include:

- goal
- inputs / outputs
- key design decisions I need to make
- implementation approach
- tests / verification
- deliverables

Then add a phased TODO checklist using markdown checkboxes so we can track progress as we work.

Keep it practical and concise.
Do not modify code yet.

Update the design doc checklist based on what we just completed.
Do not mark anything complete unless we actually verified it.

---

## Prompt 3

Can you revise the design doc before we start coding?

The structure looks good, but I don't want assumptions or your suggested choices to look like confirmed requirements.

A few changes:

1. For each design decision, label it as:
   - REQUIRED — clearly stated in the README / CONTRACT / fixtures
   - OPEN — something I still need to decide
   - DECIDED — only if I already explicitly made that decision

2. Don't mark anything as DECIDED unless I actually chose it in our conversation.

3. For the fixture results, separate what is clearly required by the challenge from anything that depends on an open design decision.

4. Please revisit e-005. Correctness can abstain while another criterion can still fail, so don't decide the overall aggregation rule yet unless it's explicitly defined somewhere.

5. For new file locations, inspect the existing repo structure, package scripts, tsconfig and test conventions first. If you're suggesting a location, mark it as tentative for now.

6. Update the TODO flow so each phase follows roughly:
   understand evidence → make decision → document it → test → implement → verify

7. Keep the doc short and practical. I want it to be something we can actually use to track the work, not a long explanation.

---

## Prompt 4

[IDE selection from design-doc.md]

Looks good. Just make these final corrections:

1. The release check/script is required by the challenge, not optional. What remains OPEN is its exact blocking rules and output/exit-code behavior.

2. For model matching, avoid assuming "alias" semantics. State the required behavior as matching against the model names declared by the cell, and leave any normalization/equivalence policy OPEN if needed.

3. Treat filtering order as an implementation detail unless it changes observable behavior.

---

## Prompt 5

Create a new branch and push changes to github

---

## Prompt 6

i forked the repo. can you change the origin to https://github.com/lucaspan/-Senior-Backend-Challenge/tree/codex/revamped-senior-challenge-20260923?

---

## Prompt 7

change the branch name to just lucas-challenge, all commits will go to here and will create the final pr including everything

---

## Prompt 8

Do phase 0

---

## Prompt 9

Let's start Phase 1.

Before writing code, walk me through r-001 only:

- what the request is asking for
- which cells are candidates
- why each cell is eligible or ineligible
- which remaining behavior depends on one of my OPEN decisions

Keep it concise. Do not implement yet.

---

## Prompt 10

- Inject `now` as a function argument.
- A stale probe makes a cell temporarily ineligible.
- A stale price also makes a cell temporarily ineligible.
- Lower numeric priority means higher routing priority.
- Keep only the highest-priority cell from each credential group.
- If fallbackConsent=true, build the attempt plan from one cell per independent credential group, ordered by priority.
- If fallbackConsent=false, return only the primary cell.
- Return `refused` for structural incompatibility such as model/scope/region/surface/thinkingShape mismatch.
- Return `retryable` when the request could otherwise be served but all matching cells are temporarily unavailable because of health/freshness.

Do these look good? Any suggestions?

---

## Prompt 11

1. health treated as temporary - yes
2. If the request has no thinkingShape, treat that as no shape constraint.
3. Check README, CONTRACT.md and the fixtures for any explicit reference timestamp. If none exists, show me the available timestamp evidence and we'll choose one deliberately.

---

## Prompt 12

Lock in and record in our design. Update the phase 1 decisions then move on writing tests

---

## Prompt 13

Proceed

---

## Prompt 14

Commit and push Phase 1 first

---

## Prompt 15

[IDE selection from design-doc.md]

I want to keep the evaluator simple and deterministic without NLP.

- case-insensitive matching exact phrase/token matching after basic whitespace/punctuation normalization.
- No stemming and no semantic similarity/inference. (maybe next phase)
- mustNotClaim violations map to safety.
- mustMention/reference-based checks map to correctness/evidence as supported by the fixture structure.
- Overall aggregation: fail if any criterion fails otherwise abstain if any criterion abstains; otherwise pass.

---

## Prompt 16

1. Empty mustMention with insufficient reference/evidence -> abstain
2. Correctness is allowed to PASS when the deterministic rubric checks pass

---

## Prompt 17

Implement the evaluator

---

## Prompt 18

Commit phase 2

---

## Prompt 19

[IDE selection from design-doc.md]

Start phase 3, what are the decisions i need to make

---

## Prompt 20

1. all four are hard blockers
2. While public canary traffic is non-zero, allow only backward-compatible changes that both stable and canary can serve.
3. rollback target must be non-null and its version must be among the active writerVersions
4. Keep separate gates for route/catalog changes and evaluation changes.
5. Accept recommendation
6. PROCEED => exit 0; WAIT / blocked => exit 1; print the failing gates clearly; this is CI gate, so nonzero for any WAIT

---

## Prompt 21

can you create contribution pr against https://github.com/chumi-technologies/-Senior-Backend-Challenge/tree/codex/revamped-senior-challenge-20260923

---

## Prompt 22

download every single prompt and store to a file and upload
