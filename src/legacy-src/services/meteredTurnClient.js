'use strict';

/**
 * Thin wrapper over the Metered TURN Server REST API.
 * Docs: https://www.metered.ca/docs/llms-turn-server.txt
 *
 * Auth model:
 *   - secretKey : account-scoped, SERVER-SIDE ONLY. Creates/deletes credentials
 *                 and reads usage. Never expose to a client.
 *   - apiKey    : credential-scoped, returned by createCredential. Used here
 *                 (server-side) to resolve the ICE server list; only the
 *                 resulting iceServers array is returned to clients.
 *
 * Requires Node 18+ (global fetch / AbortController).
 */

const baseUrl = (appName) => `https://${appName}.metered.live/api`;

class MeteredTurnClient {
  constructor({ appName, secretKey, timeoutMs = 8000 } = {}) {
    if (!appName) throw new Error('MeteredTurnClient: appName (METERED_APP_NAME) is required');
    if (!secretKey) throw new Error('MeteredTurnClient: secretKey (METERED_SECRET_KEY) is required');
    this.appName = appName;
    this.secretKey = secretKey;
    this.timeoutMs = timeoutMs;
    this.base = baseUrl(appName);
  }

  async _request(method, path, { query = {}, body } = {}) {
    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

      if (!res.ok) {
        const err = new Error(`Metered ${method} ${path} -> ${res.status}`);
        err.status = res.status;
        err.body = data;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  // Create a TURN credential that auto-disables after `expiryInSeconds` (24h = 86400).
  createCredential({ expiryInSeconds = 86400, label } = {}) {
    return this._request('POST', '/v1/turn/credential', {
      query: { secretKey: this.secretKey },
      body: { expiryInSeconds, ...(label ? { label } : {}) },
    });
  }

  // Resolve the ICE server list for a credential-scoped apiKey.
  getIceServers(apiKey, { region } = {}) {
    return this._request('GET', '/v1/turn/credentials', { query: { apiKey, region } });
  }

  // Total relayed usage (GB) for one credential username.
  getCurrentUsage(username) {
    return this._request('GET', '/v1/turn/current_usage_for_user', {
      query: { secretKey: this.secretKey, username },
    });
  }

  // Daily usage per user, paginated (7 days/page). Metered rate limit: 4 req/min.
  getDailyUsage({ startDate, endDate, page } = {}) {
    return this._request('GET', '/v2/turn/usage_daily_by_user', {
      query: { secretKey: this.secretKey, startDate, endDate, page },
    });
  }

  // List credentials (active by default; all=true includes expired).
  listCredentials({ all, page, label } = {}) {
    return this._request('GET', '/v2/turn/credentials', {
      query: { secretKey: this.secretKey, all, page, label },
    });
  }

  // Delete a single credential by username.
  deleteCredential(username) {
    return this._request('DELETE', '/v1/turn/credential', {
      query: { secretKey: this.secretKey },
      body: { username },
    });
  }

  // Delete all active credentials matching a label.
  deleteCredentialsByLabel(label) {
    return this._request('DELETE', '/v2/turn/credential/by_label', {
      query: { secretKey: this.secretKey, label },
    });
  }
}

module.exports = { MeteredTurnClient };
