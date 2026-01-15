import { Queue } from "bullmq";

import type { ConnectionOptions } from "bullmq";

function connectionFromRedisUrl(redisUrl: string): ConnectionOptions {
  let url: URL;
  try {
    url = new URL(redisUrl);
  } catch {
    throw new Error("Invalid REDIS_URL (expected redis:// or rediss://)");
  }

  const useTls = url.protocol === "rediss:";

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    tls: useTls ? {} : undefined,
  };
}

function connectionFromRedisParts(): ConnectionOptions {
  const host = process.env.REDIS_HOST;
  const portRaw = process.env.REDIS_PORT;
  const password = process.env.REDIS_PASSWORD;
  const tlsRaw = process.env.REDIS_TLS;

  if (!host || !portRaw || !password) {
    throw new Error(
      "Redis is not configured. Set REDIS_URL or (REDIS_HOST, REDIS_PORT, REDIS_PASSWORD)."
    );
  }

  const portMatch = portRaw.match(/\d+/);
  const port = portMatch ? Number(portMatch[0]) : Number.NaN;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error("Invalid REDIS_PORT");
  }

  const useTls = tlsRaw === "true" || tlsRaw === "1";
  return { host, port, password, tls: useTls ? {} : undefined };
}

export const redisConnection: ConnectionOptions = process.env.REDIS_URL
  ? connectionFromRedisUrl(process.env.REDIS_URL)
  : connectionFromRedisParts();

export const inboundQueue = new Queue("wa_inbound", {
  connection: redisConnection,
});
