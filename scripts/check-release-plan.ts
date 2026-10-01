import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateRelease,
  type PublishedArtifact,
  type ReleaseSnapshot,
} from '../apps/legacy-app/src/release/release-gate';

const repoRoot = join(__dirname, '..');
const artifactPath = join(repoRoot, 'challenge/fixtures/generated-artifacts.json');
const snapshotFiles = ['ops/release-snapshot-a.json', 'ops/release-snapshot-b.json'];

function main(): void {
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as PublishedArtifact;

  let anyWait = false;

  for (const file of snapshotFiles) {
    const snapshot = JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as ReleaseSnapshot;
    const result = evaluateRelease(snapshot, artifact);
    const verdict = result.decision === 'proceed' ? 'PROCEED' : 'WAIT';

    console.log(`\nTrain ${result.train}: ${verdict}`);
    for (const gate of result.gates) {
      console.log(`  ${gate.passed ? '✓' : '✗'} ${gate.gate} — ${gate.detail}`);
    }

    if (result.decision === 'wait') {
      anyWait = true;
      console.log(`  blocked by: ${result.failingGates.join(', ')}`);
    }
  }

  if (anyWait) {
    console.log('\nResult: at least one train must WAIT. Promotion gate failed.');
    process.exit(1);
  }

  console.log('\nResult: all trains may PROCEED.');
  process.exit(0);
}

main();
