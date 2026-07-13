import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { AssetCache, SetHooksEnabledSideEffect } from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import { HOOK_API_PREFIX, MAX_HOOK_BODY_SIZE } from './constants.js';
import type { RemoteAgentRegistry, RemoteAgentUpdate } from './remoteAgentRegistry.js';
import type { AgentState } from './types.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** Separate bearer token for remote-PC telemetry/control API. */
  remoteApiToken: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Authenticated external-PC agent state registry. */
  remoteAgentRegistry?: RemoteAgentRegistry;
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    logger: !options.embedded,
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerHookRoute(app, options);
  registerRemoteAgentRoutes(app, options);
  registerWebSocketRoute(app, options);

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Remote Agent API ───────────────────────────────────────────

const REMOTE_ID_PATTERN = '^[A-Za-z0-9._-]{1,64}$';

function registerRemoteAgentRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  const registry = options.remoteAgentRegistry;
  if (!registry) return;
  const auth = bearerAuth(options.remoteApiToken);
  const paramsSchema = {
    type: 'object',
    properties: {
      hostId: { type: 'string', pattern: REMOTE_ID_PATTERN },
      agentId: { type: 'string', pattern: REMOTE_ID_PATTERN },
    },
    required: ['hostId', 'agentId'],
  } as const;
  const bodySchema = {
    type: 'object',
    additionalProperties: false,
    required: ['displayName', 'task', 'status'],
    properties: {
      displayName: { type: 'string', minLength: 1, maxLength: 80 },
      task: { type: 'string', minLength: 1, maxLength: 80 },
      status: { type: 'string', enum: ['active', 'waiting', 'done'] },
      activity: { type: 'string', maxLength: 120 },
      heartbeatTtlSeconds: { type: 'integer', minimum: 15, maximum: 3600 },
      progress: {
        type: 'object',
        additionalProperties: false,
        required: ['current', 'total'],
        properties: {
          current: { type: 'number', minimum: 0 },
          total: { type: 'number', exclusiveMinimum: 0 },
          unit: { type: 'string', maxLength: 24 },
        },
      },
      parent: {
        type: 'object',
        additionalProperties: false,
        required: ['hostId', 'agentId'],
        properties: {
          hostId: { type: 'string', pattern: REMOTE_ID_PATTERN },
          agentId: { type: 'string', pattern: REMOTE_ID_PATTERN },
        },
      },
    },
  } as const;

  app.get('/api/remote/v1/agents', { preHandler: auth }, async () => ({
    agents: registry.list(),
  }));

  app.put<{
    Params: { hostId: string; agentId: string };
    Body: RemoteAgentUpdate;
  }>(
    '/api/remote/v1/hosts/:hostId/agents/:agentId',
    { preHandler: auth, schema: { params: paramsSchema, body: bodySchema } },
    async (request, reply) => {
      if (request.body.progress && request.body.progress.current > request.body.progress.total) {
        return reply.code(400).send({ error: 'progress_current_exceeds_total' });
      }
      return registry.upsert(request.params.hostId, request.params.agentId, request.body);
    },
  );

  app.delete<{ Params: { hostId: string; agentId: string } }>(
    '/api/remote/v1/hosts/:hostId/agents/:agentId',
    { preHandler: auth, schema: { params: paramsSchema } },
    async (request, reply) => {
      if (!registry.remove(request.params.hostId, request.params.agentId)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.code(204).send();
    },
  );
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // Embedded VS Code clients authenticate the WebSocket itself. Standalone
    // viewers connect without a token and are therefore always read-only.
    if (options.embedded) {
      const auth = request.headers.authorization ?? '';
      const expected = `Bearer ${options.token}`;
      const authBuf = Buffer.from(auth);
      const expectedBuf = Buffer.from(expected);
      if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
        socket.close(4001, 'unauthorized');
        return;
      }
    }

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        folderName: agent.folderName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
      });
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      safeSend(socket, message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        // An unauthenticated standalone viewer may subscribe to the office but
        // never mutate server settings. This remains safe behind a local reverse
        // proxy, where every peer can otherwise appear to come from loopback.
        if (!options.embedded && msg.type !== 'webviewReady') {
          return;
        }
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${expectedToken}`;
    const authBuf = Buffer.from(auth);
    const expectedBuf = Buffer.from(expected);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
