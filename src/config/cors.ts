import { env } from "./env";

const OFFICIAL_FRONTEND_ORIGINS = Object.freeze([
  "https://squadhunt.in",
  "https://www.squadhunt.in",
  "https://admin.squadhunt.in"
]);

export const getAllowedOrigins = (): string[] => [...new Set([
  ...env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
  ...OFFICIAL_FRONTEND_ORIGINS
])];

export const isAllowedOrigin = (origin: string): boolean => getAllowedOrigins().includes(origin);

export { OFFICIAL_FRONTEND_ORIGINS };
