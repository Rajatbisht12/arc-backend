import { env } from "./env";

const OFFICIAL_FRONTEND_ORIGINS = Object.freeze([
  // Canonical production Web/Admin origins.
  "https://squadhunt.com",
  "https://www.squadhunt.com",
  "https://admin.squadhunt.com",
  // Temporary compatibility for the legacy public/admin deployments. Remove
  // only after the .in hosts are permanent redirects and no longer run the app.
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
