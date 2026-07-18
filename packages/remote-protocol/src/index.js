export const REMOTE_API_VERSION = 'v1';
export const REMOTE_API_PREFIX = `/api/remote/${REMOTE_API_VERSION}`;
export const REMOTE_AGENT_STATUSES = Object.freeze(['active', 'waiting', 'done']);
export const DEFAULT_HEARTBEAT_TTL_SECONDS = 90;
export const MIN_HEARTBEAT_TTL_SECONDS = 15;
export const MAX_HEARTBEAT_TTL_SECONDS = 3600;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function assertRemoteIdentifier(value, label = 'identifier') {
  if (!IDENTIFIER_PATTERN.test(value ?? '')) {
    throw new TypeError(
      `${label} must be 1-64 ASCII letters, digits, dots, underscores, or hyphens`,
    );
  }
  return value;
}

export function remoteAgentPath(hostId, agentId) {
  assertRemoteIdentifier(hostId, 'hostId');
  assertRemoteIdentifier(agentId, 'agentId');
  return `${REMOTE_API_PREFIX}/hosts/${encodeURIComponent(hostId)}/agents/${encodeURIComponent(agentId)}`;
}

export function validateRemoteAgentUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('agent update must be an object');
  }
  const allowed = new Set([
    'displayName',
    'task',
    'status',
    'activity',
    'progress',
    'parent',
    'heartbeatTtlSeconds',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`unknown agent update field: ${key}`);
  }
  assertDisplayString(input.displayName, 'displayName', 80, true);
  assertDisplayString(input.task, 'task', 80, true);
  if (!REMOTE_AGENT_STATUSES.includes(input.status)) {
    throw new TypeError(`status must be one of: ${REMOTE_AGENT_STATUSES.join(', ')}`);
  }
  assertDisplayString(input.activity, 'activity', 120, false);
  if (input.heartbeatTtlSeconds !== undefined) {
    if (
      !Number.isInteger(input.heartbeatTtlSeconds) ||
      input.heartbeatTtlSeconds < MIN_HEARTBEAT_TTL_SECONDS ||
      input.heartbeatTtlSeconds > MAX_HEARTBEAT_TTL_SECONDS
    ) {
      throw new TypeError(
        `heartbeatTtlSeconds must be ${MIN_HEARTBEAT_TTL_SECONDS}-${MAX_HEARTBEAT_TTL_SECONDS}`,
      );
    }
  }
  if (input.progress !== undefined) {
    const { current, total, unit } = input.progress ?? {};
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0 || current < 0) {
      throw new TypeError('progress requires finite current >= 0 and total > 0');
    }
    assertDisplayString(unit, 'progress.unit', 24, false);
  }
  if (input.parent !== undefined) {
    assertRemoteIdentifier(input.parent?.hostId, 'parent.hostId');
    assertRemoteIdentifier(input.parent?.agentId, 'parent.agentId');
  }
  return input;
}

function assertDisplayString(value, label, maxLength, required) {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || (required && value.trim().length === 0)) {
    throw new TypeError(`${label} must be ${required ? 'a non-empty' : 'a'} string`);
  }
  if (value.length > maxLength)
    throw new TypeError(`${label} must be at most ${maxLength} characters`);
  if (/\p{Cc}/u.test(value)) throw new TypeError(`${label} must not contain control characters`);
}
