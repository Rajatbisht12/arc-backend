import { createHash } from "crypto";
import type { IncomingMessage } from "http";
import { CLOUDFLARE_ORIGIN_AUTH_HEADER, hasValidCloudflareOriginAuth } from "./cloudflareOrigin";

type RedisCounter = {
  isReady: boolean;
  multi: () => {
    incr: (key: string) => unknown;
    expire: (key: string, seconds: number) => unknown;
    exec: () => Promise<unknown[]>;
  };
};

type SocketConnectionGuardOptions = {
  redis: RedisCounter;
  windowSeconds: number;
  maxConnectionsPerWindow: number;
  originAuthSecret?: string;
};

type LocalCounter = {
  count: number;
  expiresAt: number;
};

const normalizeAddress = (value: string): string => value.trim().replace(/^::ffff:/, "");

const headerValue = (value: string | string[] | undefined): string | undefined => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
};

export const getSocketClientIp = (request: IncomingMessage, originAuthSecret?: string): string => {
  const originCredential = request.headers[CLOUDFLARE_ORIGIN_AUTH_HEADER];
  if (hasValidCloudflareOriginAuth(originAuthSecret, originCredential)) {
    const connectingIp = headerValue(request.headers["cf-connecting-ip"]);
    if (connectingIp) return normalizeAddress(connectingIp);
  }

  // The ECS task security group only admits the ALB. Selecting the right-most
  // address prevents a direct client from choosing a spoofed left-most XFF.
  const forwardedFor = headerValue(request.headers["x-forwarded-for"]);
  if (forwardedFor) {
    const addresses = forwardedFor.split(",").map(normalizeAddress).filter(Boolean);
    if (addresses.length > 0) return addresses[addresses.length - 1];
  }

  return normalizeAddress(request.socket.remoteAddress || "unknown");
};

const counterKey = (ip: string): string => {
  const digest = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  return `rl:socket-connect:${digest}`;
};

export class SocketConnectionGuard {
  private readonly localCounters = new Map<string, LocalCounter>();

  constructor(private readonly options: SocketConnectionGuardOptions) {}

  async allow(request: IncomingMessage): Promise<boolean> {
    const ip = getSocketClientIp(request, this.options.originAuthSecret);
    const key = counterKey(ip);

    if (this.options.redis.isReady) {
      try {
        const transaction = this.options.redis.multi();
        transaction.incr(key);
        transaction.expire(key, this.options.windowSeconds);
        const result = await transaction.exec();
        const count = Number(result[0]);
        if (Number.isFinite(count)) return count <= this.options.maxConnectionsPerWindow;
      } catch {
        // Redis failures fall through to the bounded in-process guard. The
        // connection path remains available while still resisting local floods.
      }
    }

    return this.allowLocally(key);
  }

  private allowLocally(key: string): boolean {
    const now = Date.now();
    const current = this.localCounters.get(key);
    const entry = !current || current.expiresAt <= now
      ? { count: 1, expiresAt: now + this.options.windowSeconds * 1000 }
      : { count: current.count + 1, expiresAt: current.expiresAt };
    this.localCounters.set(key, entry);

    if (this.localCounters.size > 5_000) {
      for (const [candidateKey, candidate] of this.localCounters) {
        if (candidate.expiresAt <= now) this.localCounters.delete(candidateKey);
        if (this.localCounters.size <= 4_000) break;
      }
    }

    return entry.count <= this.options.maxConnectionsPerWindow;
  }
}
