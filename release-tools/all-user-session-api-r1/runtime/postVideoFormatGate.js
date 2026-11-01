'use strict';
// Delivery selection for the existing private session worker, not source attestation.
// Worker7 validates these generated H264/AAC assets before committing READY.
const invalid = () => { const e = Error('Video playback is unavailable.'); e.code = 'INVALID_VIDEO_OUTPUT'; e.statusCode = 503; throw e; };
const bounded = r => Math.max(r.width, r.height) <= 1920 && Math.min(r.width, r.height) <= 1080;
const positive = n => Number.isSafeInteger(n) && n > 0;
function selectOutput(output) {
  if (!output || !/^post-video-playback\/[a-f0-9]{24}\/[a-f0-9]{24}\/[a-zA-Z0-9_-]+$/.test(output.prefix)
    || output.hlsKey !== `${output.prefix}/master.m3u8` || output.fallbackKey !== `${output.prefix}/fallback.mp4`
    || output.thumbnailKey !== `${output.prefix}/thumbnail.jpg` || !Array.isArray(output.renditions)
    || output.renditions.length < 1 || output.renditions.length > 16) invalid();
  const seen = new Set();
  for (const r of output.renditions) {
    if (!r || !/^[0-9]{1,6}p$/.test(r.name) || seen.has(r.name)
      || !positive(r.width) || !positive(r.height) || r.width % 2 || r.height % 2
      || !positive(r.bandwidth) || !positive(r.averageBandwidth)
      || r.playlistUrl !== `${output.prefix}/${r.name}/index.m3u8`
      || r.playlistPublicId !== r.playlistUrl) invalid();
    seen.add(r.name);
  }
  const renditions = output.renditions.filter(bounded);
  return { ...output, hlsKey: renditions.length ? output.hlsKey : undefined, renditions };
}
function assertManifestKey(key, output) {
  const selected = selectOutput(output);
  if (!selected.hlsKey || key !== selected.hlsKey && !selected.renditions.some(r => r.playlistUrl === key)) invalid();
  return selected;
}
function filterManifest(text, key, output) {
  const selected = assertManifestKey(key, output);
  if (typeof text !== 'string' || Buffer.byteLength(text) > 524288 || /\r(?!\n)|\0/.test(text)) invalid();
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines.length > 8192 || lines[0] !== '#EXTM3U') invalid();
  if (key === output.hlsKey) {
    // Match the complete worker-generated master before omitting oversized pairs.
    if (lines.length !== 3 + output.renditions.length * 2 || lines[1] !== '#EXT-X-VERSION:7'
      || lines[2] !== '#EXT-X-INDEPENDENT-SEGMENTS') invalid();
    const result = lines.slice(0, 3), seen = new Set();
    for (let i = 3; i < lines.length; i += 2) {
      const r = output.renditions.find(row => lines[i + 1] === `${row.name}/index.m3u8`);
      if (!r || seen.has(r.name) || lines[i] !== `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},AVERAGE-BANDWIDTH=${r.averageBandwidth},RESOLUTION=${r.width}x${r.height}`) invalid();
      seen.add(r.name);
      if (bounded(r)) result.push(lines[i], lines[i + 1]);
    }
    if (seen.size !== output.renditions.length) invalid();
    return result.join('\n') + '\n';
  }
  // No cross-rendition URI, nested playlist, external URI, encryption key or original.
  let map = 0, segments = 0, durationPending = false;
  for (const line of lines.slice(1)) {
    if (/^#EXTINF:[0-9]+(?:\.[0-9]+)?,\s*$/.test(line)) {
      if (durationPending || !(Number(line.slice(8).split(',')[0]) > 0)) invalid();
      durationPending = true;
    } else if (/^segment_[0-9]{5}\.m4s$/.test(line)) {
      if (!durationPending) invalid();
      durationPending = false; segments++;
    } else if (line === '#EXT-X-MAP:URI="init.mp4"') {
      if (++map !== 1 || durationPending) invalid();
    } else if (!/^#EXT-X-(?:VERSION:[0-9]+|TARGETDURATION:[0-9]+|MEDIA-SEQUENCE:0|PLAYLIST-TYPE:VOD|INDEPENDENT-SEGMENTS|ENDLIST)$/.test(line)) invalid();
  }
  if (map !== 1 || !segments || segments > 4096 || durationPending || lines.at(-1) !== '#EXT-X-ENDLIST') invalid();
  return text;
}
module.exports = { bounded, selectOutput, assertManifestKey, filterManifest };
