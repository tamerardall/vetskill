import { getJson } from './http.mjs';
import { SOURCE_RE } from './fetch-skill.mjs';

const RRF_K = 10;
const NAME_RE = /^(?!-)[A-Za-z0-9._-]{1,100}$/;
const ID_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const ok = (v, re) => typeof v === 'string' && re.test(v);
// skills.sh fields are third-party text and end up in an install command: accept only strict shapes.
const isSafe = (s) =>
  !!s && ok(s.id, ID_RE) && ok(s.source, SOURCE_RE) && ok(s.skillId, NAME_RE) && ok(s.name, NAME_RE);

export async function searchAll(queries, { fetch, apiBase }) {
  const unique = [...new Set(queries)];
  const byId = new Map();
  const warnings = [];
  const reasons = [];

  for (const q of unique) {
    const url = `${apiBase}/api/search?q=${encodeURIComponent(q)}&limit=20`;
    let skills;
    try {
      const data = await getJson(fetch, url);
      if (!data || !Array.isArray(data.skills)) throw new Error('unexpected response shape');
      skills = data.skills;
    } catch (e) {
      reasons.push(e.message);
      warnings.push(`query "${q}" failed: ${e.message}`);
      continue;
    }
    // A dropped item still occupies its rank position, so i is never renumbered.
    skills.forEach((s, i) => {
      if (!isSafe(s)) return;
      let c = byId.get(s.id);
      if (!c) {
        c = {
          id: s.id,
          source: s.source,
          skillId: s.skillId,
          name: s.name,
          installs: Number.isFinite(s.installs) ? s.installs : 0,
          score: 0,
          matchedQueries: [],
        };
        byId.set(s.id, c);
      }
      c.score += 1 / (RRF_K + i + 1);
      if (!c.matchedQueries.includes(q)) c.matchedQueries.push(q);
    });
  }

  if (unique.length > 0 && reasons.length === unique.length) {
    return { candidates: [], warnings: [], error: `search API unreachable: ${reasons[0]}` };
  }

  const candidates = [...byId.values()]
    .map((c) => ({ ...c, score: Math.round(c.score * 1e4) / 1e4 }))
    .sort((a, b) => b.score - a.score || b.installs - a.installs || a.id.localeCompare(b.id));
  return { candidates, warnings, error: null };
}
