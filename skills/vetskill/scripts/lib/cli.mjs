import { searchAll } from './search.mjs';
import { vetCandidate, createTreeCache } from './fetch-skill.mjs';
import { mapLimit } from './pool.mjs';
import { MESSAGES } from './rules.mjs';

const USAGE = `Usage: node scan.mjs --query <q> [--query <q> ...] [--top <n>]

Searches skills.sh, scans the top candidates' files and prints JSON.

  --query <q>  search query (repeatable, at least one non-empty required)
  --top <n>    number of candidates to vet, integer 1-20 (default 10)
  --help       show this help

Output is JSON: { queries, error, warnings, candidates }.
Exit codes: 0 ok, 1 usage error, 2 all queries failed.
`;

const usageError = (msg) => ({ stdout: `Error: ${msg}\n\n${USAGE}`, exitCode: 1 });

function parseArgs(argv) {
  const queries = [];
  let top = 10;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help') return { help: true };
    if (a === '--query') {
      if (i + 1 >= argv.length) return { error: '--query requires a value' };
      queries.push(argv[++i]);
    } else if (a === '--top') {
      const v = argv[++i];
      if (v === undefined || !/^\d+$/.test(v) || +v < 1 || +v > 20) return { error: '--top must be an integer 1-20' };
      top = +v;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  const clean = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  if (!clean.length) return { error: 'at least one non-empty --query is required' };
  return { queries: clean, top };
}

const FETCH_FAILED = () => ({
  description: '',
  scannedFiles: 0,
  findings: [{ rule: 'SS-08', severity: 'info', file: '.', line: null, message: MESSAGES['SS-08:fetch-failed'] }],
});

function safeToken(env, getGhToken) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try {
    return getGhToken() || null;
  } catch {
    return null;
  }
}

export async function run(argv, { fetch, env, getGhToken, vet = vetCandidate }) {
  const p = parseArgs(argv);
  if (p.help) return { stdout: USAGE, exitCode: 0 };
  if (p.error) return usageError(p.error);

  const apiBase = (env.SKILLS_API_URL || 'https://skills.sh').replace(/\/+$/, '');
  const found = await searchAll(p.queries, { fetch, apiBase });
  let candidates = [];
  if (!found.error) {
    const token = safeToken(env, getGhToken);
    const treeCache = createTreeCache();
    const top = found.candidates.slice(0, p.top);
    const vetted = await mapLimit(top, 4, (c) => Promise.resolve().then(() => vet(c, { fetch, token, treeCache })).catch(FETCH_FAILED));
    candidates = top.map((c, i) => ({
      id: c.id,
      source: c.source,
      name: c.name,
      installs: c.installs,
      score: c.score,
      matchedQueries: c.matchedQueries,
      description: vetted[i].description,
      scannedFiles: vetted[i].scannedFiles,
      findings: vetted[i].findings,
    }));
  }
  const out = { queries: p.queries, error: found.error ?? null, warnings: found.warnings, candidates };
  return { stdout: JSON.stringify(out, null, 2) + '\n', exitCode: found.error ? 2 : 0 };
}
