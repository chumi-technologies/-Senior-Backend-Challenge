# Private Submission Workflow

This document is for interview administrators. It prevents candidates from seeing prior submissions while preserving enough evidence for review.

## Why public PRs are not allowed

This challenge is intentionally take-home and AI-assisted. If submissions are opened as public pull requests, later candidates can read earlier answers, copy release plans, copy tests, and tune their AI prompts to match the expected solution. That invalidates the independence signal.

GitHub public forks are also public. A public challenge repository cannot provide private fork submissions.

## Recommended workflow

### Option A — Per-candidate private repository (preferred)

1. Create a new private repository for the candidate, for example `senior-backend-challenge-candidate-<id>`.
2. Copy this challenge repository into it, including starter files but not other candidates' submissions.
3. Invite only:
   - the candidate
   - the reviewer users or reviewer team
4. Ask the candidate to create a branch and PR inside that private repo.
5. After review, archive or delete the per-candidate repo according to company retention policy.

Benefits:

- Candidates cannot see each other's PRs.
- Reviewers still get GitHub PR diffs, commits, and comments.
- The candidate's commit order remains auditable.

### Option B — Candidate-owned private non-fork repo

1. Candidate creates a new private repository that is **not** a GitHub fork.
2. Candidate copies/imports the challenge starter code into that repo.
3. Candidate invites reviewer GitHub accounts or a reviewer team.
4. Candidate opens a PR or submits the branch URL inside that private repo.

Use this when the hiring team cannot create per-candidate repos quickly.

### Option C — Private archive fallback

Candidate sends a compressed repo archive containing:

- full source tree
- `.git` directory and commit history
- `solutions/` artifacts
- test evidence and command output

This is less convenient than PR review but avoids public answer leakage.

## Avoid this workflow

Do not ask candidates to open pull requests against the shared public repository.

Do not rely on making the current public repository private after public submissions exist. Existing public forks may remain public and detached from the upstream network.

Do not collect all candidates in the same shared upstream PR list while they still have read access to that upstream repository.

## Reviewer checklist

Before sending the challenge to a candidate:

- [ ] Confirm the submission target is private.
- [ ] Confirm only the candidate and reviewers have access.
- [ ] Confirm no previous candidate branches or PRs are visible.
- [ ] Confirm the instructions forbid public PRs/forks.
- [ ] Confirm the candidate is asked to preserve git history and commit order.

During review:

- [ ] Check commit order for spec-first behavior.
- [ ] Run `pnpm install --frozen-lockfile`.
- [ ] Run `pnpm run verify:submission`.
- [ ] Run build/test commands claimed by the candidate.
- [ ] Treat any public-source copying evidence as a follow-up interview topic rather than a standalone accusation.
