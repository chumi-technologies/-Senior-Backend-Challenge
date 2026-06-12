# Surgical Refactor Plan

> Complete before touching messy hot-path code.

## 1. Target

- File:
- Function / class:
- Why this is in scope:

## 2. Current responsibility leak

Describe the smallest concrete responsibility leak. Do not propose a broad rewrite.

## 3. Characterization test

- Existing behavior to lock:
- Test file:
- Expected failure mode if behavior changes accidentally:

## 4. Extraction boundary

- Extracted helper / function:
- Inputs:
- Outputs:
- Side effects:
- Why this is the smallest safe boundary:

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| | |

## 6. Verification

- Tests run:
- Command output:
- Remaining risk:
