# Plugin SDK Contract (H5-1 / H5-2)

> 日本語: [plugin-sdk-contract.ja.md](plugin-sdk-contract.ja.md)

## Goal

Define the minimum plugin contract (manifest, lifecycle, capability) and a runtime model that allows safe failure isolation.

## Core contract

Location:
- `src/server/application/plugins/plugin-sdk.ts`

### Manifest
- `pluginId`: unique id
- `displayName`: human-readable name
- `version`: plugin version string
- `sdkVersion`: currently `1`
- `capabilities[]`: declared capability list

Current capability kind:
- `pull-request-snapshot-provider`
  - `provider`: code host identifier (`github`, `sample`, etc.)

### Lifecycle
- `activate(context)` is required
  - context includes `AbortSignal` and runtime logger
- activation returns:
  - capability implementations
  - optional `deactivate()` hook

### Validation rules
- manifest required fields must be non-empty
- declared capabilities must be unique
- activation result must implement every declared capability
- undeclared capabilities are rejected

## Runtime behavior

Location:
- `src/server/infrastructure/plugins/plugin-runtime.ts`

Behavior:
- load plugin modules and validate manifest/activation result
- register capabilities by provider key
- skip duplicated capability providers
- disable plugin on execution failure (except auth errors), call `deactivate`, and keep host process alive

### Capability permission policy

- Runtime evaluates capability allow/deny policy before activation is accepted.
- Environment variables:
  - `LOCUS_PLUGIN_CAPABILITY_ALLOWLIST`
  - `LOCUS_PLUGIN_CAPABILITY_DENYLIST`
- Format: comma-separated capability keys (example: `pull-request-snapshot-provider:github`).
- Denied capabilities are rejected deterministically with typed diagnostics (`PluginCapabilityDeniedError`), and plugin load status becomes disabled.

## Sample plugin

Location:
- `src/server/infrastructure/plugins/sample/sample-codehost-plugin.ts`

Purpose:
- verify SDK ergonomics with a minimal provider (`provider: "sample"`)
- keep implementation dependency-free

## Compatibility policy (initial)

- `PLUGIN_SDK_VERSION` major bump is required for breaking changes.
- Additive fields are allowed within the same major.
- Runtime should continue to reject unknown/invalid capability bindings deterministically.

## Secure extension-development constraints

- Plugin capabilities should follow least privilege by provider key.
- Do not register wildcard/high-entropy provider identifiers for production use.
- Plugin code must avoid reading host secrets outside explicitly passed runtime context.
- Capability denial by policy must be treated as non-retryable configuration failure.
