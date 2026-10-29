import { getJson, getText, HttpError } from './http.mjs';
import { MESSAGES, scanText } from './rules.mjs';
import { parseFrontmatter, scanFrontmatter, sanitizeDescription } from './frontmatter.mjs';

const SOURCE_RE = /^[\w.-]+\/[\w.-]+$/;
const MAX_BYTES = 262144;
const MAX_FILES = 30;

export function createTreeCache() {
  return new Map();
}

const ss08 = (key, file) => ({ rule: 'SS-08', severity: 'info', file, line: null, message: MESSAGES[`SS-08:${key}`] });
const failKey = (e) => (e instanceof HttpError && (e.status === 403 || e.status === 429) ? 'rate-limited' : 'fetch-failed');
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

function findSkillDir(blobs, skillId) {
  const dirs = blobs
    .filter((b) => b.path.endsWith('/SKILL.md'))
    .map((b) => b.path.slice(0, -'/SKILL.md'.length))
    .filter((d) => d.split('/').pop() === skillId)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  if (dirs.length) return dirs[0];
  return blobs.some((b) => b.path === 'SKILL.md') ? '' : null;
}

export async function vetCandidate(candidate, { fetch, token, treeCache }) {
  const { source, skillId } = candidate;
  if (typeof source !== 'string' || !SOURCE_RE.test(source)) {
    return empty([ss08('unsupported-source', '.')]);
  }

  let tree;
  try {
    tree = (await loadTree(source, { fetch, token, treeCache })).tree;
    if (!Array.isArray(tree)) throw new Error('bad tree');
  } catch (e) {
    return empty([ss08(failKey(e), '.')]);
  }

  const blobs = tree.filter((t) => t.type === 'blob');
  const dir = findSkillDir(blobs, skillId);
  if (dir === null) return empty([ss08('folder-not-found', '.')]);

  const prefix = dir ? `${dir}/` : '';
  const files = blobs
    .filter((b) => b.path.startsWith(prefix))
    .map((b) => ({ rel: b.path.slice(prefix.length), size: b.size ?? 0 }))
    .sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const findings = [];
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
    const url = `https://raw.githubusercontent.com/${source}/HEAD/${(prefix + f.rel).split('/').map(encodeURIComponent).join('/')}`;
    let text;
    try {
      text = await getText(fetch, url);
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
