const DEFAULT_SESSION_COOKIE_NAME = "better-auth.session_token";
const SECURE_SESSION_COOKIE_NAME = `__Secure-${DEFAULT_SESSION_COOKIE_NAME}`;

export const getSessionCookieName = () => {
  const AppUrl = process.env.APP_URL;

  return AppUrl?.startsWith("https://")
    ? SECURE_SESSION_COOKIE_NAME
    : DEFAULT_SESSION_COOKIE_NAME;
};
