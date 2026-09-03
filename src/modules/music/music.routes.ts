import { Router, Request, Response } from "express";
import axios from "axios";
import {
  optionalAuth,
  protect,
  uploadSingle,
  uploadUserAudio,
  listMyAudio,
  removeUserAudio,
} from "./music.legacy-adapters";

const router = Router();
const JAMENDO_BASE = "https://api.jamendo.com/v3.0/tracks";

interface TrackResult {
  trackId: string;
  title: unknown;
  artist: unknown;
  url: unknown;
  coverUrl: unknown;
  duration: unknown;
  source: string;
  genre?: unknown;
  mood?: unknown;
  style?: unknown;
  category?: unknown;
  tags?: unknown;
  keywords?: unknown;
}

const FALLBACK_SEARCH_METADATA: Record<string, Partial<TrackResult>> = {
  "fb-1": { genre: "Gaming", mood: "Energetic", style: "Cinematic", tags: ["action", "battle", "music"] },
  "fb-2": { genre: "Gaming", style: "Cinematic", tags: ["arena", "battle", "music"] },
  "fb-3": { genre: "Gaming", mood: "Energetic", tags: ["action", "battle", "music"] },
  "fb-4": { genre: "Electronic", mood: "Energetic", tags: ["action", "party", "dance", "music"] },
  "fb-5": { genre: "Gaming", mood: "Emotional", style: "Cinematic", tags: ["sad", "soundtrack", "music"] },
  "fb-6": { genre: "Gaming", style: "Cinematic", tags: ["action", "battle", "soundtrack", "music"] },
  "fb-7": { genre: "Gaming", mood: "Energetic", tags: ["action", "battle", "music"] },
  "fb-8": { genre: "Gaming", mood: "Energetic", tags: ["action", "music"] },
  "fb-9": { genre: "Pop", mood: "Party", style: "Electronic", tags: ["dance", "party", "pop", "music"] },
  "fb-10": { genre: "Gaming", mood: "Energetic", style: "Cinematic", tags: ["action", "battle", "soundtrack", "music"] },
  "fb-11": { genre: "Hip Hop", mood: "Focused", tags: ["hiphop", "gaming", "music"] },
  "fb-12": { genre: "Gaming", mood: "Energetic", tags: ["action", "battle", "music"] },
  "fb-13": { genre: "Gaming", mood: "Celebration", tags: ["victory", "party", "music"] },
  "fb-14": { genre: "Gaming", mood: "Focused", tags: ["action", "battle", "music"] },
  "fb-15": { genre: "Gaming", mood: "Energetic", tags: ["action", "music"] },
};

// Curated fallback tracks returned when external APIs are unavailable
const FALLBACK_TRACKS: TrackResult[] = [
  { trackId: "fb-1",  title: "Victory Run",    artist: "Gaming Beats",   url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",  coverUrl: "", duration: 372, source: "demo" },
  { trackId: "fb-2",  title: "Arena",          artist: "Arc Studio",     url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",  coverUrl: "", duration: 221, source: "demo" },
  { trackId: "fb-3",  title: "Clutch Moment",  artist: "BGMI Vibes",     url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",  coverUrl: "", duration: 204, source: "demo" },
  { trackId: "fb-4",  title: "Drop Zone",      artist: "Gaming Beats",   url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",  coverUrl: "", duration: 407, source: "demo" },
  { trackId: "fb-5",  title: "Final Circle",   artist: "Arc Studio",     url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",  coverUrl: "", duration: 183, source: "demo" },
  { trackId: "fb-6",  title: "Sniper View",    artist: "War Zone",       url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",  coverUrl: "", duration: 291, source: "demo" },
  { trackId: "fb-7",  title: "Squad Wipe",     artist: "Gaming Beats",   url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",  coverUrl: "", duration: 375, source: "demo" },
  { trackId: "fb-8",  title: "Rank Push",      artist: "Arc Studio",     url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",  coverUrl: "", duration: 319, source: "demo" },
  { trackId: "fb-9",  title: "Neon Rush",      artist: "Electric Gamer", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3",  coverUrl: "", duration: 204, source: "demo" },
  { trackId: "fb-10", title: "Boss Fight",     artist: "War Zone",       url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3", coverUrl: "", duration: 350, source: "demo" },
  { trackId: "fb-11", title: "Midnight Grind", artist: "Pixel Sounds",   url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3", coverUrl: "", duration: 283, source: "demo" },
  { trackId: "fb-12", title: "Headshot",       artist: "Gaming Beats",   url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3", coverUrl: "", duration: 410, source: "demo" },
  { trackId: "fb-13", title: "Chicken Dinner", artist: "Arc Studio",     url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3", coverUrl: "", duration: 188, source: "demo" },
  { trackId: "fb-14", title: "Tactical Push",  artist: "War Zone",       url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3", coverUrl: "", duration: 266, source: "demo" },
  { trackId: "fb-15", title: "Respawn",        artist: "Pixel Sounds",   url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3", coverUrl: "", duration: 335, source: "demo" },
].map(track => ({ ...track, ...FALLBACK_SEARCH_METADATA[track.trackId] }));

const normalizeSearchText = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(normalizeSearchText).filter(Boolean).join(" ");
  if (value == null) return "";
  return String(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const tokenizeSearch = (value: unknown): string[] => {
  const normalized = normalizeSearchText(value);
  return normalized ? [...new Set(normalized.split(" "))] : [];
};

const filterCatalogTracks = (tracks: TrackResult[], q: string, tags: string, limit: number): TrackResult[] => {
  const queryTokens = tokenizeSearch(q);
  const tagTokens = tokenizeSearch(tags);

  return tracks.filter(track => {
    const searchable = normalizeSearchText([
      track.title,
      track.artist,
      track.genre,
      track.mood,
      track.style,
      track.category,
      track.tags,
      track.keywords,
    ]);
    const matchesQuery = queryTokens.every(token => searchable.includes(token));
    const matchesTags = tagTokens.length === 0 || tagTokens.some(token => searchable.includes(token));
    return matchesQuery && matchesTags;
  }).slice(0, limit);
};

const hasDirectPlayableUrl = (track: TrackResult): boolean => {
  const url = typeof track.url === "string" ? track.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return false;

  // SoundCloud API stream URLs require provider-side token/redirect handling
  // and are not a stable direct media URL for Web/RN audio players. Do not
  // expose them as selectable catalog rows until a media proxy/resolver exists.
  if (track.source === "soundcloud" && /api\.soundcloud\.com\/.*\/stream/i.test(url)) {
    return false;
  }

  return true;
};

const searchJamendo = async (q: string, tags: string, limit: number): Promise<TrackResult[]> => {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) return [];

  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: String(limit),
    order: "relevance_desc",
    audioformat: "mp32",
    include: "musicinfo",
  });
  if (q) params.set("search", q);
  if (tags) params.set("tags", tags.replace(/\s+/g, "+"));

  const { data } = await axios.get(`${JAMENDO_BASE}/?${params.toString()}`, {
    timeout: 10000,
    headers: { Accept: "application/json" },
  });

  const results = (data as { results?: Array<Record<string, unknown>> }).results || [];
  return results
    .map((t) => {
      const musicInfo = t.musicinfo as { tags?: Record<string, unknown> } | undefined;
      const providerTags = musicInfo?.tags
        ? Object.values(musicInfo.tags).flatMap(value => Array.isArray(value) ? value : [value])
            .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        : [];
      return ({
        trackId: `jm-${t.id}`,
        title: t.name || "Unknown",
        artist: t.artist_name || "Unknown",
        url: t.audio || "",
        coverUrl: t.album_image || t.image || "",
        duration: t.duration || 0,
        source: "jamendo",
        genre: providerTags[0],
        tags: providerTags,
      });
    })
    .filter(hasDirectPlayableUrl);
};

const searchSoundCloud = async (q: string, limit: number): Promise<TrackResult[]> => {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret || !q) return [];

  try {
    // Exchange client credentials for an access token
    const tokenRes = await axios.post(
      "https://api.soundcloud.com/oauth2/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 8000 }
    );
    const accessToken = (tokenRes.data as { access_token?: string })?.access_token;
    if (!accessToken) return [];

    type SCTrack = {
      id: number;
      title?: string;
      streamable?: boolean;
      stream_url?: string;
      duration?: number;
      artwork_url?: string;
      user?: { username?: string; avatar_url?: string };
      genre?: string;
      tag_list?: string;
    };

    const params = new URLSearchParams({ q, limit: String(limit), linked_partitioning: "1" });
    const { data } = await axios.get(`https://api.soundcloud.com/tracks?${params.toString()}`, {
      timeout: 8000,
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    });

    const collection: SCTrack[] = Array.isArray(data)
      ? data
      : ((data as { collection?: SCTrack[] }).collection || []);

    return collection
      .filter((t) => t.streamable && t.stream_url)
      .map((t) => ({
        trackId: `sc-${t.id}`,
        title: t.title || "Unknown",
        artist: t.user?.username || "Unknown",
        url: `${t.stream_url}?oauth_token=${accessToken}`,
        coverUrl: (t.artwork_url || t.user?.avatar_url || "").replace("-large", "-t300x300"),
        duration: Math.floor((t.duration || 0) / 1000),
        source: "soundcloud",
        genre: t.genre,
        tags: typeof t.tag_list === "string" ? t.tag_list.split(/\s+/).filter(Boolean) : [],
      }));
  } catch (err) {
    console.warn("SoundCloud search skipped:", (err as { response?: { status?: number }; message?: string }).response?.status || (err as Error).message);
    return [];
  }
};

/**
 * GET /api/music/search?q=...&tags=...&limit=20
 * Queries Jamendo and SoundCloud in parallel and merges results.
 */
router.get("/search", optionalAuth, async (req: Request, res: Response) => {
  try {
    const q = (String(req.query.q || "")).trim();
    const tags = (String(req.query.tags || "")).trim();
    const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 50);
    const jamendoConfigured = !!process.env.JAMENDO_CLIENT_ID;
    const soundcloudConfigured = !!process.env.SOUNDCLOUD_CLIENT_ID;

    if (!jamendoConfigured && !soundcloudConfigured) {
      return res.status(200).json({
        success: true,
        tracks: filterCatalogTracks(FALLBACK_TRACKS, q, tags, limit),
        fallback: true,
        message: "Music search not configured. Add JAMENDO_CLIENT_ID or SOUNDCLOUD_CLIENT_ID to environment.",
      });
    }

    if (!q && !tags) {
      return res.status(200).json({ success: true, tracks: FALLBACK_TRACKS.slice(0, limit) });
    }

    const bothActive = jamendoConfigured && soundcloudConfigured;
    const perSource = bothActive ? Math.ceil(limit / 2) : limit;

    const [jamendoResult, soundcloudResult] = await Promise.allSettled([
      jamendoConfigured ? searchJamendo(q, tags, perSource) : Promise.resolve([]),
      soundcloudConfigured && (q || tags)
        ? searchSoundCloud([q, tags].filter(Boolean).join(" "), perSource)
        : Promise.resolve([]),
    ]);

    if (jamendoResult.status === "rejected") {
      console.error("Jamendo error:", (jamendoResult.reason as Error)?.message);
    }
    if (soundcloudResult.status === "rejected") {
      console.error("SoundCloud error:", (soundcloudResult.reason as Error)?.message);
    }

    const jamendoTracks = jamendoResult.status === "fulfilled" ? jamendoResult.value : [];
    const soundcloudTracks = soundcloudResult.status === "fulfilled" ? soundcloudResult.value : [];

    // Interleave: SC, Jamendo, SC, Jamendo... so both sources appear near the top
    const merged: TrackResult[] = [];
    const maxLen = Math.max(jamendoTracks.length, soundcloudTracks.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < soundcloudTracks.length) merged.push(soundcloudTracks[i]);
      if (i < jamendoTracks.length) merged.push(jamendoTracks[i]);
    }

    // If both APIs returned nothing, return curated fallback tracks
    const playableTracks = merged.filter(hasDirectPlayableUrl);
    const results = playableTracks.length > 0
      ? playableTracks.slice(0, limit)
      : filterCatalogTracks(FALLBACK_TRACKS, q, tags, limit);
    return res.json({ success: true, tracks: results, fallback: playableTracks.length === 0 });
  } catch (err) {
    const axiosError = err as { response?: { status?: number }; message?: string };
    if (axiosError.response?.status === 429) {
      return res.status(429).json({ success: false, message: "Too many requests. Try again in a minute." });
    }
    console.error("Music search error:", axiosError.message);
    return res.status(500).json({ success: false, message: "Music search failed. Try again." });
  }
});

/**
 * User-uploaded audio (distinct from the licensed catalog above).
 * All routes require authentication — uploads are owned by the caller.
 *
 *   POST   /api/music/upload        multipart field `music` = audio file
 *   GET    /api/music/upload/mine   the caller's own uploads
 *   DELETE /api/music/upload/:id    owner-only soft removal
 *
 * `uploadSingle('music')` reuses the existing multer memory-storage config
 * (50MB hard cap + audio-only fileFilter); the controller then enforces the
 * shared audio policy (MIME allow-list + configured size/duration limits).
 */
router.post("/upload", protect, uploadSingle("music"), uploadUserAudio);
router.get("/upload/mine", protect, listMyAudio);
router.delete("/upload/:id", protect, removeUserAudio);

export default router;
