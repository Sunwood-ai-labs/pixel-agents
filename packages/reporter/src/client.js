import {
  REMOTE_API_PREFIX,
  remoteAgentPath,
  validateRemoteAgentUpdate,
} from '@pixel-agents/remote-protocol';

export class ReporterClient {
  constructor({ serverUrl, token, fetchImpl = globalThis.fetch }) {
    if (!serverUrl) throw new TypeError('serverUrl is required');
    if (!token) throw new TypeError('PIXEL_AGENTS_REMOTE_API_TOKEN is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch is unavailable');
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }

  publish(hostId, agentId, update) {
    validateRemoteAgentUpdate(update);
    return this.request(remoteAgentPath(hostId, agentId), { method: 'PUT', body: update });
  }

  list() {
    return this.request(`${REMOTE_API_PREFIX}/agents`, { method: 'GET' });
  }

  remove(hostId, agentId) {
    return this.request(remoteAgentPath(hostId, agentId), { method: 'DELETE' });
  }

  async request(path, { method, body }) {
    const response = await this.fetch(`${this.serverUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      const safeBody =
        typeof payload === 'string' ? payload.slice(0, 500) : JSON.stringify(payload);
      throw new Error(`Pixel Agents Hub API ${response.status}: ${redact(safeBody, this.token)}`);
    }
    return payload;
  }
}

function redact(value, secret) {
  return String(value ?? '')
    .split(secret)
    .join('[REDACTED]');
}
