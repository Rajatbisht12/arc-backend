import type { IncomingMessage, ServerResponse } from 'node:http';

/** Bearer playback grants and OAuth codes must never enter access logs. The
 * request itself is left untouched, so signing, routing and auth still see the
 * original bytes. Strip all query/fragment values, not a fragile key denylist. */
export const safeAccessLogValue = (value: string | undefined, url = false): string => {
  if (!value) return '-';
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  if (!url) return clean;
  const boundary = clean.search(/[?#]/);
  return boundary < 0 ? clean : `${clean.slice(0, boundary)}?[redacted]`;
};

type LogTokens = Record<string, ((req: IncomingMessage, res: ServerResponse, argument?: string) => string | undefined) | undefined>;
export const safeAccessLog = (tokens: LogTokens, req: IncomingMessage, res: ServerResponse): string => {
  const value = (name: string, argument?: string, url = false) =>
    safeAccessLogValue(tokens[name]?.(req, res, argument), url);
  return `${value('remote-addr')} - ${value('remote-user')} [${value('date', 'clf')}] `
    + `"${value('method')} ${value('url', undefined, true)} HTTP/${value('http-version')}" `
    + `${value('status')} ${value('res', 'content-length')} `
    + `"${value('referrer', undefined, true)}" "${value('user-agent')}"`;
};
