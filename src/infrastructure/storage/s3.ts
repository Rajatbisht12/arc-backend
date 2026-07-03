import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { env } from "../../config/env";

const s3 = new S3Client({ region: env.AWS_REGION });

const BUCKET = env.AWS_S3_BUCKET ?? "";
const MAX_REMOTE_AVATAR_BYTES = 5 * 1024 * 1024;
const DEFAULT_REMOTE_AVATAR_HOSTS = ["googleusercontent.com", "res.cloudinary.com"];

export function parseAllowedRemoteAvatarUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== "443") return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const configured = String(process.env.AVATAR_PROXY_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  const allowed = [...DEFAULT_REMOTE_AVATAR_HOSTS, ...configured];
  if (!allowed.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return null;
  return parsed;
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Remote avatar exceeds the allowed size");
  }
  if (!response.body) throw new Error("Remote avatar response is empty");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Remote avatar exceeds the allowed size");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function publicUrl(key: string): string {
  if (env.AWS_S3_CDN_URL) return `${env.AWS_S3_CDN_URL}/${key}`;
  return `https://${BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

function assertBucket(): void {
  if (!BUCKET) throw new Error("AWS_S3_BUCKET is not set");
}

export interface UploadResult {
  url: string;
  publicId: string;
}

function getAudioFileExtension(file: { mimetype?: string; originalname?: string }): string {
  const mimetype = String(file.mimetype || "").toLowerCase();
  const byMime: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
  };
  if (byMime[mimetype]) return byMime[mimetype];

  const name = String(file.originalname || "").toLowerCase();
  const match = name.match(/\.(mp3|m4a|aac|wav|ogg|oga|webm)$/);
  return match?.[1] || "m4a";
}

function getAudioContentType(file: { mimetype?: string; originalname?: string }): string {
  const mimetype = String(file.mimetype || "").toLowerCase();
  if (mimetype.startsWith("audio/")) return mimetype;

  const extension = getAudioFileExtension(file);
  const byExtension: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    webm: "audio/webm",
  };
  return byExtension[extension] || "audio/mp4";
}

export async function uploadImage(
  file: { buffer: Buffer; mimetype?: string },
  folder = "gaming-social",
  opts?: { width?: number; height?: number }
): Promise<UploadResult & { width: number; height: number }> {
  assertBucket();
  const key = `${folder}/${uuidv4()}.webp`;
  let processed: { data: Buffer; info: { width: number; height: number } };
  try {
    processed = await sharp(file.buffer)
      .resize(opts?.width ?? 1200, opts?.height ?? 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
  } catch (cause) {
    const error = new Error("Image could not be processed") as Error & { statusCode?: number; code?: string; cause?: unknown };
    error.statusCode = 422;
    error.code = "INVALID_IMAGE_MEDIA";
    error.cause = cause;
    throw error;
  }
  const { data, info } = processed;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: data,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000",
    })
  );

  return { url: publicUrl(key), publicId: key, width: info.width, height: info.height };
}

export async function uploadAvatar(
  file: { buffer: Buffer },
  folder = "gaming-social/avatars"
): Promise<UploadResult> {
  return uploadImage(file, folder, { width: 400, height: 400 });
}

export async function uploadAvatarFromUrl(
  imageUrl: string,
  folder = "gaming-social/avatars"
): Promise<UploadResult> {
  const allowedUrl = parseAllowedRemoteAvatarUrl(imageUrl);
  if (!allowedUrl) throw new Error("Remote avatar URL is not allowed");
  const res = await fetch(allowedUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`Failed to fetch avatar URL: ${res.status}`);
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("Remote avatar is not an image");
  const buffer = await readBodyWithLimit(res, MAX_REMOTE_AVATAR_BYTES);
  return uploadAvatar({ buffer }, folder);
}

export async function uploadVideo(
  file: { buffer: Buffer },
  folder = "gaming-social"
): Promise<UploadResult & { duration?: number; width?: number; height?: number }> {
  assertBucket();
  const key = `${folder}/${uuidv4()}.mp4`;
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: "video/mp4",
      CacheControl: "public, max-age=31536000, immutable",
    },
  });
  await upload.done();
  return { url: publicUrl(key), publicId: key };
}

export async function uploadAudio(
  file: { buffer: Buffer; mimetype?: string; originalname?: string },
  folder = "gaming-social/audio"
): Promise<UploadResult> {
  assertBucket();
  const extension = getAudioFileExtension(file);
  const key = `${folder}/${uuidv4()}.${extension}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: getAudioContentType(file),
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return { url: publicUrl(key), publicId: key };
}

export async function deleteFile(publicId: string): Promise<void> {
  assertBucket();
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: publicId }));
}

export async function uploadMultipleFiles(
  files: Array<{ buffer: Buffer; mimetype: string }>,
  folder = "gaming-social"
): Promise<Array<{ type: string } & UploadResult>> {
  const results = await Promise.all(
    files.map(async (f) => {
      if (f.mimetype.startsWith("image/")) {
        const r = await uploadImage(f, folder);
        return { type: "image" as const, ...r };
      }
      if (f.mimetype.startsWith("video/")) {
        const r = await uploadVideo(f, folder);
        return { type: "video" as const, ...r };
      }
      if (f.mimetype.startsWith("audio/")) {
        const r = await uploadAudio(f, `${folder}/voice-messages`);
        return { type: "audio" as const, ...r };
      }
      const error = new Error("Unsupported file type") as Error & { statusCode?: number; code?: string };
      error.statusCode = 415;
      error.code = "UNSUPPORTED_MEDIA_TYPE";
      throw error;
    })
  );
  return results;
}
