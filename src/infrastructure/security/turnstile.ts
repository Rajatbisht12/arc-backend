import type { Request, RequestHandler } from "express";
import { env } from "../../config/env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const WEB_ORIGINS = new Set(["https://squadhunt.com", "https://www.squadhunt.com"]);

type SiteverifyResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

const allowedHostnames = () => new Set(
  env.TURNSTILE_ALLOWED_HOSTNAMES.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
);

export const isProtectedWebAuthRequest = (req: Pick<Request, "get">) => {
  const origin = req.get("origin");
  return Boolean(origin && WEB_ORIGINS.has(origin.toLowerCase()));
};

export const isValidTurnstileResult = (
  result: SiteverifyResult,
  expectedAction: string,
  hostnames: Set<string>,
) => Boolean(
  result.success
  && result.hostname
  && hostnames.has(result.hostname.toLowerCase())
  && result.action === expectedAction,
);

const verifyToken = async (token: string, remoteIp: string | undefined): Promise<SiteverifyResult> => {
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY || "",
    response: token,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Turnstile Siteverify returned HTTP ${response.status}`);
  return response.json() as Promise<SiteverifyResult>;
};

export const turnstileWebAuthGuard = (expectedAction = "web_auth"): RequestHandler => async (req, res, next) => {
  if (env.TURNSTILE_MODE === "off" || !isProtectedWebAuthRequest(req)) return next();

  const token = typeof req.body?.turnstileToken === "string" ? req.body.turnstileToken.trim() : "";
  let accepted = false;
  let reason = "missing-token";

  if (token && token.length <= 4096) {
    try {
      const result = await verifyToken(token, req.ip);
      accepted = isValidTurnstileResult(result, expectedAction, allowedHostnames());
      reason = accepted ? "verified" : "siteverify-rejected";
    } catch (error) {
      reason = "siteverify-unavailable";
      console.error("Turnstile verification unavailable", { error: (error as Error).message });
    }
  }

  delete req.body?.turnstileToken;
  if (accepted) return next();

  if (env.TURNSTILE_MODE === "observe") {
    console.warn("Turnstile Web auth verification observed", {
      path: req.path,
      reason,
      origin: req.get("origin") || "",
    });
    return next();
  }

  return res.status(403).json({
    success: false,
    error: "TURNSTILE_REQUIRED",
    message: "Please complete the security verification and try again.",
  });
};
