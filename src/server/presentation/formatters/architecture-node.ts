export type ArchitectureNodeKind = "layer" | "file" | "symbol" | "unknown";

export interface ArchitectureNodeView {
  raw: string;
  kind: ArchitectureNodeKind;
  label: string;
}

export interface ArchitectureNodeGroups {
  layer: ArchitectureNodeView[];
  file: ArchitectureNodeView[];
  symbol: ArchitectureNodeView[];
  unknown: ArchitectureNodeView[];
}

const SYMBOL_ROOT_SEGMENT = "<root>";

function parseLayerNode(raw: string): ArchitectureNodeView {
  const value = raw.slice("layer:".length).trim();
  const normalized = value.length > 0 ? value : "unknown";

  return {
    raw,
    kind: "layer",
    label: normalized,
  };
}

function parseFileNode(raw: string): ArchitectureNodeView {
  const value = raw.slice("file:".length).trim();
  const normalized = value.length > 0 ? value : "unknown";

  return {
    raw,
    kind: "file",
    label: normalized,
  };
}

/**
 * Expected payload format:
 * - symbol:<kind>::<name>
 * - symbol:<kind>:<container>::<name>
 * - symbol:<kind>:<container1>:<container2>::<name>
 */
function parseSymbolNode(raw: string): ArchitectureNodeView {
  const payload = raw.slice("symbol:".length).trim();

  if (payload.length === 0) {
    return {
      raw,
      kind: "symbol",
      label: "unknown symbol",
    };
  }

  const segments = payload.split("::");
  const primarySegment = segments[0] ?? "symbol";
  const [kind = "symbol", ...primaryContainerParts] = primarySegment.split(":");
  const normalizedKind = kind.trim().length > 0 ? kind.trim() : "symbol";
  const remainingSegments = segments.slice(1);
  const symbolName = (remainingSegments.at(-1) ?? primarySegment).trim() || "unknown";
  const containerSegments = [
    ...primaryContainerParts,
    ...remainingSegments.slice(0, Math.max(remainingSegments.length - 1, 0)),
  ].filter((part) => part !== SYMBOL_ROOT_SEGMENT && part.length > 0);
  const container = containerSegments.join(".");
  const displayName = container.length > 0 ? `${container}.${symbolName}` : symbolName;

  const label = displayName === normalizedKind ? `${displayName} symbol` : `${displayName} (${normalizedKind})`;

  return {
    raw,
    kind: "symbol",
    label,
  };
}

export function toArchitectureNodeView(raw: string): ArchitectureNodeView {
  if (raw.startsWith("layer:")) {
    return parseLayerNode(raw);
  }

  if (raw.startsWith("file:")) {
    return parseFileNode(raw);
  }

  if (raw.startsWith("symbol:")) {
    return parseSymbolNode(raw);
  }

  return {
    raw,
    kind: "unknown",
    label: raw,
  };
}

export function groupArchitectureNodes(rawNodes: string[]): ArchitectureNodeGroups {
  const trimmed = rawNodes.map((rawNode) => rawNode.trim()).filter((rawNode) => rawNode.length > 0);
  const deduplicated = [...new Set(trimmed)];
  const groups: ArchitectureNodeGroups = {
    layer: [],
    file: [],
    symbol: [],
    unknown: [],
  };

  for (const raw of deduplicated) {
    const node = toArchitectureNodeView(raw);
    groups[node.kind].push(node);
  }

  for (const key of Object.keys(groups) as Array<keyof ArchitectureNodeGroups>) {
    groups[key].sort((a, b) => a.label.localeCompare(b.label));
  }

  return groups;
}
