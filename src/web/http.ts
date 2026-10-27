import { IncomingMessage, ServerResponse } from 'http';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function renderPage(title: string, message: string, ok: boolean): string {
  const color = ok ? '#00b06f' : '#e5484d';
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - Armée de Terre RBLX</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1e1f22;color:#f2f3f5;font-family:system-ui,sans-serif}
  .card{max-width:440px;margin:24px;padding:32px;border-radius:12px;background:#2b2d31;text-align:center;border-top:4px solid ${color}}
  h1{font-size:22px;margin:0 0 12px}p{margin:0;line-height:1.5;color:#b5bac1}small{display:block;margin-top:20px;color:#80848e}
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><small>Armée de Terre RBLX</small></div></body></html>`;
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

export function send(res: ServerResponse, status: number, body: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    ...BASE_HEADERS,
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    ...headers
  });
  res.end(body);
}

export function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...BASE_HEADERS
  });
  res.end(JSON.stringify(data));
}

export function redirect(res: ServerResponse, location: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(302, { Location: location, ...BASE_HEADERS, ...headers });
  res.end();
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

export function buildCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function clearCookie(name: string, secure: boolean): string {
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function fetchJson<T>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs = 10_000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${url} a répondu ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// Lit un corps JSON (1 Mo maximum)
export async function readJsonBody(req: IncomingMessage, limit = 1_000_000): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, 'Requête trop volumineuse');
    chunks.push(buffer);
  }

  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}
