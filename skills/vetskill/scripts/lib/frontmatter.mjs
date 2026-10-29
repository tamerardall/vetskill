import { MESSAGES, ALL_HIDDEN_CHARS } from './rules.mjs';

const unquote = (s) => {
  const t = s.trim();
  return t.length >= 2 && /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
};

// Split on commas/whitespace that sit outside parentheses, so "Bash(git add:*)" stays whole.
function splitTools(s) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map(unquote).filter(Boolean);
}

export function parseFrontmatter(text) {
  const result = { name: null, description: null, allowedTools: [] };
  const lines = text.replace(/^\u{FEFF}/u, '').split(/\r\n|\r|\n/);
  if (lines[0]?.trim() !== '---') return result;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return result;
  const body = lines.slice(1, end);

  for (let i = 0; i < body.length; i++) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(body[i]);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    // Collect indented continuation lines (block scalar body or YAML list).
    const cont = [];
    while (
      i + 1 < body.length &&
      (body[i + 1].trim() === '' || /^\s/.test(body[i + 1]) || (!value && /^- /.test(body[i + 1])))
    ) {
      cont.push(body[++i].trim());
    }

    if (key === 'name') {
      result.name = unquote(value) || null;
    } else if (key === 'description') {
      if (/^[>|][+-]?$/.test(value)) {
        const parts = cont.filter(Boolean);
        result.description = parts.join(value[0] === '>' ? ' ' : '\n') || null;
      } else {
        result.description = unquote(value) || null;
      }
    } else if (key === 'allowed-tools') {
      if (value) result.allowedTools = splitTools(value.replace(/^\[(.*)\]$/, '$1'));
      else result.allowedTools = cont.filter((l) => l.startsWith('-')).flatMap((l) => splitTools(l.slice(1)));
    }
  }
  return result;
}

export function scanFrontmatter(path, fm) {
  const broad = fm.allowedTools.some((t) => t === 'Bash' || t === '*');
  return broad
    ? [{ rule: 'SS-07', severity: 'info', file: path, line: null, message: MESSAGES['SS-07'] }]
    : [];
}

export function sanitizeDescription(s) {
  if (!s) return '';
  return s
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\t\n\r]/g, ' ')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .replace(ALL_HIDDEN_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
