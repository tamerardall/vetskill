import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../skills/vetskill/scripts/lib/cli.mjs';
import { mapLimit } from '../skills/vetskill/scripts/lib/pool.mjs';

const sk = (n) => ({ id: `o/r/s${n}`, source: 'o/r', skillId: `s${n}`, name: `s${n}`, installs: 100 - n });
const CLEAN = '---\nname: x\ndescription: Does things\n---\nHello\n';

function fakeFetch({ search = {}, calls = [] } = {}) {
  return async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, headers: opts.headers ?? {} });
    if (u.includes('/api/search')) {
      const q = new URL(u).searchParams.get('q');
      const r = search[q];
      if (r === undefined || r instanceof Error) throw r ?? new Error('fail');
      return new Response(JSON.stringify({ skills: r }), { status: 200 });
    }
    if (u.startsWith('https://api.github.com/')) {
      return new Response(JSON.stringify({ tree: [{ path: 'SKILL.md', type: 'blob', size: 10 }] }), { status: 200 });
    }
    if (u.startsWith('https://raw.githubusercontent.com/')) return new Response(CLEAN, { status: 200 });
    throw new Error('no route ' + u);
  };
}
const go = (argv, o = {}) => run(argv, { fetch: o.fetch ?? fakeFetch({ search: { q: [sk(1), sk(2), sk(3), sk(4), sk(5)] } }), env: o.env ?? {}, getGhToken: o.getGhToken ?? (() => null) });

test('--help prints usage and exits 0', async () => {
  const r = await go(['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /--query/);
  assert.match(r.stdout, /--top/);
  assert.match(r.stdout, /JSON/);
});
test('usage errors exit 1', async () => {
  for (const argv of [[], ['--query', '  '], ['--query'], ['--query', 'q', '--top', '0'], ['--query', 'q', '--top', '21'], ['--query', 'q', '--top', 'x'], ['--query', 'q', '--bogus']]) {
    const r = await go(argv);
    assert.equal(r.exitCode, 1, JSON.stringify(argv));
    assert.match(r.stdout, /--query/);
  }
});
test('outputs spec JSON shape', async () => {
  const r = await go(['--query', 'q', '--query', 'q', '--query', ' ']);
  assert.equal(r.exitCode, 0);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(o), ['queries', 'error', 'warnings', 'candidates']);
  assert.deepEqual(o.queries, ['q']);
  assert.deepEqual(Object.keys(o.candidates[0]), ['id', 'source', 'name', 'installs', 'score', 'matchedQueries', 'description', 'scannedFiles', 'findings']);
  assert.equal(o.candidates[0].description, 'Does things');
});
test('only top N candidates are vetted', async () => {
  const r = await go(['--query', 'q', '--top', '2']);
  assert.equal(JSON.parse(r.stdout).candidates.length, 2);
  const d = await go(['--query', 'q']);
  assert.equal(JSON.parse(d.stdout).candidates.length, 5);
});
test('exit 2 when all queries fail', async () => {
  const r = await go(['--query', 'bad'], { fetch: fakeFetch() });
  assert.equal(r.exitCode, 2);
  const o = JSON.parse(r.stdout);
  assert.ok(o.error);
  assert.deepEqual(o.candidates, []);
});
test('trailing slash on SKILLS_API_URL is stripped', async () => {
  const calls = [];
  await go(['--query', 'q'], { fetch: fakeFetch({ search: { q: [sk(1)] }, calls }), env: { SKILLS_API_URL: 'https://x.test//' } });
  assert.ok(calls.some((c) => c.url.startsWith('https://x.test/api/search')));
});
test('token from GITHUB_TOKEN wins over gh', async () => {
  const calls = [];
  let ghCalled = false;
  await go(['--query', 'q', '--top', '1'], { fetch: fakeFetch({ search: { q: [sk(1)] }, calls }), env: { GITHUB_TOKEN: 'envtok' }, getGhToken: () => { ghCalled = true; return 'ghtok'; } });
  const gh = calls.find((c) => c.url.startsWith('https://api.github.com/'));
  assert.match(JSON.stringify(gh.headers), /envtok/);
  assert.equal(ghCalled, false);
});
test('falls back to getGhToken', async () => {
  const calls = [];
  await go(['--query', 'q', '--top', '1'], { fetch: fakeFetch({ search: { q: [sk(1)] }, calls }), env: {}, getGhToken: () => 'ghtok' });
  const gh = calls.find((c) => c.url.startsWith('https://api.github.com/'));
  assert.match(JSON.stringify(gh.headers), /ghtok/);
});
test("output contains no 'safe' verdict", async () => {
  const r = await go(['--query', 'q']);
  assert.doesNotMatch(r.stdout, /\bsafe\b/i);
});
test('mapLimit never exceeds limit', async () => {
  let cur = 0, max = 0;
  await mapLimit([...Array(10).keys()], 3, async () => {
    cur++; max = Math.max(max, cur);
    await new Promise((r) => setTimeout(r, 5));
    cur--;
  });
  assert.equal(max, 3);
});
test('mapLimit preserves order', async () => {
  const out = await mapLimit([30, 1, 15, 2], 2, async (n) => { await new Promise((r) => setTimeout(r, n)); return n * 2; });
  assert.deepEqual(out, [60, 2, 30, 4]);
});
test('a throwing vetCandidate yields SS-08 for that candidate only', async () => {
  const vet = async (c) => {
    if (c.skillId === 's2') throw new Error('boom');
    return { description: 'd', scannedFiles: 1, findings: [] };
  };
  const r = await run(['--query', 'q', '--top', '3'], { fetch: fakeFetch({ search: { q: [sk(1), sk(2), sk(3)] } }), env: {}, getGhToken: () => null, vet });
  assert.equal(r.exitCode, 0);
  const cs = JSON.parse(r.stdout).candidates;
  assert.equal(cs.length, 3);
  assert.deepEqual(cs[1].findings.map((f) => f.rule), ['SS-08']);
  assert.equal(cs[1].scannedFiles, 0);
  assert.deepEqual(Object.keys(cs[1]), Object.keys(cs[0]));
  assert.equal(cs[0].scannedFiles, 1);
  assert.equal(cs[2].scannedFiles, 1);
});
test('throwing getGhToken is treated as no token', async () => {
  const calls = [];
  const r = await go(['--query', 'q', '--top', '1'], { fetch: fakeFetch({ search: { q: [sk(1)] }, calls }), env: {}, getGhToken: () => { throw new Error('x'); } });
  assert.equal(r.exitCode, 0);
  assert.doesNotMatch(JSON.stringify(calls.find((c) => c.url.startsWith('https://api.github.com/')).headers), /Bearer|token/i);
});
test('candidates with unsafe search fields never reach the output', async () => {
  const bad = { ...sk(9), name: 'x; rm -rf ~ #' };
  const r = await go(['--query', 'q'], { fetch: fakeFetch({ search: { q: [bad, sk(1)] } }) });
  assert.doesNotMatch(r.stdout, /rm -rf/);
  assert.deepEqual(JSON.parse(r.stdout).candidates.map((c) => c.name), ['s1']);
});
