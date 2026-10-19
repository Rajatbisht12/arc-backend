import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

type S3Sender = Pick<S3Client, "send">;
const createStorageClient = (): S3Sender => new S3Client({ region: env.AWS_REGION, requestChecksumCalculation: "WHEN_REQUIRED" });
let s3: S3Sender = createStorageClient();

const BUCKET = env.AWS_S3_BUCKET ?? "";
const MAX_REMOTE_AVATAR_BYTES = 5 * 1024 * 1024;
const DEFAULT_REMOTE_AVATAR_HOSTS = ["googleusercontent.com", "res.cloudinary.com"];
const PRIVATE_MEDIA_PREFIXES = [
  "gaming-social/messages/",
  "gaming-social/stories/",
  "gaming-social/audio/user-uploads/",
  "post-video-sources/",
  "post-video-playback/",
];
const PUBLIC_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const PRIVATE_MEDIA_CACHE_CONTROL = "private, max-age=900, no-transform";

const cacheControlForKey = (key: string): string => (
  PRIVATE_MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix))
    ? PRIVATE_MEDIA_CACHE_CONTROL
    : PUBLIC_IMMUTABLE_CACHE_CONTROL
);

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

export function publicUrl(key: string): string {
  if (env.AWS_S3_CDN_URL) return `${env.AWS_S3_CDN_URL.replace(/\/$/, "")}/${key}`;
  return `https://${BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

/**
 * Issue a short-lived, read-only URL only after an application endpoint has
 * authorized the viewer. Stored object keys/URLs remain stable in MongoDB;
 * credentials are never persisted or emitted in Socket.IO history.
 */
export async function privateDownloadUrl(key: string, expiresIn = env.PRIVATE_MEDIA_URL_TTL_SECONDS): Promise<string> {
  assertBucket();
  const normalizedKey = String(key || "").replace(/^\/+/, "");
  if (!normalizedKey || normalizedKey.includes("..") || normalizedKey.includes("\\") || normalizedKey.length > 1024) {
    throw new Error("Invalid private media object key");
  }
  const ttl = Math.max(60, Math.min(3600, Number(expiresIn) || env.PRIVATE_MEDIA_URL_TTL_SECONDS));
  return getSignedUrl(
    s3 as S3Client,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: normalizedKey,
      // Override legacy objects that were uploaded with a one-year public
      // cache directive. The signed response must not outlive its bearer URL.
      ResponseCacheControl: PRIVATE_MEDIA_CACHE_CONTROL,
    }),
    { expiresIn: ttl }
  );
}

function assertBucket(): void {
  if (!BUCKET) throw new Error("AWS_S3_BUCKET is not set");
}

export interface UploadResult {
  url: string;
  publicId: string;
  bytes?: number;
  checksumSha256?: string;
  etag?: string;
  contentType?: string;
}

type IntegrityMetadata = {
  jobId?: string;
  outputSha256?: string;
};

type VideoUploadFile = {
  buffer: Buffer;
  duration?: number;
  width?: number;
  height?: number;
  mimetype?: string;
  originalname?: string;
  integrity?: IntegrityMetadata;
};

const normalizeEtag = (value: unknown): string | undefined => {
  const normalized = String(value || "").replace(/^\"|\"$/g, "");
  return normalized || undefined;
};

const digestBuffer = (buffer: Buffer): { hex: string; base64: string } => {
  const hash = createHash("sha256").update(buffer);
  return { hex: hash.copy().digest("hex"), base64: hash.digest("base64") };
};

const digestFile = async (filePath: string): Promise<{ hex: string; base64: string }> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return { hex: hash.copy().digest("hex"), base64: hash.digest("base64") };
};

const storageIntegrityError = (message: string, cause?: unknown): Error & { statusCode?: number; code?: string; cause?: unknown } => {
  const error = new Error(message) as Error & { statusCode?: number; code?: string; cause?: unknown };
  error.statusCode = 503;
  error.code = "STORAGE_INTEGRITY_FAILED";
  error.cause = cause;
  return error;
};

const putVerifiedObject = async ({
  key,
  body,
  contentLength,
  contentType,
  cacheControl,
  checksum,
  metadata,
}: {
  key: string;
  body: Buffer | ReturnType<typeof createReadStream>;
  contentLength: number;
  contentType: string;
  cacheControl: string;
  checksum: { hex: string; base64: string };
  metadata?: Record<string, string>;
}): Promise<{ etag?: string }> => {
  let stored = false;
  try {
    const uploaded = await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentLength: contentLength,
      ContentType: contentType,
      CacheControl: cacheControl,
      ChecksumSHA256: checksum.base64,
      Metadata: { ...metadata, sha256: checksum.hex },
    })) as { ETag?: string; ChecksumSHA256?: string };
    stored = true;
    const head = await s3.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ChecksumMode: "ENABLED",
    })) as { ContentLength?: number; ContentType?: string; ETag?: string; ChecksumSHA256?: string; Metadata?: Record<string, string> };
    if (Number(head.ContentLength) !== contentLength) {
      throw storageIntegrityError(`Stored object length mismatch for ${key}`);
    }
    if (String(head.ContentType || "").toLowerCase() !== contentType.toLowerCase()) {
      throw storageIntegrityError(`Stored object content type mismatch for ${key}`);
    }
    const verifiedChecksum = head.ChecksumSHA256 || uploaded.ChecksumSHA256;
    if (verifiedChecksum && verifiedChecksum !== checksum.base64) {
      throw storageIntegrityError(`Stored object checksum mismatch for ${key}`);
    }
    if (head.Metadata?.sha256 && head.Metadata.sha256 !== checksum.hex) {
      throw storageIntegrityError(`Stored object checksum metadata mismatch for ${key}`);
    }
    return { etag: normalizeEtag(head.ETag || uploaded.ETag) };
  } catch (cause) {
    if (stored) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => undefined);
    }
    if ((cause as { code?: string })?.code === "STORAGE_INTEGRITY_FAILED") throw cause;
    throw storageIntegrityError(`Storage upload or verification failed for ${key}`, cause);
  }
};

export function setS3ClientForTests(client?: S3Sender): void {
  s3 = client || createStorageClient();
}

function getAudioFileExtension(file: { mimetype?: string; originalname?: string }): string {
  const mimetype = String(file.mimetype || "").toLowerCase();
  const byMime: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/x-aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/vnd.wave": "wav",
    "audio/ogg": "ogg",
    "application/ogg": "ogg",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/webm": "webm",
  };
  if (byMime[mimetype]) return byMime[mimetype];

  const name = String(file.originalname || "").toLowerCase();
  const match = name.match(/\.(mp3|m4a|aac|wav|ogg|oga|flac|webm)$/);
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
    flac: "audio/flac",
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
      CacheControl: cacheControlForKey(key),
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
  file: VideoUploadFile,
  folder = "gaming-social"
): Promise<UploadResult & { duration?: number; width?: number; height?: number }> {
  assertBucket();
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw storageIntegrityError("Video upload buffer is empty");
  }
  const rawMimeType = String(file.mimetype || "video/mp4").split(";", 1)[0].trim().toLowerCase();
  const contentType = rawMimeType.startsWith("video/") ? rawMimeType : "video/mp4";
  const extensionByMime: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
    "video/x-msvideo": "avi",
    "video/3gpp": "3gp",
  };
  const originalExtension = String(file.originalname || "").toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  const extension = extensionByMime[contentType] || originalExtension || "video";
  const key = `${folder}/${uuidv4()}.${extension}`;
  const checksum = digestBuffer(file.buffer);
  if (file.integrity?.outputSha256 && file.integrity.outputSha256 !== checksum.hex) {
    throw storageIntegrityError("Processed video changed before storage upload");
  }
  const stored = await putVerifiedObject({
    key,
    body: file.buffer,
    contentLength: file.buffer.length,
    contentType,
    cacheControl: cacheControlForKey(key),
    checksum,
    metadata: file.integrity?.jobId ? { "integrity-job-id": String(file.integrity.jobId).slice(0, 128) } : undefined,
  });
  logger.info("Video storage integrity verified", {
    jobId: file.integrity?.jobId,
    publicId: key,
    bytes: file.buffer.length,
    contentType,
    checksumSha256: checksum.hex,
    etag: stored.etag,
  });
  return {
    url: publicUrl(key),
    publicId: key,
    bytes: file.buffer.length,
    checksumSha256: checksum.hex,
    etag: stored.etag,
    contentType,
    ...(Number.isFinite(file.duration) && Number(file.duration) > 0 ? { duration: Number(file.duration) } : {}),
    ...(Number.isFinite(file.width) && Number(file.width) > 0 ? { width: Number(file.width) } : {}),
    ...(Number.isFinite(file.height) && Number(file.height) > 0 ? { height: Number(file.height) } : {}),
  };
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
      CacheControl: cacheControlForKey(key),
    })
  );
  return { url: publicUrl(key), publicId: key };
}

export async function deleteFile(publicId: string): Promise<void> {
  assertBucket();
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: publicId }));
}

export function contentTypeForMediaPath(filePath: string): string {
  const extension = filePath.toLowerCase().split(".").pop();
  if (extension === "m3u8") return "application/vnd.apple.mpegurl";
  if (extension === "m4s") return "video/iso.segment";
  if (extension === "mp4") return "video/mp4";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

/** Stream a private worker input from S3 without buffering the full video in Node memory. */
export async function downloadFile(publicId: string, destinationPath: string): Promise<void> {
  assertBucket();
  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: publicId, ChecksumMode: "ENABLED" }));
  if (!response.Body) throw new Error("Storage object body is empty");
  await pipeline(response.Body as Readable, createWriteStream(destinationPath, { flags: "wx" }));
  const fileStat = await stat(destinationPath);
  if (Number(response.ContentLength) !== fileStat.size) {
    throw storageIntegrityError(`Downloaded object length mismatch for ${publicId}`);
  }
  if (response.ChecksumSHA256 && response.ChecksumType !== "COMPOSITE" && !/-\d+$/.test(response.ChecksumSHA256)) {
    const checksum = await digestFile(destinationPath);
    if (checksum.base64 !== response.ChecksumSHA256) {
      throw storageIntegrityError(`Downloaded object checksum mismatch for ${publicId}`);
    }
  }
}

/** Upload one immutable, versioned HLS asset from disk using a bounded stream. */
export async function uploadMediaFile(sourcePath: string, publicId: string): Promise<UploadResult> {
  assertBucket();
  const fileStat = await stat(sourcePath);
  if (fileStat.size <= 0) throw storageIntegrityError(`Generated media file is empty: ${publicId}`);
  const checksum = await digestFile(sourcePath);
  const contentType = contentTypeForMediaPath(sourcePath);
  const stored = await putVerifiedObject({
    key: publicId,
    body: createReadStream(sourcePath),
    contentLength: fileStat.size,
    contentType,
    cacheControl: cacheControlForKey(publicId),
    checksum,
  });
  return {
    url: publicUrl(publicId),
    publicId,
    bytes: fileStat.size,
    checksumSha256: checksum.hex,
    etag: stored.etag,
    contentType,
  };
}

/** Remove a deterministic HLS version before a retry or after a failed upload. */
export async function deletePrefix(prefix: string): Promise<number> {
  assertBucket();
  let continuationToken: string | undefined;
  let deleted = 0;
  do {
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const keys = (listed.Contents || []).map((entry) => entry.Key).filter((key): key is string => Boolean(key));
    if (keys.length) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }));
      deleted += keys.length;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
}

const assertVideoSourceKey = (key: string): void => {
  if (!/^post-video-sources\/[a-f0-9]{24}\/[a-f0-9]{24}\/source\.[a-z0-9]+$/.test(key)) {
    throw new Error("Invalid post video source key");
  }
};

/** Multipart APIs are server-keyed; neither object keys nor upload IDs come from clients. */
export async function createVideoMultipart(key: string, contentType: string, sessionId: string): Promise<string> {
  assertBucket(); assertVideoSourceKey(key);
  const result = await s3.send(new CreateMultipartUploadCommand({
    Bucket: BUCKET, Key: key, ContentType: contentType,
    CacheControl: "private, no-store", ServerSideEncryption: "AES256",
    Metadata: { "upload-session": sessionId },
  }));
  if (!result.UploadId) throw new Error("S3 did not create a multipart upload");
  return result.UploadId;
}

export async function presignVideoPart(key: string, uploadId: string, partNumber: number, size: number): Promise<string> {
  assertBucket(); assertVideoSourceKey(key);
  return getSignedUrl(s3 as S3Client, new UploadPartCommand({
    Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: size,
  }), { expiresIn: 900, signableHeaders: new Set(["content-length"]) });
}

export async function listVideoParts(key: string, uploadId: string): Promise<Array<{partNumber: number; size: number; etag: string}>> {
  assertBucket(); assertVideoSourceKey(key);
  const parts: Array<{partNumber: number; size: number; etag: string}> = [];
  let marker: string | undefined;
  do {
    const result = await s3.send(new ListPartsCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
    for (const part of result.Parts || []) {
      if (part.PartNumber && part.ETag) parts.push({ partNumber: part.PartNumber, size: Number(part.Size), etag: part.ETag });
    }
    marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
}

export async function completeVideoMultipart(key: string, uploadId: string, parts: Array<{partNumber: number; etag: string}>): Promise<void> {
  assertBucket(); assertVideoSourceKey(key);
  await s3.send(new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: parts.map(part => ({ PartNumber: part.partNumber, ETag: part.etag })) },
  }));
}

export async function abortVideoMultipart(key: string, uploadId: string): Promise<void> {
  assertBucket(); assertVideoSourceKey(key);
  try { await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId })); }
  catch (error) { if ((error as { name?: string }).name !== "NoSuchUpload") throw error; }
}

export async function headVideoSource(key: string): Promise<{ size: number; sessionId: string; contentType: string }> {
  assertBucket(); assertVideoSourceKey(key);
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return { size: Number(head.ContentLength), sessionId: String(head.Metadata?.["upload-session"] || ""), contentType: String(head.ContentType || "") };
}

export async function readVideoManifest(key: string): Promise<string> {
  assertBucket();
  if (!/^post-video-playback\/[a-f0-9]{24}\/[a-f0-9]{24}\/[a-zA-Z0-9_-]+\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.m3u8$/.test(key)) throw new Error("Invalid playback manifest key");
  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (Number(response.ContentLength) > 1024 * 1024) throw new Error("Playback manifest exceeds size limit");
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as Readable) {
    const buffer = Buffer.from(chunk); bytes += buffer.length;
    if (bytes > 1024 * 1024) throw new Error("Playback manifest exceeds size limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function uploadMultipleFiles(
  files: Array<VideoUploadFile & { mimetype: string }>,
  folder = "gaming-social"
): Promise<Array<{ type: string; duration?: number; width?: number; height?: number } & UploadResult>> {
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
