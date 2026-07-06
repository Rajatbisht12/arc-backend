'use strict';

const { MeteredTurnClient } = require('./meteredTurnClient');

const EXPIRY_SECONDS = 86400; // 24 hours

// Served when Metered is unreachable so calls degrade gracefully instead of
// failing outright (mirrors the client-side STUN + OpenRelay fallback).
const FALLBACK_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/**
 * Manages a shared TURN credential that auto-expires after 24h and is
 * proactively rotated before expiry. Every client requesting ICE within a 24h
 * window shares one credential, keeping the credential count and per-credential
 * usage reporting clean.
 *
 * For per-user usage attribution instead, call `mintCredential(userId)` and
 * return that credential's iceServers directly from your route.
 */
class TurnService {
  constructor({ appName, secretKey, rotateMarginSeconds = 3600, label = 'arc-turn', logger = console } = {}) {
    this.client = new MeteredTurnClient({ appName, secretKey });
    this.rotateMarginMs = rotateMarginSeconds * 1000;
    this.labelPrefix = label;
    this.logger = logger;
    this._cache = null;      // { username, apiKey, iceServers, label, expiresAt }
    this._inflight = null;   // de-dupes concurrent rotations
    this._monitorTimer = null;
  }

  /** Returns { iceServers, source, username?, expiresAt? } for a WebRTC client. */
  async getIceServers() {
    try {
      const cred = await this._getFreshCredential();
      return {
        iceServers: cred.iceServers,
        source: 'metered',
        username: cred.username,
        expiresAt: new Date(cred.expiresAt).toISOString(),
      };
    } catch (err) {
      this.logger.warn?.('[turn] Metered unavailable — serving fallback ICE:', err?.message || err);
      return { iceServers: FALLBACK_ICE, source: 'fallback' };
    }
  }

  async _getFreshCredential() {
    const now = Date.now();
    if (this._cache && this._cache.expiresAt - this.rotateMarginMs > now) {
      return this._cache;
    }
    if (this._inflight) return this._inflight;
    this._inflight = this._rotate().finally(() => { this._inflight = null; });
    return this._inflight;
  }

  async _rotate() {
    const cred = await this.mintCredential(`${this.labelPrefix}-${new Date().toISOString().slice(0, 10)}`);
    this._cache = cred;
    this.logger.info?.(
      `[turn] rotated credential username=${cred.username} label=${cred.label} (expires in 24h)`,
    );
    return cred;
  }

  /** Create one credential (24h auto-expire) and resolve its ICE server list. */
  async mintCredential(label) {
    const created = await this.client.createCredential({ expiryInSeconds: EXPIRY_SECONDS, label });
    const iceServers = await this.client.getIceServers(created.apiKey);
    return {
      username: created.username,
      apiKey: created.apiKey,
      iceServers,
      label,
      expiresAt: Date.now() + EXPIRY_SECONDS * 1000,
    };
  }

  // ── Usage monitoring ──────────────────────────────────────────────────────
  usageForUser(username) { return this.client.getCurrentUsage(username); }
  dailyUsage(opts) { return this.client.getDailyUsage(opts); }
  listCredentials(opts) { return this.client.listCredentials(opts); }
  deleteCredential(username) { return this.client.deleteCredential(username); }

  /**
   * Periodically log the active credential's relayed GB. Returns a stop fn.
   * Pass intervalMinutes = 0 to disable.
   */
  startUsageMonitor({ intervalMinutes = 15 } = {}) {
    if (!intervalMinutes || intervalMinutes <= 0) return () => {};
    const tick = async () => {
      const username = this._cache?.username;
      if (!username) return;
      try {
        const { usageInGB } = await this.usageForUser(username);
        this.logger.info?.(`[turn] usage username=${username}: ${usageInGB} GB relayed`);
      } catch (err) {
        this.logger.warn?.('[turn] usage monitor error:', err?.message || err);
      }
    };
    this._monitorTimer = setInterval(tick, intervalMinutes * 60 * 1000);
    this._monitorTimer.unref?.();
    return () => { if (this._monitorTimer) clearInterval(this._monitorTimer); };
  }
}

module.exports = { TurnService, FALLBACK_ICE };
