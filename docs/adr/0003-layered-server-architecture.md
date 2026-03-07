# ADR 0003: Use a Go-inspired layered server architecture

> 日本語: [0003-layered-server-architecture.ja.md](0003-layered-server-architecture.ja.md)

- Status: Accepted
- Date: 2026-03-07

## Context

We want to reuse the **design concepts** from the referenced Go coding standards without copying Go-specific techniques or directory conventions literally.

The desired outcome is:
- a testable server core under a Next.js product shell
- explicit dependency direction
- domain boundaries that survive framework churn
- enough structure to add GitHub, parser, storage, and LLM integrations without turning the app into a route-file monolith

## Decision

Adopt a four-layer server architecture inside the TypeScript web application:

```text
Presentation -> Application -> Domain <- Infrastructure
```

### Layer responsibilities

#### Presentation
- Next.js route handlers
- server actions
- request validation and response shaping
- auth/session boundary translation

#### Application
- use cases
- workflow orchestration
- transaction boundaries
- authorization checks tied to a use case
- idempotency / job triggering policies

#### Domain
- entities and value objects
- domain services and invariants
- repository interfaces for domain aggregates
- semantic analysis concepts that are independent of frameworks and parsers

#### Infrastructure
- database access
- GitHub API implementations
- parser adapter implementations
- queue / blob / cache integrations
- LLM provider integrations

## Dependency rules

- Presentation may depend on Application DTOs and use cases, but not on Infrastructure implementations.
- Application may depend on Domain and on abstract ports/interfaces, but not on framework-specific request/response types.
- Domain must not depend on Next.js, Prisma, GitHub SDKs, parser SDKs, or provider-specific types.
- Infrastructure may depend inward on Domain/Application abstractions, but never the other way around.

## Concrete adaptation of the Go concepts

The referenced Go rules strongly separate presentation, application, domain, and infrastructure. We keep that concept, but adapt the mechanics for TypeScript:

- **keep route files thin** instead of HTTP handlers thin
- **separate request/response mappers** from use-case orchestration
- **define repository interfaces and analysis contracts** away from framework files
- **use explicit mappers** so ORM and provider types do not leak into the domain
- **treat parser adapters like infrastructure modules**, not like domain objects

The operational rules in this ADR are intentionally self-contained. A reader should be able to apply the architecture without needing access to the originally referenced materials.

## Project structure

```text
src/
  app/
    (marketing)/
      page.tsx
    (workspace)/
      reviews/
        [reviewId]/
          page.tsx
          loading.tsx
          error.tsx
      settings/
        connections/page.tsx
    api/
      github/
        webhooks/route.ts
      reviews/
        [reviewId]/
          progress/route.ts
          reanalyze/route.ts
  server/
    presentation/
      api/
      actions/
      dto/
      mappers/
    application/
      usecases/
      services/
      ports/
    domain/
      entities/
      value-objects/
      repositories/
      services/
    infrastructure/
      db/
      github/
      parser/
      llm/
      queue/
      cache/
      storage/
```

## Consequences

### Positive

- framework files stay replaceable
- the analysis core remains testable without rendering UI
- GitHub, parser, and persistence changes become localized

### Negative

- more up-front structure and mapper boilerplate
- developers need discipline to avoid short-circuiting the boundaries

## Adoption conditions

- new server features are placed under `src/server/**`
- framework files under `src/app/**` delegate to use cases
- infrastructure types are mapped before entering Domain/Application
- review comments treat boundary violations as design issues, not style nits

## Reference note

This ADR was inspired by an internal Go coding-standards document, but the normative guidance is fully captured above. Future implementation and review should rely on this ADR itself rather than on an external repository remaining accessible.
