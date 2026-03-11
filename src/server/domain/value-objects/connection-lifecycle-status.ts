export const connectionLifecycleStatuses = [
  "not_connected",
  "planned",
  "connected",
  "reauth_required",
] as const;

export type ConnectionLifecycleStatus = (typeof connectionLifecycleStatuses)[number];

export const writableConnectionStatuses = [
  "not_connected",
  "connected",
  "reauth_required",
] as const;

export type WritableConnectionStatus = (typeof writableConnectionStatuses)[number];

const transitionTargets: Readonly<Record<ConnectionLifecycleStatus, readonly WritableConnectionStatus[]>> = {
  not_connected: ["connected"],
  planned: [],
  connected: ["not_connected", "reauth_required"],
  reauth_required: ["not_connected", "connected"],
};

export function assertWritableConnectionStatus(value: string): WritableConnectionStatus {
  if ((writableConnectionStatuses as readonly string[]).includes(value)) {
    return value as WritableConnectionStatus;
  }

  throw new Error(`Unsupported writable connection status: ${value}`);
}

export function listAllowedConnectionTransitions(currentStatus: string): WritableConnectionStatus[] {
  const normalizedCurrent = normalizeConnectionLifecycleStatus(currentStatus);

  if (!normalizedCurrent) {
    return [];
  }

  return [...transitionTargets[normalizedCurrent]];
}

export function assertConnectionStatusTransition(
  currentStatus: string,
  nextStatus: WritableConnectionStatus,
): void {
  const normalizedCurrent = normalizeConnectionLifecycleStatus(currentStatus);

  if (!normalizedCurrent) {
    throw new Error(`Unsupported current connection status: ${currentStatus}`);
  }

  if (normalizedCurrent === nextStatus) {
    return;
  }

  const allowed = transitionTargets[normalizedCurrent];

  if (!allowed.includes(nextStatus)) {
    throw new Error(`Invalid connection status transition: ${currentStatus} -> ${nextStatus}`);
  }
}

function normalizeConnectionLifecycleStatus(value: string): ConnectionLifecycleStatus | null {
  if ((connectionLifecycleStatuses as readonly string[]).includes(value)) {
    return value as ConnectionLifecycleStatus;
  }

  return null;
}
