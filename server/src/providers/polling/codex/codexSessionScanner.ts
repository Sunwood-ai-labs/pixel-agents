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
  parentThreadId?: string;
  nickname?: string;
  lastDataAt: number;
  lifecycle: 'active' | 'done';
  activeTool?: { id: string; name: string; status: string };
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
  const activeTools = new Map<string, { name: string; status: string }>();
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
          parentThreadId:
            typeof p['parent_thread_id'] === 'string' ? p['parent_thread_id'] : undefined,
          nickname: typeof p['agent_nickname'] === 'string' ? p['agent_nickname'] : undefined,
          lastDataAt,
        };
      }

      if (record['type'] === 'event_msg') {
        if (p['type'] === 'task_started') {
          lifecycle = 'active';
          activeTools.clear();
        }
        if (p['type'] === 'task_complete') {
          lifecycle = 'done';
          activeTools.clear();
        }
      }

      if (record['type'] === 'response_item') {
        const itemType = p['type'];
        const callId = p['call_id'];
        if (
          (itemType === 'custom_tool_call' || itemType === 'function_call') &&
          typeof callId === 'string'
        ) {
          const rawName = typeof p['name'] === 'string' ? p['name'] : 'tool';
          const namespace = typeof p['namespace'] === 'string' ? p['namespace'] : '';
          const fullName = namespace ? `${namespace}/${rawName}` : rawName;
          activeTools.set(callId, classifyTool(fullName));
        } else if (
          (itemType === 'custom_tool_call_output' || itemType === 'function_call_output') &&
          typeof callId === 'string'
        ) {
          activeTools.delete(callId);
        }
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  if (!metadata || !lifecycle) return null;
  const lastTool = [...activeTools.entries()].at(-1);
  return {
    ...metadata,
    lifecycle,
    lastDataAt: metadata.lastDataAt || lines,
    activeTool:
      lifecycle === 'active' && lastTool
        ? { id: lastTool[0], name: lastTool[1].name, status: lastTool[1].status }
        : undefined,
  };
}

function classifyTool(toolName: string): { name: string; status: string } {
  const normalized = toolName.toLowerCase();
  if (normalized.includes('apply_patch') || normalized.includes('edit')) {
    return { name: 'Edit', status: 'Editing code' };
  }
  if (
    normalized.includes('exec') ||
    normalized.includes('command') ||
    normalized.includes('write_stdin')
  ) {
    return { name: 'Bash', status: 'Running commands' };
  }
  if (normalized.includes('web') || normalized.includes('search')) {
    return { name: 'WebSearch', status: 'Researching' };
  }
  if (normalized.includes('view_image') || normalized.includes('read')) {
    return { name: 'Read', status: 'Reading files' };
  }
  if (normalized.includes('collaboration') || normalized.includes('agent')) {
    return { name: 'Agent', status: 'Coordinating agents' };
  }
  return { name: 'Tool', status: 'Working' };
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

function taskLabel(session: CodexSessionInfo): string {
  if (session.agentPath === '/root') return 'Main task';
  const leaf = session.agentPath.split('/').filter(Boolean).at(-1) ?? 'Sub-agent';
  return leaf.replaceAll('_', ' ');
}

function makeAgent(id: number, session: CodexSessionInfo, parentAgentId?: number): AgentState {
  const activeToolIds = new Set<string>();
  const activeToolStatuses = new Map<string, string>();
  const activeToolNames = new Map<string, string>();
  if (session.activeTool) {
    activeToolIds.add(session.activeTool.id);
    activeToolStatuses.set(session.activeTool.id, session.activeTool.status);
    activeToolNames.set(session.activeTool.id, session.activeTool.name);
  }
  return {
    id,
    sessionId: session.sessionId,
    terminalRef: undefined,
    isExternal: true,
    projectDir: session.cwd,
    jsonlFile: session.jsonlFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds,
    activeToolStatuses,
    activeToolNames,
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: session.lifecycle === 'done',
    permissionSent: false,
    hadToolsInTurn: Boolean(session.activeTool),
    folderName: displayName(session),
    lastDataAt: session.lastDataAt,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    providerId: 'codex',
    parentSessionId: session.parentThreadId,
    inputTokens: 0,
    outputTokens: 0,
    teamName: 'Codex',
    agentName: taskLabel(session),
    isTeamLead: session.agentPath === '/root',
    leadAgentId: parentAgentId,
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
            agent.parentSessionId = session.parentThreadId;
            agent.leadAgentId = session.parentThreadId
              ? this.ownedAgents.get(session.parentThreadId)
              : undefined;
            agent.agentName = taskLabel(session);
            const previousToolId = [...agent.activeToolIds][0];
            const nextTool = session.activeTool;
            if (previousToolId && previousToolId !== nextTool?.id) {
              this.store.broadcast({
                type: 'agentToolDone',
                id: existingId,
                toolId: previousToolId,
              });
              agent.activeToolIds.clear();
              agent.activeToolStatuses.clear();
              agent.activeToolNames.clear();
            }
            if (nextTool && !agent.activeToolIds.has(nextTool.id)) {
              agent.activeToolIds.add(nextTool.id);
              agent.activeToolStatuses.set(nextTool.id, nextTool.status);
              agent.activeToolNames.set(nextTool.id, nextTool.name);
              this.store.broadcast({
                type: 'agentToolStart',
                id: existingId,
                toolId: nextTool.id,
                toolName: nextTool.name,
                status: nextTool.status,
              });
            }
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
        const parentAgentId = session.parentThreadId
          ? this.ownedAgents.get(session.parentThreadId)
          : undefined;
        this.ownedAgents.set(session.sessionId, id);
        this.store.set(id, makeAgent(id, session, parentAgentId));
        if (session.activeTool) {
          this.store.broadcast({
            type: 'agentToolStart',
            id,
            toolId: session.activeTool.id,
            toolName: session.activeTool.name,
            status: session.activeTool.status,
          });
        }
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
