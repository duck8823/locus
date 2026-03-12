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
