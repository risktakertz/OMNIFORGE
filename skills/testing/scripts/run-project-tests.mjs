#!/usr/bin/env node
/** Repo-owned skill entrypoint; workspace execution uses the shared governance boundary. */
import { readFileSync } from 'node:fs';
import { runProjectTests } from '../../../packages/verification/dist/index.js';
let result;
try {
  const job = JSON.parse(readFileSync(0, 'utf8'));
  if (typeof job.workspacePath !== 'string') throw new Error('input must contain workspacePath');
  result = runProjectTests(job.workspacePath);
} catch (error) {
  result = { status: 'failed', message: error.message };
}
const exitCode = result.status === 'passed' ? 0 : result.status === 'blocked' ? 2 : 1;
process.stdout.write(JSON.stringify({ skill: 'testing', ...result, exitCode }) + '\n');
process.exitCode = exitCode;
