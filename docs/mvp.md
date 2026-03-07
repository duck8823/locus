# Locus MVP Definition

> 日本語: [mvp.ja.md](mvp.ja.md)

## Product Goal

Help reviewers understand the *meaning* of a pull request faster than they can with a raw unified diff.

## Primary User

- Senior / staff engineers reviewing medium-to-large GitHub pull requests
- Tech leads who need to understand change impact across layers before approving

## Core User Jobs

1. Identify the meaningful logic changes without getting buried in formatting noise.
2. Understand where the changed code sits in the system.
3. Resume a large review without losing progress.

## MVP Scope

### In scope

1. **GitHub pull request ingestion**
   - fetch changed files and patch metadata
   - normalize snapshots for downstream analysis
2. **Semantic diff v0**
   - define a language-agnostic semantic change contract
   - validate the first vertical slice with one temporary parser / language combination
   - function / method / function-valued class property granularity in the first validation slice
   - ignore comment-only and whitespace-only changes
3. **Architecture context v0**
   - dependency graph from imports and directory heuristics
   - show the changed node's immediate upstream / downstream neighbors
4. **Review progress tracking**
   - mark semantic change groups as unread / in-progress / reviewed

### Out of scope

- GitLab / Bitbucket support
- Confluence / Jira / Notion integrations
- Multi-language production support in this phase
- Locking the long-term parser family or implementation language in this phase
- Writing review comments back to GitHub automatically
- Real-time collaboration
- Production billing / tenancy concerns

## Delivery Slices

### Slice 1 — Semantic-diff contract and parser spike

- define parser adapter and semantic change contracts
- ship one temporary probe implementation behind the adapter boundary
- cover major callable forms for the probe language with tests

### Slice 2 — GitHub adapter

- transform a PR diff into file snapshots
- map changed files to semantic change records

### Slice 3 — Architecture context

- build dependency graph from touched files
- attach graph neighbors to each semantic change group

### Slice 4 — Review session state

- persist review progress
- reopen the same PR and restore where the reviewer stopped

## Success Criteria

- A reviewer can locate the changed callable in under 10 seconds.
- Comment-only or formatting-only edits do not appear as semantic changes.
- A 200-file GitHub PR can be ingested and summarized without manual intervention.
- At least one internal dogfooding review concludes that the semantic view is more useful than raw diff for a medium-sized PR.

## Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Parser coverage stalls progress | Missing syntax support erodes trust quickly | start with one temporary spike, keep parser contracts replaceable |
| A temporary spike gets mistaken for the final platform choice | accidental lock-in would fight the multi-language roadmap | require ADR before locking parser or implementation language |
| Architecture map becomes noisy | reviewers will ignore it if the graph is unreadable | show only immediate neighbors first |
| GitHub ingestion and analysis get tightly coupled | future host support becomes expensive | keep a provider-agnostic snapshot contract |
| Building UI too early hides core signal problems | polish can mask weak analysis | validate with CLI and fixtures before UI work |
