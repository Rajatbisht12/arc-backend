import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): Response | void => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, message: "Missing auth token" });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { id?: string; userId?: string };
    const userId = decoded.id ?? decoded.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Invalid token payload" });
    }
    req.userId = String(userId);
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: "Invalid auth token" });
  }
};
