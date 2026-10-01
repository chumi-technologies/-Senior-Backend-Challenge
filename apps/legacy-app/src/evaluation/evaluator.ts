export type Decision = 'pass' | 'fail' | 'abstain';

export interface Criterion {
  readonly id: string;
  readonly description: string;
}

export interface Rubric {
  readonly mustMention: readonly string[];
  readonly mustNotClaim: readonly string[];
}

export interface EvaluationCase {
  readonly id: string;
  readonly question: string;
  readonly reference: string | null;
  readonly rubric: Rubric;
  readonly candidateOutput: string;
}

export interface EvaluationFixture {
  readonly schemaVersion: number;
  readonly rubricVersion: string;
  readonly criteria: readonly Criterion[];
  readonly cases: readonly EvaluationCase[];
}

export interface CriterionResult {
  readonly criterion: string;
  readonly decision: Decision;
  readonly reason?: string;
}

export interface CaseResult {
  readonly caseId: string;
  readonly criteria: readonly CriterionResult[];
  readonly overall: Decision;
  readonly reason?: string;
}

export interface EvaluationReport {
  readonly rubricVersion: string;
  readonly cases: readonly CaseResult[];
}

function normalize(text: string): string {
  const collapsed = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${collapsed} `;
}

function phrasePresent(haystack: string, phrase: string): boolean {
  const needle = normalize(phrase).trim();
  if (needle === '') return false;
  return haystack.includes(` ${needle} `);
}

function missingTerms(candidate: string, terms: readonly string[]): string[] {
  const haystack = normalize(candidate);
  return terms.filter((term) => !phrasePresent(haystack, term));
}

function presentTerms(candidate: string, terms: readonly string[]): string[] {
  const haystack = normalize(candidate);
  return terms.filter((term) => phrasePresent(haystack, term));
}

function evaluateSafety(evalCase: EvaluationCase): CriterionResult {
  const violations = presentTerms(evalCase.candidateOutput, evalCase.rubric.mustNotClaim);
  if (violations.length > 0) {
    return { criterion: 'safety', decision: 'fail', reason: `prohibited claim present: ${violations.join(', ')}` };
  }
  return { criterion: 'safety', decision: 'pass' };
}

function evaluateEvidence(evalCase: EvaluationCase): CriterionResult {
  const required = evalCase.rubric.mustMention;
  if (required.length === 0) {
    return { criterion: 'evidence', decision: 'abstain', reason: 'no required evidence terms to verify' };
  }
  const missing = missingTerms(evalCase.candidateOutput, required);
  if (missing.length > 0) {
    return { criterion: 'evidence', decision: 'fail', reason: `missing required evidence: ${missing.join(', ')}` };
  }
  return { criterion: 'evidence', decision: 'pass' };
}

function evaluateCorrectness(evalCase: EvaluationCase): CriterionResult {
  if (evalCase.reference === null) {
    return { criterion: 'correctness', decision: 'abstain', reason: 'no reference answer to compare against' };
  }
  const required = evalCase.rubric.mustMention;
  if (required.length === 0) {
    return { criterion: 'correctness', decision: 'abstain', reason: 'rubric specifies no facts to verify' };
  }
  const missing = missingTerms(evalCase.candidateOutput, required);
  if (missing.length > 0) {
    return { criterion: 'correctness', decision: 'fail', reason: `reference facts not reflected: ${missing.join(', ')}` };
  }
  return { criterion: 'correctness', decision: 'pass' };
}

const EVALUATORS: Record<string, (evalCase: EvaluationCase) => CriterionResult> = {
  safety: evaluateSafety,
  evidence: evaluateEvidence,
  correctness: evaluateCorrectness,
};

function aggregate(results: readonly CriterionResult[]): Decision {
  if (results.some((r) => r.decision === 'fail')) return 'fail';
  if (results.some((r) => r.decision === 'abstain')) return 'abstain';
  return 'pass';
}

/**
 * Evaluates a single case against the given criteria. Pure and deterministic;
 * never executes or interprets candidate output as instructions.
 */
export function evaluateCase(
  evalCase: EvaluationCase,
  criteria: readonly Criterion[],
): CaseResult {
  const results = criteria.map<CriterionResult>((criterion) => {
    const evaluator = EVALUATORS[criterion.id];
    if (!evaluator) {
      return { criterion: criterion.id, decision: 'abstain', reason: 'no deterministic check defined for this criterion' };
    }
    return evaluator(evalCase);
  });

  const overall = aggregate(results);
  const base: CaseResult = { caseId: evalCase.id, criteria: results, overall };
  if (overall === 'abstain') {
    return { ...base, reason: 'insufficient evidence to decide (see per-criterion reasons)' };
  }
  return base;
}

/**
 * Evaluates every case in the fixture and produces a deterministic report.
 */
export function evaluateReport(fixture: EvaluationFixture): EvaluationReport {
  return {
    rubricVersion: fixture.rubricVersion,
    cases: fixture.cases.map((evalCase) => evaluateCase(evalCase, fixture.criteria)),
  };
}
