import { Router, Request, Response } from "express";
import axios from "axios";
import { optionalAuth } from "./music.legacy-adapters";

const router = Router();
const JAMENDO_BASE = "https://api.jamendo.com/v3.0/tracks";

/**
 * GET /api/music/search?q=...&limit=20
 * Proxies to Jamendo API so we don't expose client_id in frontend.
 * Returns tracks: { id, name, artist_name, album_image, audio, duration }
 */
router.get("/search", optionalAuth, async (req: Request, res: Response) => {
  try {
    const clientId = process.env.JAMENDO_CLIENT_ID;
    if (!clientId) {
      return res.status(200).json({
        success: true,
        tracks: [],
        message: "Music search not configured. Add JAMENDO_CLIENT_ID to .env (get free key at https://devportal.jamendo.com)"
      });
    }

    const q = (String(req.query.q || "")).trim();
    const tags = (String(req.query.tags || "")).trim();
    const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 50);

    if (!q && !tags) {
      return res.status(200).json({ success: true, tracks: [] });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(limit),
      order: "relevance_desc",
      audioformat: "mp32"
    });
    if (q) params.set("search", q);
    if (tags) params.set("tags", tags.replace(/\s+/g, "+"));

    const { data } = await axios.get(`${JAMENDO_BASE}/?${params.toString()}`, {
      timeout: 10000,
      headers: { Accept: "application/json" }
    });

    const results = (data as { results?: Array<Record<string, unknown>> }).results || [];
    const tracks = results.map((t: Record<string, unknown>) => ({
      trackId: String(t.id),
      title: t.name || "Unknown",
      artist: t.artist_name || "Unknown",
      url: t.audio || "",
      coverUrl: t.album_image || t.image || "",
      duration: t.duration || 0
    }));

    return res.json({ success: true, tracks });
  } catch (err) {
    const axiosError = err as { response?: { status?: number }; message?: string };
    if (axiosError.response && axiosError.response.status === 429) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Try again in a minute."
      });
    }
    console.error("Music search error:", axiosError.message);
    return res.status(500).json({
      success: false,
      message: "Music search failed. Try again."
    });
  }
});

export default router;
