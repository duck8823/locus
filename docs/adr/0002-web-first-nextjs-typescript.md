# ADR 0002: Use a web-first product surface with TypeScript and Next.js

> 日本語: [0002-web-first-nextjs-typescript.ja.md](0002-web-first-nextjs-typescript.ja.md)

- Status: Accepted
- Date: 2026-03-07

## Context

Locus is fundamentally a review product. Reviewers need to move across semantic change groups, architecture context, linked requirements, and review progress state in a single workspace. The product also needs authenticated GitHub integration and a practical path to shipping a BFF-style server surface quickly.

The user explicitly chose a web application over a CLI-first or desktop-first product surface. We also want to keep parser and language choices open while still making implementation decisions that allow progress now.

## Decision

Use **TypeScript + Next.js App Router** as the first implementation target and primary product surface.

The web application owns:
- authenticated review workspace UI
- route handlers for public HTTP entry points such as webhooks and API-style endpoints
- server-side composition for application use cases
- cache / revalidation hooks that are local to the web product surface

The web application does **not** get to own domain logic directly. Core logic must live under the layered server modules described in ADR 0003.

## Options considered

### Option A — Web-first with TypeScript + Next.js App Router (chosen)

- matches the primary review workflow
- gives us one codebase for UI and BFF concerns
- works well with parser ecosystems available from Node.js / TypeScript

### Option B — CLI-first product surface

- useful for spikes and fixtures
- weak for the actual reviewer experience because it cannot express the map, progress state, and multi-pane review flow naturally

### Option C — Desktop-first product surface

- could help in some local-only environments
- adds distribution, update, OS-specific, and auth complexity too early

## Rationale

### Product fit

The main user task is reviewing pull requests in a rich, stateful workspace. That is a web problem first, not a terminal or desktop distribution problem.

### Implementation speed

Next.js App Router gives us a practical way to combine UI, authenticated route handlers, and server-side composition without splitting the first implementation across multiple repos.

### Ecosystem fit

TypeScript is a reasonable fit for a parser-heavy product because Node.js can orchestrate existing parser ecosystems, especially tree-sitter-based parsers and language-specific compiler APIs.

### Constraint management

Choosing Next.js as the product shell does not force us to put business logic inside framework files. We can keep the framework surface thin.

## Consequences

### Positive

- one implementation surface for review UI and BFF concerns
- easy to prototype authenticated review flows
- straightforward path to route handlers, server rendering, and incremental UI work

### Negative

- Next.js convenience APIs make it easy to leak framework concerns into core logic
- app router file structure can encourage feature code to live too close to route files
- long-running analysis work still needs explicit background execution boundaries

## Adoption conditions

- `app/` files stay thin and delegate to use cases
- route handlers and server actions do not access the database, GitHub, or parsers directly
- long-running analysis is executed behind application/infrastructure boundaries, not inline inside UI components
- unsupported language analysis remains replaceable behind parser adapters

## Rejection conditions

Revisit this ADR if one of the following becomes true:

- reviewers require a local-only product surface as the primary workflow
- Next.js materially blocks the background analysis model needed for MVP
- the product splits into separate operational surfaces that make a single web-first codebase counterproductive

## References

- Next.js App Router docs: https://nextjs.org/docs/app
- Next.js Route Handlers docs: https://nextjs.org/docs/app/api-reference/file-conventions/route
