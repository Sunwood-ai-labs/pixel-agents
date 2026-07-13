import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

import type { AgentStateStore } from '../../../agentStateStore.js';
import type { AgentState } from '../../../types.js';

const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1000;
const DEFAULT_COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POLL_MS = 2_000;

export interface CodexSessionInfo {
  sessionId: string;
  jsonlFile: string;
  cwd: string;
  agentPath: string;
  nickname?: string;
  lastDataAt: number;
  lifecycle: 'active' | 'done';
}

interface DiscoveryOptions {
  sessionsRoot?: string;
  workspacePath: string;
  now?: number;
  maxIdleMs?: number;
  completedRetentionMs?: number;
}

function isWorkspaceRelated(sessionCwd: string, workspacePath: string): boolean {
  const session = path.resolve(sessionCwd);
  const workspace = path.resolve(workspacePath);
  return (
    session === workspace ||
    session.startsWith(`${workspace}${path.sep}`) ||
    workspace.startsWith(`${session}${path.sep}`)
  );
}

function recentJsonlFiles(root: string, cutoff: number): string[] {
  const files: string[] = [];
  const dirs = [root];

  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          if (fs.statSync(fullPath).mtimeMs >= cutoff) files.push(fullPath);
        } catch {
          // The session may have ended between readdir and stat.
        }
      }
    }
  }
  return files;
}

async function inspectSession(file: string): Promise<CodexSessionInfo | null> {
  let metadata: Omit<CodexSessionInfo, 'lifecycle'> | null = null;
  let lifecycle: CodexSessionInfo['lifecycle'] | null = null;
  let lines = 0;
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of reader) {
      lines++;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const payload = record['payload'];
      if (!payload || typeof payload !== 'object') continue;
      const p = payload as Record<string, unknown>;

      if (record['type'] === 'session_meta' && !metadata) {
        const id = p['id'];
        const cwd = p['cwd'];
        if (typeof id !== 'string' || typeof cwd !== 'string') continue;
        let lastDataAt = 0;
        try {
          lastDataAt = fs.statSync(file).mtimeMs;
        } catch {
          return null;
        }
        metadata = {
          sessionId: id,
          jsonlFile: file,
          cwd,
          agentPath: typeof p['agent_path'] === 'string' ? p['agent_path'] : '/root',
          nickname: typeof p['agent_nickname'] === 'string' ? p['agent_nickname'] : undefined,
          lastDataAt,
        };
      }

      if (record['type'] === 'event_msg') {
        if (p['type'] === 'task_started') lifecycle = 'active';
        if (p['type'] === 'task_complete') lifecycle = 'done';
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  if (!metadata || !lifecycle) return null;
  return { ...metadata, lifecycle, lastDataAt: metadata.lastDataAt || lines };
}

/** Discover live Codex sessions without reading prompt/message content. */
export async function discoverActiveCodexSessions(
  options: DiscoveryOptions,
): Promise<CodexSessionInfo[]> {
  const now = options.now ?? Date.now();
  const maxIdleMs = options.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
  const completedRetentionMs = options.completedRetentionMs ?? DEFAULT_COMPLETED_RETENTION_MS;
  const root = options.sessionsRoot ?? path.join(os.homedir(), '.codex', 'sessions');
  const files = recentJsonlFiles(root, now - Math.max(maxIdleMs, completedRetentionMs));
  const inspected = await Promise.all(files.map((file) => inspectSession(file)));

  const related = inspected.filter((session): session is CodexSessionInfo => {
    if (!session || !isWorkspaceRelated(session.cwd, options.workspacePath)) return false;
    const retention = session.lifecycle === 'active' ? maxIdleMs : completedRetentionMs;
    return session.lastDataAt >= now - retention;
  });
  const active = related.filter((session) => session.lifecycle === 'active');
  const completed = related
    .filter((session) => session.lifecycle === 'done' && session.agentPath !== '/root')
    .sort((a, b) => b.lastDataAt - a.lastDataAt);
  return [...active, ...completed].sort((a, b) => a.agentPath.localeCompare(b.agentPath));
}

function displayName(session: CodexSessionInfo): string {
  let name: string;
  if (session.agentPath === '/root') name = 'Codex';
  else if (session.nickname) name = `Codex · ${session.nickname}`;
  else {
    const leaf = session.agentPath.split('/').filter(Boolean).at(-1) ?? 'Agent';
    name = `Codex · ${leaf.replaceAll('_', ' ')}`;
  }
  return session.lifecycle === 'done' ? `${name} · Done` : name;
}

function makeAgent(id: number, session: CodexSessionInfo): AgentState {
  return {
    id,
    sessionId: session.sessionId,
    terminalRef: undefined,
    isExternal: true,
    projectDir: session.cwd,
    jsonlFile: session.jsonlFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: session.lifecycle === 'done',
    permissionSent: false,
    hadToolsInTurn: false,
    folderName: displayName(session),
    lastDataAt: session.lastDataAt,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    providerId: 'codex',
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Polls Codex's authoritative local rollout files and mirrors active tasks. */
export class CodexSessionScanner {
  private readonly ownedAgents = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;

  constructor(
    private readonly store: AgentStateStore,
    private readonly workspacePath: string,
    private readonly sessionsRoot = path.join(os.homedir(), '.codex', 'sessions'),
  ) {}

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const sessions = await discoverActiveCodexSessions({
        sessionsRoot: this.sessionsRoot,
        workspacePath: this.workspacePath,
      });
      const activeIds = new Set(sessions.map((session) => session.sessionId));

      for (const session of sessions) {
        const existingId = this.ownedAgents.get(session.sessionId);
        if (existingId !== undefined) {
          const agent = this.store.get(existingId);
          if (agent) {
            const becameDone = !agent.isWaiting && session.lifecycle === 'done';
            const becameActive = agent.isWaiting && session.lifecycle === 'active';
            agent.isWaiting = session.lifecycle === 'done';
            agent.folderName = displayName(session);
            agent.lastDataAt = session.lastDataAt;
            if (becameDone) {
              this.store.broadcast({
                type: 'agentStatus',
                id: existingId,
                status: 'waiting',
                awaitingInput: false,
              });
            } else if (becameActive) {
              this.store.broadcast({ type: 'agentStatus', id: existingId, status: 'active' });
            }
          }
          continue;
        }
        const id = this.store.nextAgentId.current++;
        this.ownedAgents.set(session.sessionId, id);
        this.store.set(id, makeAgent(id, session));
        if (session.lifecycle === 'done') {
          this.store.broadcast({
            type: 'agentStatus',
            id,
            status: 'waiting',
            awaitingInput: false,
          });
        }
        console.log(
          `[Codex Scanner] Added ${displayName(session)} from ${path.basename(session.jsonlFile)}`,
        );
      }

      for (const [sessionId, id] of this.ownedAgents) {
        if (activeIds.has(sessionId)) continue;
        this.ownedAgents.delete(sessionId);
        this.store.delete(id);
        console.log(`[Codex Scanner] Removed expired or stale Codex agent ${sessionId}`);
      }
    } catch (error) {
      console.error('[Codex Scanner] Scan failed:', error);
    } finally {
      this.scanning = false;
    }
  }

  async start(pollMs = DEFAULT_POLL_MS): Promise<void> {
    await this.scan();
    this.timer = setInterval(() => void this.scan(), pollMs);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const id of this.ownedAgents.values()) this.store.delete(id);
    this.ownedAgents.clear();
  }
}
