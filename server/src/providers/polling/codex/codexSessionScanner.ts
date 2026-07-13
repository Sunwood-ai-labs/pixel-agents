import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

import type { AgentStateStore } from '../../../agentStateStore.js';
import type { AgentState } from '../../../types.js';

const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 2_000;

export interface CodexSessionInfo {
  sessionId: string;
  jsonlFile: string;
  cwd: string;
  agentPath: string;
  nickname?: string;
  lastDataAt: number;
}

interface DiscoveryOptions {
  sessionsRoot?: string;
  workspacePath: string;
  now?: number;
  maxIdleMs?: number;
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
  let metadata: CodexSessionInfo | null = null;
  let active = false;
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
        if (p['type'] === 'task_started') active = true;
        if (p['type'] === 'task_complete') active = false;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  if (!metadata || !active) return null;
  return { ...metadata, lastDataAt: metadata.lastDataAt || lines };
}

/** Discover live Codex sessions without reading prompt/message content. */
export async function discoverActiveCodexSessions(
  options: DiscoveryOptions,
): Promise<CodexSessionInfo[]> {
  const now = options.now ?? Date.now();
  const maxIdleMs = options.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
  const root = options.sessionsRoot ?? path.join(os.homedir(), '.codex', 'sessions');
  const files = recentJsonlFiles(root, now - maxIdleMs);
  const inspected = await Promise.all(files.map((file) => inspectSession(file)));

  return inspected
    .filter((session): session is CodexSessionInfo => {
      return Boolean(session && isWorkspaceRelated(session.cwd, options.workspacePath));
    })
    .sort((a, b) => a.agentPath.localeCompare(b.agentPath));
}

function displayName(session: CodexSessionInfo): string {
  if (session.agentPath === '/root') return 'Codex';
  if (session.nickname) return `Codex · ${session.nickname}`;
  const leaf = session.agentPath.split('/').filter(Boolean).at(-1) ?? 'Agent';
  return `Codex · ${leaf.replaceAll('_', ' ')}`;
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
    isWaiting: false,
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
        if (this.ownedAgents.has(session.sessionId)) continue;
        const id = this.store.nextAgentId.current++;
        this.ownedAgents.set(session.sessionId, id);
        this.store.set(id, makeAgent(id, session));
        console.log(
          `[Codex Scanner] Added ${displayName(session)} from ${path.basename(session.jsonlFile)}`,
        );
      }

      for (const [sessionId, id] of this.ownedAgents) {
        if (activeIds.has(sessionId)) continue;
        this.ownedAgents.delete(sessionId);
        this.store.delete(id);
        console.log(`[Codex Scanner] Removed completed or stale Codex agent ${sessionId}`);
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
