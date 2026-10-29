#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { run } from './lib/cli.mjs';

function getGhToken() {
  try {
    const t = execFileSync('gh', ['auth', 'token'], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return t || null;
  } catch {
    return null;
  }
}

const r = await run(process.argv.slice(2), { fetch, env: process.env, getGhToken });
process.stdout.write(r.stdout);
process.exitCode = r.exitCode;
