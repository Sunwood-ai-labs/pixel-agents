import type { AgentStateStore } from './agentStateStore.js';
import type { AgentState } from './types.js';

const DEFAULT_HEARTBEAT_TTL_SECONDS = 90;
const MIN_HEARTBEAT_TTL_SECONDS = 15;
const MAX_HEARTBEAT_TTL_SECONDS = 3600;
const OFFLINE_RETENTION_MS = 24 * 60 * 60 * 1000;
const REMOTE_TOOL_ID = 'remote-activity';

export type RemoteAgentStatus = 'active' | 'waiting' | 'done';

export interface RemoteAgentUpdate {
  displayName: string;
  task: string;
  status: RemoteAgentStatus;
  activity?: string;
  progress?: { current: number; total: number; unit?: string };
  parent?: { hostId: string; agentId: string };
  heartbeatTtlSeconds?: number;
}

export interface RemoteAgentSnapshot extends RemoteAgentUpdate {
  hostId: string;
  agentId: string;
  localAgentId: number;
  connectionState: 'connected' | 'offline';
  lastSeenAt: number;
}

interface RemoteEntry {
  key: string;
  localAgentId: number;
  hostId: string;
  agentId: string;
  update: RemoteAgentUpdate;
  lastSeenAt: number;
  expiresAt: number;
  connectionState: 'connected' | 'offline';
}

function remoteKey(hostId: string, agentId: string): string {
  return `${hostId}/${agentId}`;
}

function sanitizeLabel(value: string, maxLength = 80): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function heartbeatMs(value?: number): number {
  const seconds = Math.min(
    MAX_HEARTBEAT_TTL_SECONDS,
    Math.max(MIN_HEARTBEAT_TTL_SECONDS, value ?? DEFAULT_HEARTBEAT_TTL_SECONDS),
  );
  return seconds * 1000;
}

function makeAgent(id: number, entry: RemoteEntry, parentAgentId?: number): AgentState {
  const activity = entry.update.activity;
  return {
    id,
    sessionId: `remote:${entry.key}`,
    terminalRef: undefined,
    isExternal: true,
    projectDir: '',
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(activity ? [REMOTE_TOOL_ID] : []),
    activeToolStatuses: new Map(activity ? [[REMOTE_TOOL_ID, activity]] : []),
    activeToolNames: new Map(activity ? [[REMOTE_TOOL_ID, 'Remote']] : []),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: entry.update.status !== 'active',
    permissionSent: false,
    hadToolsInTurn: Boolean(activity),
    folderName: `REMOTE · ${entry.update.displayName}`,
    lastDataAt: entry.lastSeenAt,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: true,
    hooksOnly: true,
    providerId: 'remote',
    parentSessionId: entry.update.parent
      ? `remote:${remoteKey(entry.update.parent.hostId, entry.update.parent.agentId)}`
      : undefined,
    inputTokens: 0,
    outputTokens: 0,
    teamName: `Remote:${entry.hostId}`,
    agentName: entry.update.task,
    isTeamLead: !entry.update.parent,
    leadAgentId: parentAgentId,
    remoteHostId: entry.hostId,
    remoteAgentKey: entry.key,
    remoteConnectionState: entry.connectionState,
    remoteProgress: entry.update.progress,
  };
}

export class RemoteAgentRegistry {
  private readonly entries = new Map<string, RemoteEntry>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly store: AgentStateStore,
    cleanupIntervalMs = 5_000,
  ) {
    this.timer = setInterval(() => this.sweep(), cleanupIntervalMs);
    this.timer.unref?.();
  }

  upsert(hostIdRaw: string, agentIdRaw: string, input: RemoteAgentUpdate): RemoteAgentSnapshot {
    const hostId = sanitizeLabel(hostIdRaw, 64);
    const agentId = sanitizeLabel(agentIdRaw, 64);
    const update: RemoteAgentUpdate = {
      ...input,
      displayName: sanitizeLabel(input.displayName),
      task: sanitizeLabel(input.task),
      activity: input.activity ? sanitizeLabel(input.activity, 120) : undefined,
      progress: input.progress
        ? {
            current: input.progress.current,
            total: input.progress.total,
            unit: input.progress.unit ? sanitizeLabel(input.progress.unit, 24) : undefined,
          }
        : undefined,
    };
    const key = remoteKey(hostId, agentId);
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        localAgentId: this.store.nextAgentId.current++,
        hostId,
        agentId,
        update,
        lastSeenAt: now,
        expiresAt:
          update.status === 'done'
            ? now + OFFLINE_RETENTION_MS
            : now + heartbeatMs(update.heartbeatTtlSeconds),
        connectionState: 'connected',
      };
      this.entries.set(key, entry);
      const parentAgentId = update.parent
        ? this.entries.get(remoteKey(update.parent.hostId, update.parent.agentId))?.localAgentId
        : undefined;
      this.store.set(entry.localAgentId, makeAgent(entry.localAgentId, entry, parentAgentId));
    } else {
      entry.update = update;
      entry.lastSeenAt = now;
      entry.expiresAt =
        update.status === 'done'
          ? now + OFFLINE_RETENTION_MS
          : now + heartbeatMs(update.heartbeatTtlSeconds);
      entry.connectionState = 'connected';
      this.syncAgent(entry);
    }
    this.relinkHierarchy();
    this.broadcastState(entry);
    return this.snapshot(entry);
  }

  remove(hostId: string, agentId: string): boolean {
    const key = remoteKey(hostId, agentId);
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.store.delete(entry.localAgentId);
    this.relinkHierarchy();
    return true;
  }

  list(): RemoteAgentSnapshot[] {
    return [...this.entries.values()].map((entry) => this.snapshot(entry));
  }

  sweep(now = Date.now()): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.expiresAt > now) continue;
      if (entry.connectionState === 'connected' && entry.update.status !== 'done') {
        entry.connectionState = 'offline';
        entry.expiresAt = now + OFFLINE_RETENTION_MS;
        this.syncAgent(entry);
        this.broadcastState(entry);
      } else {
        this.remove(entry.hostId, entry.agentId);
      }
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    for (const entry of this.entries.values()) this.store.delete(entry.localAgentId);
    this.entries.clear();
  }

  private syncAgent(entry: RemoteEntry): void {
    const agent = this.store.get(entry.localAgentId);
    if (!agent) return;
    agent.folderName = `REMOTE · ${entry.update.displayName}`;
    agent.agentName = entry.update.task;
    agent.lastDataAt = entry.lastSeenAt;
    agent.isWaiting = entry.update.status !== 'active' || entry.connectionState === 'offline';
    agent.remoteConnectionState = entry.connectionState;
    agent.remoteProgress = entry.update.progress;
    const activity = entry.connectionState === 'offline' ? 'OFFLINE' : entry.update.activity;
    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();
    if (activity) {
      agent.activeToolIds.add(REMOTE_TOOL_ID);
      agent.activeToolStatuses.set(REMOTE_TOOL_ID, activity);
      agent.activeToolNames.set(REMOTE_TOOL_ID, 'Remote');
    }
  }

  private relinkHierarchy(): void {
    for (const entry of this.entries.values()) {
      const agent = this.store.get(entry.localAgentId);
      if (!agent) continue;
      const parentId = entry.update.parent
        ? this.entries.get(remoteKey(entry.update.parent.hostId, entry.update.parent.agentId))
            ?.localAgentId
        : undefined;
      if (agent.leadAgentId === parentId) continue;
      agent.leadAgentId = parentId;
      agent.isTeamLead = parentId === undefined;
      this.store.broadcast({
        type: 'agentTeamInfo',
        id: agent.id,
        teamName: agent.teamName,
        agentName: agent.agentName,
        isTeamLead: agent.isTeamLead,
        leadAgentId: parentId,
      });
    }
  }

  private broadcastState(entry: RemoteEntry): void {
    const agent = this.store.get(entry.localAgentId);
    if (!agent) return;
    this.store.broadcast({
      type: 'agentTeamInfo',
      id: agent.id,
      teamName: agent.teamName,
      agentName: agent.agentName,
      isTeamLead: agent.isTeamLead,
      leadAgentId: agent.leadAgentId,
    });
    this.store.broadcast({
      type: 'agentRemoteProgress',
      id: agent.id,
      hostId: entry.hostId,
      connectionState: entry.connectionState,
      lastSeenAt: entry.lastSeenAt,
      progress: entry.update.progress,
    });
    this.store.broadcast({
      type: 'agentStatus',
      id: agent.id,
      status: agent.isWaiting ? 'waiting' : 'active',
      awaitingInput: entry.update.status === 'waiting',
      silent: true,
    });
    this.store.broadcast({ type: 'agentToolsClear', id: agent.id });
    const activity = entry.connectionState === 'offline' ? 'OFFLINE' : entry.update.activity;
    if (activity) {
      this.store.broadcast({
        type: 'agentToolStart',
        id: agent.id,
        toolId: REMOTE_TOOL_ID,
        toolName: 'Remote',
        status: activity,
      });
    }
  }

  private snapshot(entry: RemoteEntry): RemoteAgentSnapshot {
    return {
      ...entry.update,
      hostId: entry.hostId,
      agentId: entry.agentId,
      localAgentId: entry.localAgentId,
      connectionState: entry.connectionState,
      lastSeenAt: entry.lastSeenAt,
    };
  }
}
