export const redisOptions = (redisUrl: string) => {
  const url = new URL(redisUrl);
  // An absent database number ("redis://host") must not emit `database: 0`,
  // so an empty path segment is kept unparsable instead of coercing to 0.
  const databaseSegment = url.pathname.slice(1);
  const database =
    databaseSegment === "" ? Number.NaN : Number(databaseSegment);

  // node-redis (used by @effect/platform-node NodeRedis since effect
  // rc.112, previously ioredis) expects `socket.host/port` and `database`,
  // not the flat ioredis `host/port` + `db` shape. A flat shape is silently
  // ignored and falls back to localhost:6379.
  return {
    socket: {
      host: url.hostname,
      port: Number(url.port) || 6379,
      ...(url.protocol === "rediss:" && { tls: true as const }),
    },
    ...(url.username && { username: decodeURIComponent(url.username) }),
    ...(url.password && { password: decodeURIComponent(url.password) }),
    ...(Number.isInteger(database) &&
      database >= 0 && { database }),
  };
};
