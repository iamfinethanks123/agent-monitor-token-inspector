/** Decode a literal command in a known wrapper. Trace code is never executed. */
export function literalCommand(argumentsText: string): string | null {
  try {
    const value = JSON.parse(argumentsText) as { cmd?: unknown; command?: unknown };
    if (typeof value?.cmd === 'string') return value.cmd;
    if (typeof value?.command === 'string') return value.command;
  } catch { /* A functions wrapper is client code, not a JSON argument object. */ }
  const calls = argumentsText.match(/\btools\.exec_command\s*\(/g);
  if (calls?.length !== 1) return null;
  const match = /\btools\.exec_command\s*\(\s*\{[\s\S]*?(?:\bcmd|["']cmd["'])\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(?=\s*[,}])/.exec(argumentsText);
  if (!match) return null;
  if (match[1].startsWith('"')) { try { return JSON.parse(match[1]) as string; } catch { return null; } }
  // Only the common literal escape subset is accepted; interpolated code stays unknown.
  const body = match[1].slice(1, -1); if (/\\(?![\\'"nrt])/.test(body)) return null;
  return body.replace(/\\([\\'"nrt])/g, (_, character: string) => ({ n: '\n', r: '\r', t: '\t' }[character] ?? character));
}

export function stableFailure(output: string): string {
  // Remove only documented wrapper/timing noise. Error messages, values, exit
  // codes, test names, paths and stack locations remain part of the signature.
  return output.split('\n').filter(line => !/^\s*(?:Wall time: [0-9.]+ seconds|Chunk ID: [a-f0-9]+|duration_ms: [0-9.]+|# duration_ms [0-9.]+)\s*$/.test(line)).join('\n').trim();
}

/** Only literal handles from known process wrappers; no trace expression is evaluated. */
export function processHandle(text: string, direction: 'input' | 'output'): string | null {
  try { const value = JSON.parse(text) as { session_id?: unknown }; if (typeof value?.session_id === 'number' && Number.isSafeInteger(value.session_id) || typeof value?.session_id === 'string' && /^[0-9]{1,20}$/.test(value.session_id)) return `session:${String(value.session_id)}`; } catch { /* Known literal wrapper fallback. */ }
  if (direction === 'input') {
    if (text.match(/\btools\.write_stdin\s*\(/g)?.length !== 1) return null;
    const id = /\btools\.write_stdin\s*\(\s*\{[\s\S]*?\bsession_id\s*:\s*([0-9]+)(?=\s*[,}])/.exec(text)?.[1]; return id ? `session:${id}` : null;
  }
  const session = /\bProcess running with session ID ([0-9]+)\b/.exec(text)?.[1]; if (session) return `session:${session}`;
  const cell = /\bScript running with cell ID ([a-zA-Z0-9_-]{1,128})\b/.exec(text)?.[1]; return cell ? `cell:${cell}` : null;
}
