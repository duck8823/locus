# AI Review Workflow

> 日本語: [ai-review-workflow.ja.md](ai-review-workflow.ja.md)

This repository uses a multi-AI review loop for implementation pull requests:

1. Open a **Draft PR** first.
2. Run a first-pass review with Gemini and address blocking comments.
3. Mark PR as Ready.
4. Request Codex review by commenting `@codex review`.
5. Address Codex comments and request review again until no issues remain.
6. Merge after CI and review checks are green.

For integration-impacting PRs (OAuth/token/data-handling), complete:

- [`Security Review Checklist`](security-review-checklist.md)
- corresponding Security section in PR description

## Codex environment prerequisite

If Codex replies with:

> To use Codex here, create an environment for this repo.

then the repository does not have a Codex environment configured yet.

A repository admin must create it in Codex settings:

- Open: `https://chatgpt.com/codex/settings/environments`
- Create an environment for `duck8823/locus`
- Re-run `@codex review` on the PR

Without this setup, Codex cannot produce PR review comments.

## Minimum merge gate

- CI checks pass (`Lint / Typecheck / Unit / Build`, `E2E Smoke`)
- Gemini blocker comments addressed
- Codex blocker comments addressed (or Codex returns no issues)
- Security checklist completed for integration-impacting changes
