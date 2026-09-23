import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

type Check = { readonly path: string; readonly description: string };
const required: readonly Check[] = [
  { path: 'README.md', description: 'candidate brief' },
  { path: 'challenge/fixtures/routing-cases.json', description: 'routing fixtures' },
  { path: 'challenge/fixtures/evaluation-cases.json', description: 'evaluation fixtures' },
  { path: 'ops/release-snapshot-a.json', description: 'release snapshot A' },
  { path: 'ops/release-snapshot-b.json', description: 'release snapshot B' },
];

async function main(): Promise<void> {
  let failed = false;
  for (const item of required) {
    try {
      await access(join(process.cwd(), item.path), constants.R_OK);
      console.log(`✅ ${item.description}: ${item.path}`);
    } catch {
      failed = true;
      console.log(`❌ ${item.description}: missing ${item.path}`);
    }
  }
  for (const path of ['challenge/fixtures/routing-cases.json', 'challenge/fixtures/evaluation-cases.json']) {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(process.cwd(), path), 'utf8'));
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      console.log(`✅ valid JSON: ${path}`);
    } catch (error) {
      failed = true;
      console.log(`❌ invalid JSON: ${path} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (failed) process.exitCode = 1;
}

void main();
