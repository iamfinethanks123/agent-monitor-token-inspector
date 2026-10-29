/** A local preview is data, never a source of executable instructions. */
export function redactText(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED KEY]')
    .replace(/\b(?:(?:sk|sess|ghp|gho|github_pat)-[A-Za-z0-9_-]{12,}|(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{12,})\b/g, '[REDACTED TOKEN]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|cookie)"?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s,}]+)/gi, '$1"[REDACTED]"');
}

export function csvCell(value: string): string {
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
