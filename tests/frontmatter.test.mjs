import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, scanFrontmatter, sanitizeDescription } from '../skills/vetskill/scripts/lib/frontmatter.mjs';

const doc = (body) => `---\n${body}\n---\n# Body\n`;

test('parses single-line description', () => {
  const fm = parseFrontmatter(doc('name: demo\ndescription: "Does a thing"'));
  assert.equal(fm.name, 'demo');
  assert.equal(fm.description, 'Does a thing');
});
test('parses folded block description', () =>
  assert.equal(parseFrontmatter(doc('description: >\n  Use when\n  x')).description, 'Use when x'));
test('parses allowed-tools list', () =>
  assert.deepEqual(parseFrontmatter(doc('allowed-tools:\n  - Read\n  - Bash')).allowedTools, ['Read', 'Bash']));
test('parses allowed-tools string', () =>
  assert.deepEqual(parseFrontmatter(doc('allowed-tools: Read, Bash(git:*)')).allowedTools, ['Read', 'Bash(git:*)']));
test('returns nulls without frontmatter', () =>
  assert.deepEqual(parseFrontmatter('# just markdown'), { name: null, description: null, allowedTools: [] }));

const fmWith = (tools) => ({ name: 'n', description: 'd', allowedTools: tools });
test('SS-07 flags bare Bash', () => {
  const f = scanFrontmatter('SKILL.md', fmWith(['Read', 'Bash']));
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'SS-07');
  assert.equal(f[0].severity, 'info');
});
test('SS-07 flags *', () => {
  const f = scanFrontmatter('SKILL.md', fmWith(['*']));
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'SS-07');
});
test('SS-07 ignores scoped Bash(git:*)', () =>
  assert.deepEqual(scanFrontmatter('SKILL.md', fmWith(['Bash(git:*)'])), []));

test('sanitizeDescription strips ANSI and controls', () =>
  assert.equal(sanitizeDescription('\x1b[31mRed\x1b[0m\n\tline'), 'Red line'));
test('sanitizeDescription strips hidden unicode', () =>
  assert.equal(sanitizeDescription('a' + String.fromCodePoint(0x202e, 0xe0041, 0x200b) + 'b\x85c'), 'abc'));
test('sanitizeDescription cuts to 300', () => assert.equal(sanitizeDescription('x'.repeat(500)).length, 300));
test('sanitizeDescription(null)', () => assert.equal(sanitizeDescription(null), ''));
