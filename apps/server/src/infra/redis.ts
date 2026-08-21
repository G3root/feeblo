export const redisOptions = (redisUrl: string) => {
  const url = new URL(redisUrl);
  // An absent database number ("redis://host") must not emit `db: 0`, so an
  // empty path segment is kept unparsable instead of coercing to 0.
  const databaseSegment = url.pathname.slice(1);
  const database =
    databaseSegment === "" ? Number.NaN : Number(databaseSegment);

  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.username && { username: decodeURIComponent(url.username) }),
    ...(url.password && { password: decodeURIComponent(url.password) }),
    ...(Number.isInteger(database) && database >= 0 && { db: database }),
    ...(url.protocol === "rediss:" && { tls: {} }),
  };
};
