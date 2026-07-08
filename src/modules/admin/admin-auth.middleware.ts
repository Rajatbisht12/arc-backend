import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

interface AdminJwtPayload {
  isHardcodedAdmin?: boolean;
  tokenUse?: string;
  username?: string;
  adminRole?: string;
  adminPermissions?: string[];
}

/**
 * Middleware that protects admin routes.
 * Accepts only tokens issued by the /api/admin/auth/login endpoint
 * (i.e., tokens whose payload contains `isHardcodedAdmin: true`).
 *
 * Also injects a synthetic req.user so that legacy controller code that
 * reads req.user._id / req.user.username / req.user.userType / req.user.isSuperUser
 * works without crashing (it simply won't have a real MongoDB _id).
 */
export const requireHardcodedAdminAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): Response | void => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  if (!env.ADMIN_JWT_SECRET) {
    return res.status(503).json({ success: false, message: "Admin authentication is not configured." });
  }

  try {
    const decoded = jwt.verify(token, env.ADMIN_JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "squadhunt-admin",
      audience: "squadhunt-admin-panel",
    }) as AdminJwtPayload;

    if (!decoded.isHardcodedAdmin || decoded.tokenUse !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required." });
    }

    // Inject a synthetic req.user so legacy controllers that reference
    // req.user._id, req.user.username, etc. do not throw a TypeError.
    // _id is null (no real MongoDB user exists for the hardcoded admin).
    (req as any).user = {
      _id: null,
      username: decoded.username ?? "admin",
      userType: "admin",
      isSuperUser: true,
      adminRole: decoded.adminRole ?? "super_admin",
      adminPermissions: decoded.adminPermissions ?? ["*"],
    };

    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired admin token." });
  }
};
