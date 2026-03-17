import type { SemanticChange } from "@/server/domain/value-objects/semantic-change";
import type { FileDependencyContext } from "./dependency-graph-builder";

export function inferDominantLayer(filePath: string): string | undefined {
  const pathSegments = filePath.split("/").filter((segment) => segment.length > 0);

  if (pathSegments.includes("app")) {
    return "presentation";
  }

  if (pathSegments.includes("domain")) {
    return "domain";
  }

  if (pathSegments.includes("infrastructure")) {
    return "infrastructure";
  }

  if (pathSegments.includes("application")) {
    return "application";
  }

  return undefined;
}

export function mergeArchitectureContext(
  semanticChanges: SemanticChange[],
  dependencies: FileDependencyContext,
): SemanticChange[] {
  return semanticChanges.map((semanticChange) => {
    const filePath = semanticChange.after?.filePath ?? semanticChange.before?.filePath;

    if (!filePath) {
      return semanticChange;
    }

    const outgoing = new Set<string>(semanticChange.architecture?.outgoingNodeIds ?? []);
    const incoming = new Set<string>(semanticChange.architecture?.incomingNodeIds ?? []);
    const currentLayer = inferDominantLayer(filePath);

    for (const dependencyPath of dependencies.outgoingByPath.get(filePath) ?? []) {
      outgoing.add(`file:${dependencyPath}`);
      const downstreamLayer = inferDominantLayer(dependencyPath);

      if (downstreamLayer && downstreamLayer !== currentLayer) {
        outgoing.add(`layer:${downstreamLayer}`);
      }
    }

    for (const dependentPath of dependencies.incomingByPath.get(filePath) ?? []) {
      incoming.add(`file:${dependentPath}`);
      const upstreamLayer = inferDominantLayer(dependentPath);

      if (upstreamLayer && upstreamLayer !== currentLayer) {
        incoming.add(`layer:${upstreamLayer}`);
      }
    }

    const hasArchitecture = outgoing.size > 0 || incoming.size > 0;
    const shouldKeepArchitecture = hasArchitecture || semanticChange.architecture !== undefined;

    return {
      ...semanticChange,
      architecture: shouldKeepArchitecture
        ? {
            ...semanticChange.architecture,
            outgoingNodeIds: [...outgoing].sort(),
            incomingNodeIds: [...incoming].sort(),
          }
        : undefined,
    };
  });
}
