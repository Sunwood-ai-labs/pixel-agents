import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import {
  CodexSessionScanner,
  discoverActiveCodexSessions,
} from '../src/providers/polling/codex/codexSessionScanner.js';

const tempDirs: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-codex-'));
  tempDirs.push(dir);
  return dir;
}

function record(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ type, payload });
}

function writeSession(root: string, name: string, lines: string[], mtime = new Date()): string {
  const day = path.join(root, '2026', '07', '13');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, `${name}.jsonl`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  fs.utimesSync(file, mtime, mtime);
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('discoverActiveCodexSessions', () => {
  it('uses the first session_meta identity and the last lifecycle event', async () => {
    const root = tempRoot();
    writeSession(root, 'child', [
      record('session_meta', {
        id: 'child-id',
        cwd: '/Users/admin/Prj',
        agent_path: '/root/reviewer',
        agent_nickname: 'Singer',
      }),
      record('session_meta', { id: 'inherited-root-id', cwd: '/wrong' }),
      record('event_msg', { type: 'task_complete' }),
      record('event_msg', { type: 'task_started' }),
    ]);

    const sessions = await discoverActiveCodexSessions({
      sessionsRoot: root,
      workspacePath: '/Users/admin/Prj/pixel-agents',
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'child-id',
      agentPath: '/root/reviewer',
      nickname: 'Singer',
      lifecycle: 'active',
    });
  });

  it('retains recently completed sessions but excludes expired and unrelated sessions', async () => {
    const root = tempRoot();
    writeSession(
      root,
      'completed',
      [
        record('session_meta', {
          id: 'done',
          cwd: '/Users/admin/Prj',
          agent_path: '/root/reviewer',
        }),
        record('event_msg', { type: 'task_started' }),
        record('event_msg', { type: 'task_complete' }),
      ],
      new Date(Date.now() - 12 * 60 * 60 * 1000),
    );
    writeSession(root, 'unrelated', [
      record('session_meta', { id: 'elsewhere', cwd: '/tmp/other' }),
      record('event_msg', { type: 'task_started' }),
    ]);
    writeSession(
      root,
      'expired-completed',
      [
        record('session_meta', { id: 'expired', cwd: '/Users/admin/Prj' }),
        record('event_msg', { type: 'task_started' }),
        record('event_msg', { type: 'task_complete' }),
      ],
      new Date(Date.now() - 25 * 60 * 60 * 1000),
    );

    const sessions = await discoverActiveCodexSessions({
      sessionsRoot: root,
      workspacePath: '/Users/admin/Prj',
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ sessionId: 'done', lifecycle: 'done' });
  });

  it('retains all completed sub-agents from the last 24 hours and never a completed root', async () => {
    const root = tempRoot();
    const now = Date.now();
    for (let i = 0; i < 7; i++) {
      writeSession(
        root,
        `worker-${i}`,
        [
          record('session_meta', {
            id: `worker-${i}`,
            cwd: '/Users/admin/Prj',
            agent_path: `/root/worker_${i}`,
          }),
          record('event_msg', { type: 'task_started' }),
          record('event_msg', { type: 'task_complete' }),
        ],
        new Date(now - i * 1_000),
      );
    }
    writeSession(root, 'completed-root', [
      record('session_meta', { id: 'completed-root', cwd: '/Users/admin/Prj' }),
      record('event_msg', { type: 'task_started' }),
      record('event_msg', { type: 'task_complete' }),
    ]);

    const sessions = await discoverActiveCodexSessions({
      sessionsRoot: root,
      workspacePath: '/Users/admin/Prj',
      now,
    });

    expect(sessions).toHaveLength(7);
    expect(sessions.map((session) => session.sessionId)).toContain('worker-6');
    expect(sessions.map((session) => session.sessionId)).not.toContain('completed-root');
  });
});

describe('CodexSessionScanner', () => {
  it('keeps Done agents, reactivates the same ID, then removes it after expiry', async () => {
    const root = tempRoot();
    const file = writeSession(root, 'active', [
      record('session_meta', {
        id: 'worker-id',
        cwd: '/Users/admin/Prj',
        agent_path: '/root/test_worker',
        agent_nickname: 'Tester',
      }),
      record('event_msg', { type: 'task_started' }),
    ]);
    const store = new AgentStateStore();
    const added = vi.fn();
    const removed = vi.fn();
    const broadcasts = vi.fn();
    store.on('agentAdded', added);
    store.on('agentRemoved', removed);
    store.on('broadcast', broadcasts);
    const scanner = new CodexSessionScanner(store, '/Users/admin/Prj/pixel-agents', root);

    await scanner.scan();
    expect(store.size).toBe(1);
    expect([...store.values()][0]).toMatchObject({
      sessionId: 'worker-id',
      providerId: 'codex',
      folderName: 'Codex · Tester',
      isExternal: true,
    });
    expect(added).toHaveBeenCalledOnce();

    fs.appendFileSync(file, `${record('event_msg', { type: 'task_complete' })}\n`);
    await scanner.scan();
    expect(store.size).toBe(1);
    expect([...store.values()][0]).toMatchObject({
      isWaiting: true,
      folderName: 'Codex · Tester · Done',
    });
    expect(removed).not.toHaveBeenCalled();

    fs.appendFileSync(file, `${record('event_msg', { type: 'task_started' })}\n`);
    await scanner.scan();
    expect(store.size).toBe(1);
    expect([...store.values()][0]).toMatchObject({
      isWaiting: false,
      folderName: 'Codex · Tester',
    });
    expect(broadcasts).toHaveBeenCalledWith({ type: 'agentStatus', id: 1, status: 'active' });

    const expired = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(file, expired, expired);
    await scanner.scan();
    expect(store.size).toBe(0);
    expect(removed).toHaveBeenCalledOnce();
  });
});
