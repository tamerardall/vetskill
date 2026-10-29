import { getJson, getText, HttpError } from './http.mjs';
import { MESSAGES, scanText } from './rules.mjs';
import { parseFrontmatter, scanFrontmatter, sanitizeDescription } from './frontmatter.mjs';

export const SOURCE_RE = /^(?!\.)[\w.-]+\/(?!\.)[\w.-]+$/;
const MAX_BYTES = 262144;
const MAX_FILES = 30;

// Tree paths are third-party text: keep only a conservative character set before they reach the JSON.
export function sanitizePath(p) {
  return String(p).replace(/[^A-Za-z0-9._/@+ -]/g, '?').slice(0, 200);
}

export function createTreeCache() {
  return new Map();
}

const ss08 = (key, file) => ({ rule: 'SS-08', severity: 'info', file, line: null, message: MESSAGES[`SS-08:${key}`] });
const isRateLimit = (e) => e instanceof HttpError && (e.status === 403 || e.status === 429);
const failKey = (e) => (isRateLimit(e) ? 'rate-limited' : 'fetch-failed');
const skillFailKey = (e) => (isRateLimit(e) ? 'rate-limited' : 'skill-fetch-failed');
const empty = (findings) => ({ description: '', scannedFiles: 0, findings });

function loadTree(source, { fetch, token, treeCache }) {
  if (!treeCache.has(source)) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = `https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`;
    treeCache.set(source, getJson(fetch, url, headers));
  }
  return treeCache.get(source);
}

const rawUrl = (source, path) =>
  `https://raw.githubusercontent.com/${source}/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`;
const byLengthThenPath = (a, b) => a.length - b.length || (a < b ? -1 : 1);
const skillDirs = (blobs) =>
  blobs.filter((b) => b.path.endsWith('/SKILL.md')).map((b) => ({ dir: b.path.slice(0, -'/SKILL.md'.length), size: b.size ?? 0 }));

// Returns { dir, skillMd } where skillMd is already-fetched SKILL.md text (or null), or null if no folder.
async function findSkillDir(blobs, skillId, source, fetch) {
  const all = skillDirs(blobs);
  const exact = all.map((d) => d.dir).filter((d) => d.split('/').pop() === skillId).sort(byLengthThenPath);
  if (exact.length) return { dir: exact[0], skillMd: null };

  const cands = all
    .filter((d) => d.size <= MAX_BYTES)
    .filter((d) => {
      const last = d.dir.split('/').pop();
      return last && skillId.includes(last);
    })
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
    .slice(0, 10);
  const matches = [];
  for (const c of cands) {
    try {
      const text = await getText(fetch, rawUrl(source, `${c.dir}/SKILL.md`));
      if (parseFrontmatter(text).name === skillId) matches.push({ dir: c.dir, skillMd: text });
    } catch {
      // treated as non-matching
    }
  }
  if (matches.length) {
    matches.sort((a, b) => byLengthThenPath(a.dir, b.dir));
    return matches[0];
  }
  // Root SKILL.md: only when it is the repo's only skill, or it names this skill.
  const root = blobs.find((b) => b.path === 'SKILL.md');
  if (!root) return null;
  if (all.length === 0) return { dir: '', skillMd: null };
  if ((root.size ?? 0) > MAX_BYTES) return null;
  try {
    const text = await getText(fetch, rawUrl(source, 'SKILL.md'));
    return parseFrontmatter(text).name === skillId ? { dir: '', skillMd: text } : null;
  } catch {
    return null;
  }
}

export async function vetCandidate(candidate, ctx) {
  const r = await vetUnsanitized(candidate, ctx);
  return { ...r, findings: r.findings.map((f) => ({ ...f, file: sanitizePath(f.file) })) };
}

async function vetUnsanitized(candidate, { fetch, token, treeCache }) {
  const { source, skillId } = candidate;
  if (typeof source !== 'string' || !SOURCE_RE.test(source)) {
    return empty([ss08('unsupported-source', '.')]);
  }

  let tree;
  let truncated = false;
  try {
    const res = await loadTree(source, { fetch, token, treeCache });
    tree = res.tree;
    truncated = res.truncated === true;
    if (!Array.isArray(tree)) throw new Error('bad tree');
  } catch (e) {
    return empty([ss08(skillFailKey(e), '.')]);
  }

  const blobs = tree.filter((t) => t.type === 'blob');
  const found = await findSkillDir(blobs, skillId, source, fetch);
  const truncFinding = truncated ? [ss08('file-limit', '.')] : [];
  if (found === null) return empty([ss08('folder-not-found', '.'), ...truncFinding]);

  const { dir, skillMd } = found;
  const prefix = dir ? `${dir}/` : '';
  const files = blobs
    .filter((b) => b.path.startsWith(prefix))
    .map((b) => ({ rel: b.path.slice(prefix.length), size: b.size ?? 0 }))
    .sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const findings = [...truncFinding];
  let description = '';
  let scannedFiles = 0;
  let queued = 0;
  let overLimit = false;

  for (const f of files) {
    if (queued >= MAX_FILES) {
      overLimit = true;
      continue;
    }
    queued++;
    if (f.size > MAX_BYTES) {
      findings.push(ss08('too-large', f.rel));
      continue;
    }
    let text;
    try {
      text = f.rel === 'SKILL.md' && skillMd !== null ? skillMd : await getText(fetch, rawUrl(source, prefix + f.rel));
    } catch (e) {
      findings.push(ss08(failKey(e), f.rel));
      continue;
    }
    if (text.slice(0, 8192).includes('\u0000')) {
      findings.push(ss08('binary', f.rel));
      continue;
    }
    scannedFiles++;
    findings.push(...scanText(f.rel, text));
    if (f.rel === 'SKILL.md') {
      const fm = parseFrontmatter(text);
      description = sanitizeDescription(fm.description);
      findings.push(...scanFrontmatter(f.rel, fm));
    }
  }
  if (overLimit) findings.push(ss08('file-limit', '.'));

  return { description, scannedFiles, findings };
}
