export const redisOptions = (redisUrl: string) => {
  const url = new URL(redisUrl);
  const database = Number(url.pathname.slice(1));

  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.username && { username: decodeURIComponent(url.username) }),
    ...(url.password && { password: decodeURIComponent(url.password) }),
    ...(Number.isInteger(database) && database >= 0 && { db: database }),
    ...(url.protocol === "rediss:" && { tls: {} }),
  };
};
