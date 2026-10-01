import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateReport, type EvaluationFixture } from '../apps/legacy-app/src/evaluation/evaluator';

const repoRoot = join(__dirname, '..');
const inputPath = join(repoRoot, 'challenge/fixtures/evaluation-cases.json');
const outputPath = join(repoRoot, 'submission/evaluation-report.json');

function main(): void {
  const fixture = JSON.parse(readFileSync(inputPath, 'utf8')) as EvaluationFixture;
  const report = evaluateReport(fixture);

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  for (const result of report.cases) {
    console.log(`${result.caseId}: ${result.overall}`);
  }
  console.log(`\nReport written to ${outputPath}`);
}

main();
