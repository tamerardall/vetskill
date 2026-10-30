# vetskill

**English** · [Türkçe](README.tr.md)

Find the right skill, see what it does before you install it.

vetskill is an agent skill. Describe what you need in plain words, in any language ("I want to merge PDF files"). It searches [skills.sh](https://skills.sh), ranks candidates by how well they fit your intent, and runs a static scan over each candidate's files. You get 1–3 recommendations, each with its findings and the install command. vetskill never installs anything. You decide, and you run the command yourself.

## Before / after

Query: `deploy` (measured 2026-10-29).

**`npx skills find deploy`:** `deploy-to-vercel` is the skills.sh API's first result, but it comes in at **#17 of 20**. The CLI re-sorts the API's relevance order by install count, so its first result (`microsoft-foundry`) does not even contain the word "deploy". Upstream discussion: [vercel-labs/skills#2432](https://github.com/vercel-labs/skills/pull/2432).

**vetskill:** `deploy-to-vercel` is the first recommendation. Trimmed excerpt of `node skills/vetskill/scripts/scan.mjs --query deploy --query "deploy vercel" --top 5`:

```json
{
  "queries": ["deploy", "deploy vercel"],
  "error": null,
  "warnings": [],
  "candidates": [
    {
      "id": "vercel-labs/agent-skills/deploy-to-vercel",
      "installs": 174829,
      "score": 0.1818,
      "matchedQueries": ["deploy", "deploy vercel"],
      "description": "Deploy applications and websites to Vercel. Use when the user requests deployment actions like \"deploy my app\", …",
      "scannedFiles": 1,
      "findings": []
    },
    {
      "id": "vercel-labs/agent-skills/vercel-cli-with-tokens",
      "installs": 140378,
      "score": 0.1193,
      "scannedFiles": 1,
      "findings": []
    }
  ]
}
```

The agent turns this into:

> **deploy-to-vercel** · `vercel-labs/agent-skills` · 174,829 installs
> Why it fits: its description is "Deploy applications and websites to Vercel", which matches the request directly.
> Findings: No findings in scanned files (1 file scanned).
> Install: `npx skills add vercel-labs/agent-skills@deploy-to-vercel`

## Install

```bash
npx skills add tamerardall/vetskill
```

Or, in Claude Code, install it as a plugin:

```
/plugin marketplace add tamerardall/vetskill
/plugin install vetskill@vetskill
```

Requires Node 18 or later. There are no other dependencies.

Optional: run `gh auth login` (or set `GITHUB_TOKEN`). Without a token, GitHub allows 60 API requests per hour. Candidates hit by that limit show up as SS-08 "rate-limited" instead of being scanned.

## How it works

1. The agent turns your request into 3–5 English search queries.
2. `scripts/scan.mjs` queries the skills.sh API for each one. It merges the results with Reciprocal Rank Fusion (`score = Σ 1 / (10 + rank)`), so relevance order is kept and installs only break ties.
3. For the top candidates (10 by default), the script fetches the skill folder from GitHub and runs the rules below on every file. Finding messages are fixed strings and never quote file content.
4. The script prints JSON. The agent reads only that JSON. It picks 1–3 candidates that fit your intent and shows each one's findings, including what could not be scanned.

**The agent never reads a candidate's raw SKILL.md, README, scripts or skills.sh page.** That text is written by strangers and can carry a prompt injection. It can also contain invisible Unicode that a model cannot reliably see. Only the script reads those files. A few third-party strings do reach the JSON, cleaned first: the skills.sh `id`, `source` and `name` (candidates whose values do not match strict patterns are dropped), file paths in findings (characters outside letters, digits, spaces and `._/@+-` become `?`, capped at 200 characters), and the frontmatter `description` (control and hidden characters removed, cut to 300 characters). They can still contain words written by strangers, so the skill tells the agent never to follow instructions in them.

## Rules

| ID | Looks for | Severity |
|---|---|---|
| SS-01 | Bidi controls (U+202A–202E, U+2066–2069) and Unicode tag characters (U+E0000–E007F): high. Zero-width characters (U+200B–200D, U+2060, U+FEFF except at file start): medium | high / medium |
| SS-02 | `curl`/`wget` piped into `sh`/`bash`/`zsh` (also via `sudo`), `bash <(curl …)`, `sh -c "$(curl …)"`, `eval "$(curl …)"`, `iex (iwr …)` / `Invoke-Expression` with a download | high |
| SS-03 | `~/.ssh`, `id_rsa`, `id_ed25519`, `~/.aws/credentials`, browser cookie/profile stores, macOS keychain in every file; `.env` in non-Markdown files only | medium |
| SS-04 | HTTP requests to raw IP addresses; `webhook.site`, `ngrok`, `pastebin.com`, `discord.com/api/webhooks`, `requestbin` | medium |
| SS-05 | Prompt-injection phrases: "ignore (all) previous/prior/above instructions", "do not tell the user", "without asking the user", "disregard (the) system prompt" (case-insensitive) | medium |
| SS-06 | Base64 blocks of 200+ characters, `eval(atob(`, `exec(base64`, `base64 -d \| sh` | medium |
| SS-07 | Unrestricted `Bash` or `*` in frontmatter `allowed-tools` | info |
| SS-08 | Content that was not scanned: binary file, file over 256 KB, files beyond the 30-file limit, file or skill that could not be fetched, skill folder not found, rate limit | info |

**Why `.env` is Markdown-exempt:** a deploy skill's docs saying "set `VERCEL_TOKEN` in your `.env` file" is expected and harmless. A script that opens `.env` is worth a look. Key and credential paths are flagged everywhere.

A finding is a pointer to a line, not a verdict. A static match can be entirely legitimate, so the agent explains the context but never hides the finding.

## Why another tool?

| Tool | What it does | How vetskill differs |
|---|---|---|
| `npx skills find` | Searches skills.sh | Re-sorts results by installs, so the best match can drop far down (#17 of 20 for `deploy`). Shows names only, without descriptions. |
| `maverickemanuel/trusted-skill-scout` | Searches with `npx skills find` and installs | "Trust" means ≥100 installs and ≥500 stars. It does not scan content and ranks by popularity. |
| `affaan-m/ecc` → `skill-scout` | Looks for an existing skill before you write a new one | Different goal. No deterministic scan. |
| skills.sh audit badges (Gen Agent Trust Hub, Socket, Snyk) | Third-party audits shown on the skills.sh page | Useful information, and vetskill does not replace them. |

What vetskill adds:

- **Decision time, current files.** It scans what is in the repo at the moment you are choosing, not at the time of an earlier audit.
- **The agent never reads raw candidate content.** In our baseline without vetskill, an agent asked to find a Vercel deploy skill and check its safety read the candidate's SKILL.md in 5 of 5 runs. It answered "mostly yes"-style in 5 of 5 ("Mostly yes, with caveats", "Reasonably safe, with caveats"). With vetskill: 0 of 5 for both. See [docs/baseline/2026-10-29-red.md](docs/baseline/2026-10-29-red.md) and [docs/baseline/2026-10-29-green.md](docs/baseline/2026-10-29-green.md).
- **Per-file findings plus explicit SS-08.** Every finding has a rule ID and a file, plus a line where one applies, and anything that was not scanned is listed as such.
- **Intent-based, multi-query ranking.** Several queries are merged by relevance. The agent picks by description fit, and installs are a tie-breaker only.

## Limits

- **Static scanning cannot catch a determined attacker. No findings ≠ safe.** vetskill matches patterns. It does not execute code, follow data flow or sandbox anything. It never calls a skill safe.
- Only GitHub-hosted skills are scanned. Search results whose source is not a GitHub `owner/repo`, or whose id or name contain unexpected characters, are dropped.
- Per skill, at most 30 files of up to 256 KB each are scanned. The rest is reported as SS-08.
- Lines longer than 4096 characters (minified code, for example) are checked only for SS-01, SS-03 and long base64 blocks.
- Search depends on the skills.sh API. If some queries fail, the JSON lists them in `warnings` and results may be incomplete. If all fail, `error` is set.

## Development

```bash
npm test
```

## License

[MIT](LICENSE) © 2026 Tamer Ardal
