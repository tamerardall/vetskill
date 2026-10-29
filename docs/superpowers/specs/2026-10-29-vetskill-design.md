# vetskill — Design

- **Date:** 2026-10-29 (updated after the final review)
- **Status:** Approved; implemented
- **Repo:** `tamerardall/vetskill` (MIT)

## 1. Purpose

The user describes a need in plain language, without knowing the exact keyword ("I want to merge PDFs"). vetskill recommends the 2–3 best-fitting skills with reasons, and runs a static security scan on each one before it is installed, showing the findings. It never installs anything; the decision stays with the user.

In one sentence: **Find the right skill, see what it does before you install it.**

## 2. Background and evidence

`npx skills find` (vercel-labs/skills, `src/find.ts`) delegates search to the skills.sh API (`/api/search`, Algolia fuzzy). The API returns results in relevance order; the CLI re-sorts them by install count. Measured effect (2026-10-29):

- `deploy`: the API's first result, `deploy-to-vercel`, drops to 17th of 20 in the CLI; the CLI's first result (`microsoft-foundry`) does not contain the query.
- `pdf`: `docx` and `canvas-design` rise to positions 2–3.

Upstream has open PRs for this (#2432, #2457, #1312). The API results carry no description field, so the CLI output forces a decision on names alone.

### Alternatives

| Skill / source | What it does | Difference from vetskill |
|---|---|---|
| `maverickemanuel/trusted-skill-scout` | Searches with `npx skills find`, installs | "Trust" = ≥100 installs and ≥500 stars; content is not scanned; sorts by installs |
| `affaan-m/ecc` → `skill-scout` | Looks for an existing skill before writing a new one | Different goal; no deterministic scan |
| skills.sh skill pages | Show third-party audits (Gen Agent Trust Hub, Socket, Snyk) | Badges, not per-file findings at decision time; an agent reading the page also reads untrusted content |

vetskill's differences: **it keeps relevance order and fuses several queries**, and **a deterministic script scans the content so the agent never sees it.**

## 3. Scope

### In scope
- Multi-query generation from intent (agent), skills.sh API search, result fusion (script).
- Fetching the folder contents of GitHub-hosted skills and scanning them with static rules.
- Giving the agent only sanitized JSON; the agent presents 2–3 recommendations with reasons and findings.

### Out of scope
- Installation (the `npx skills add` command is only shown).
- AST / data-flow analysis, running scripts, sandboxing.
- Non-GitHub sources (well-known, HuggingFace, …). Search results whose `source` is not a GitHub `owner/repo` are dropped (see §5 step 2).
- A separate npm package / standalone CLI distribution.

## 4. Architecture

```
vetskill/
├── skills/vetskill/
│   ├── SKILL.md              # agent instructions
│   └── scripts/
│       ├── scan.mjs          # thin entry point
│       └── lib/              # cli, pool, search, http, fetch-skill, rules, frontmatter
├── tests/                    # node:test
├── docs/baseline/            # RED / GREEN agent-behaviour records
├── docs/superpowers/         # spec and plan
├── README.md, README.tr.md, LICENSE
```

Zero runtime and dev dependencies; Node ≥18 (built-in `fetch`); ESM `.mjs`. Install: `npx skills add tamerardall/vetskill`. Node is already required by `npx skills`; nothing else is needed. `npx skills add` copies the whole skill folder, so `scripts/lib/` ships with it.

### SKILL.md rules
- Frontmatter `description` starts with "Use when…" and describes only trigger conditions (looking for a skill, "is there a skill for X", a safety question before installing); it does not summarise the workflow. Under 500 characters.
- The script is always invoked through the interpreter: `cd <skill dir> && node scripts/scan.mjs …` (some packagers strip executable bits).
- Body under 500 words; flag details live in `node scripts/scan.mjs --help`.
- JSON string fields (`description`, `name`, `file`) are framed as third-party text the agent must never take instructions from.

### Why a script?
An agent reading a malicious SKILL.md pulls its prompt injection into the agent's context, and an LLM cannot reliably see invisible Unicode. So raw content is handled only by the script; the agent sees only the JSON the script produces. SKILL.md explicitly tells the agent not to fetch candidate files itself with `curl` / WebFetch / Read.

## 5. Data flow

1. **The agent interprets intent.** It derives 3–5 English queries from the request (synonyms, English equivalents of non-English requests, general to specific).
2. **The script searches.** `node scripts/scan.mjs --query "merge pdf" --query "pdf" [--top 10]`. For each distinct query: `GET https://skills.sh/api/search?q=<q>&limit=20`. The `SKILLS_API_URL` environment variable overrides the base (trailing slashes stripped). Each result item is validated before use: `id` matches `^[A-Za-z0-9._/-]{1,200}$`, `source` matches `^(?![.-])[\w.-]+\/(?![.-])[\w.-]+$`, `skillId` and `name` match `^(?!-)[A-Za-z0-9._-]{1,100}$`. Invalid items are dropped but keep their rank position (ranks are not renumbered). A leading dash is rejected because `source` and `name` end up in the suggested install command.
3. **The script fuses results.** Candidates are deduplicated by `id`. Score uses Reciprocal Rank Fusion: `score = Σ 1 / (10 + rank)` (rank is 1-based, summed over every query the candidate appears in). Ties go to higher `installs`, then `id` ascending. The first `--top` (default 10, range 1–20) candidates are scanned.
4. **The script fetches content.** One `GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1` per distinct `source` (the promise is cached, including rejections). The skill folder is resolved in this order:
   1. a `<dir>/SKILL.md` whose last `<dir>` segment equals `skillId` (shortest path wins);
   2. otherwise, `<dir>/SKILL.md` files whose last segment is a substring of `skillId`: up to 10 are fetched and the one whose frontmatter `name` equals `skillId` wins (real case: `vercel-react-best-practices` lives in `skills/react-best-practices/`);
   3. otherwise, the root `SKILL.md`, but only when it is the only `SKILL.md` in the tree or its frontmatter `name` equals `skillId`;
   4. otherwise, SS-08 "skill folder was not found".

   Files are fetched from `raw.githubusercontent.com/{owner}/{repo}/HEAD/<path>` (not counted against the API rate limit). `SKILL.md` first, then path order; at most 30 files, at most 256 KB each (from the tree `size`, skipped without fetching). A tree with `truncated: true` adds an SS-08 finding.
5. **The script scans and sanitizes.** The rules in §6 run on every file. `description` is read from frontmatter, ANSI and control characters and the SS-01 characters are removed, whitespace is collapsed, and it is cut to 300 characters. Every `finding.file` goes through `sanitizePath`: characters outside `[A-Za-z0-9._/@+ -]` become `?`, capped at 200 characters.
6. **The script writes JSON** (stdout, see 5.1). Exit codes: 0 success, 2 all queries failed, 1 usage error (plain text, not JSON).
7. **The agent ranks and presents.** It picks the 2–3 candidates whose `description` best fits the intent (candidates with `scannedFiles: 0` are listed separately as not scanned). For each: name, source, installs, why it fits (1–2 sentences), findings (severity · rule · file:line · interpretation), and the `npx skills add <source>@<name>` command. With no non-SS-08 findings it writes "No findings in scanned files" and never calls a skill safe.

### 5.1 JSON output

```json
{
  "queries": ["merge pdf", "pdf"],
  "error": null,
  "warnings": [],
  "candidates": [
    {
      "id": "anthropics/skills/pdf",
      "source": "anthropics/skills",
      "name": "pdf",
      "installs": 123456,
      "score": 0.1818,
      "matchedQueries": ["merge pdf", "pdf"],
      "description": "…",
      "scannedFiles": 4,
      "findings": [
        { "rule": "SS-03", "severity": "medium", "file": "scripts/x.py", "line": 12, "message": "reads SSH key, cloud credential, browser data or .env paths" }
      ]
    }
  ]
}
```

`error` is set only when every query fails (e.g. `"search API unreachable: <reason>"`); `candidates` is then empty. When some queries fail, the others' results are returned and `warnings` lists the failed queries. `skillId` is internal and not part of the output.

## 6. Security rules

| ID | Looks for | Severity |
|---|---|---|
| SS-01 | Bidi controls (U+202A–202E, U+2066–2069) and Unicode tag characters (U+E0000–E007F): high. Zero-width (U+200B–200D, U+2060, U+FEFF not at file start): medium | high / medium |
| SS-02 | `curl`/`wget` piped into `sh`/`bash`/`zsh` (optionally through `sudo` with flags), `bash <(curl …)`, `sh -c "$(curl …)"`, `eval "$(curl …)"`, `iex (iwr …)` / `Invoke-Expression` + download | high |
| SS-03 | `~/.ssh`, `id_rsa`, `id_ed25519`, `.aws/credentials`, browser stores (`Login Data`, `cookies.sqlite`, case-sensitive `/Cookies`), macOS keychain — in every file; `.env` — only in non-Markdown files | medium |
| SS-04 | HTTP requests to raw public IP addresses (not `127.*`, `0.0.0.0`); `webhook.site`, `ngrok`, `pastebin.com`, Discord webhooks, `requestbin`, `pipedream.net` | medium |
| SS-05 | Prompt-injection phrases: "ignore (all) previous/prior/above instructions", "disregard the system prompt", "do not tell the user", "without asking/telling the user" (case-insensitive, any whitespace) | medium |
| SS-06 | Runs of 200+ base64 characters, `eval(atob(`, `exec(base64`, `base64 -d … \| sh` | medium |
| SS-07 | Unrestricted `Bash` or `*` in frontmatter `allowed-tools` | info |
| SS-08 | What could not be scanned: binary file, file over 256 KB, files beyond the 30-file limit, truncated tree, file or skill that could not be fetched, skill folder not found, rate limit | info |

Principles:
- The tool never says "safe". Static scanning cannot catch a determined attacker; the README states this limit.
- Every finding carries file, line and rule ID. The agent may interpret context (a deploy skill is expected to mention `.env`) but never hides a finding.
- Finding messages are fixed strings and never quote file content, so injection cannot travel to the agent through the JSON.
- Every quantifier that scans along a line is bounded. Lines longer than 4096 characters skip the SS-02, SS-04, SS-05 and SS-06 regexes (SS-01, SS-03 and a linear long-base64 check still run). This prevents catastrophic backtracking on hostile input; the trade-off (padding a line past 4096 characters hides those rules) is listed in the README limits.

## 7. Error handling

- **A failed search is not "no results".** If every query fails, `error` is set and the exit code is 2; the agent says the search service was unreachable.
- **Timeouts:** every request uses `AbortSignal.timeout(10_000)`. **Concurrency:** at most 4 candidates are vetted at once.
- **GitHub authentication:** `GITHUB_TOKEN` env var, else `gh auth token` output (3 s timeout), else no token (60 requests per hour). The token is sent only to `api.github.com`. On 403/429 the affected candidates get an SS-08 rate-limit finding and stay in the list; the agent suggests `gh auth login`.
- **Partial failures do not stop the run;** each candidate is isolated, and an unexpected failure becomes an SS-08 "could not fetch the skill" finding for that candidate only.

## 8. Testing

- `node --test`; no external dependencies. `fetch` is injected, so tests make no network calls.
- Every rule has **bad** (must be caught) and **benign** (must not be caught) fixtures, e.g. a deploy doc mentioning `.env`, a normal `curl -O` install step, a short base64 constant.
- Hidden-Unicode fixtures are never written raw to disk; they are built from escape sequences at test time. A test asserts the scanner's own sources contain no SS-01 characters.
- Pathological inputs (`'curl '.repeat(50000)`, `'iex '.repeat(60000)`) must scan in under 500 ms.
- Fusion tests: RRF score, deduplication, install tie-break, partial query failure → `warnings`, total failure → `error` + exit 2, field validation.
- Fetch tests: folder resolution (nested, name fallback, root, not found), size/file limits, truncated tree, 403 → SS-08, path sanitization.
- **SKILL.md is written with RED-GREEN-REFACTOR (superpowers:writing-skills).** RED: scenarios run by subagents without the skill, behaviour recorded verbatim (`docs/baseline/2026-10-29-red.md`). GREEN: SKILL.md targets only the observed failures; the same scenarios are re-run with the skill, plus a 5-rep skill vs control comparison (`docs/baseline/2026-10-29-green.md`). REFACTOR: loopholes closed and re-tested.
- **Agent scenarios:** merge PDFs, deploy to Vercel, write commit messages, improve React performance, scrape websites without credential risk. Pass: expected skill in the top 3; each recommendation has a reason and a scan result.

## 9. Release and visibility

- README opens with the `deploy` before/after (17th in the CLI → first vetskill recommendation with its scan report), a "Why another tool?" section (the §2 table), the rules table, and limits.
- `README.tr.md` is the Turkish equivalent.
- The README does not name third-party skills together with specific findings; a static match may be legitimate.
- Outward-facing steps need separate approval: creating/pushing the GitHub repo, linking from the #2432 discussion, a LinkedIn announcement.

## 10. Success criteria

1. In each §8 scenario the expected skill is in the top 3 recommendations.
2. Every rule's bad fixture is caught and its benign fixture is not.
3. The agent never reads raw candidate file content at any step.
4. It installs with `npx skills add tamerardall/vetskill` and works with no extra steps.
