import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccountReadView, AccountUsageView, AccountRateLimitsView, AccountLimitBucket, AccountLimitWindow } from '../shared/inspector';

function codexExecutable(): string {
  if (process.platform === 'darwin') {
    for (const directory of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      const file = path.join(directory, 'ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
      if (existsSync(file)) return file;
    }
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

function tokenCount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_USAGE');
  return String(value);
}

// Authentication remains inside the installed Codex CLI. No credential files or
// model requests pass through Monitor, and no thread is created or resumed.
function readAccount<T extends object>(method: 'account/usage/read' | 'account/rateLimits/read', empty: T, parse: (value: unknown) => T, executable: string): Promise<AccountReadView & T> {
  return new Promise(resolve => {
    let finished = false; let buffer = ''; let bytes = 0; let accountLabel: string | null = null;
    const child = spawn(executable, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const finish = (value: AccountReadView & T) => {
      if (finished) return;
      finished = true; clearTimeout(timer); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.kill(); resolve(value);
    };
    const fail = (error: AccountReadView['error']) => finish({ ...empty, state: 'unavailable', measuredAt: null, accountLabel, error });
    const timer = setTimeout(() => fail('TIMEOUT'), 25000);
    const send = (message: unknown) => { if (!finished) child.stdin.write(JSON.stringify(message) + '\n'); };
    child.on('error', () => fail('CLI_UNAVAILABLE'));
    child.on('close', () => { if (!finished) fail('CONNECTION_CLOSED'); });
    child.stdin.on('error', () => { if (!finished) fail('CONNECTION_CLOSED'); });
    child.stderr.resume();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk); if (bytes > 2 * 1024 * 1024) { fail('INVALID_RESPONSE'); return; }
      buffer += chunk;
      while (!finished && buffer.includes('\n')) {
        const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { fail('INVALID_RESPONSE'); return; }
        if (message.method) {
          if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: 'Account usage reader does not handle server requests.' } });
          continue;
        }
        if (message.error) { fail(message.id === 3 ? 'USAGE_UNAVAILABLE' : 'CONNECTION_CLOSED'); return; }
        if (message.id === 1) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/read', params: { refreshToken: false } });
        } else if (message.id === 2) {
          const account = message.result?.account;
          if (!account) { fail('SIGN_IN_REQUIRED'); return; }
          if (!['chatgpt', 'chatgptAuthTokens', 'agentIdentity', 'personalAccessToken'].includes(account.type)) { fail('UNSUPPORTED_ACCOUNT'); return; }
          if (typeof account.email === 'string') accountLabel = account.email.replace(/^(.{0,2})[^@]*@/, '$1***@');
          send({ id: 3, method, ...(method === 'account/rateLimits/read' ? { params: { excludeResetCreditDetails: true } } : {}) });
        } else if (message.id === 3) {
          try {
            finish({ ...parse(message.result), state: 'available', measuredAt: new Date().toISOString(), accountLabel, error: null });
          } catch { fail('INVALID_RESPONSE'); }
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agent_monitor_usage', title: 'Agent Monitor Account Usage', version: '0.1.21' }, capabilities: { experimentalApi: true } } });
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}

export function readAccountUsage(executable = codexExecutable()): Promise<AccountUsageView> {
  return readAccount('account/usage/read', { lifetimeTokens: null, peakDailyTokens: null, dailyUsageBuckets: null } as Pick<AccountUsageView, 'lifetimeTokens' | 'peakDailyTokens' | 'dailyUsageBuckets'>, value => {
    const result = object(value); const summary = object(result.summary);
    if (!Object.hasOwn(summary, 'lifetimeTokens')) throw new Error('INVALID_USAGE');
    const lifetimeTokens = tokenCount(summary.lifetimeTokens); const peakDailyTokens = tokenCount(summary.peakDailyTokens);
    const seen = new Set<string>();
    if (result.dailyUsageBuckets != null && !Array.isArray(result.dailyUsageBuckets)) throw new Error('INVALID_USAGE');
    const dailyUsageBuckets = result.dailyUsageBuckets == null ? null : (result.dailyUsageBuckets as unknown[]).map(value => {
      const bucket = object(value);
      if (typeof bucket.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(bucket.startDate) || seen.has(bucket.startDate)) throw new Error('INVALID_USAGE');
      const day = Date.parse(`${bucket.startDate}T00:00:00Z`);
      if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== bucket.startDate) throw new Error('INVALID_USAGE');
      seen.add(bucket.startDate); const tokens = tokenCount(bucket.tokens); if (tokens === null) throw new Error('INVALID_USAGE');
      return { startDate: bucket.startDate, tokens };
    });
    return { lifetimeTokens, peakDailyTokens, dailyUsageBuckets };
  }, executable);
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 160) throw new Error('INVALID_RESPONSE');
  return value;
}

function limitWindow(value: unknown): AccountLimitWindow | null {
  if (value == null) return null;
  const window = object(value);
  if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent) || window.usedPercent < 0) throw new Error('INVALID_RESPONSE');
  for (const field of ['windowDurationMins', 'resetsAt']) {
    const number = window[field];
    if (number != null && (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0)) throw new Error('INVALID_RESPONSE');
  }
  if (typeof window.resetsAt === 'number' && window.resetsAt > 8640000000000) throw new Error('INVALID_RESPONSE');
  return { usedPercent: window.usedPercent, windowDurationMins: window.windowDurationMins as number | null ?? null, resetsAt: window.resetsAt as number | null ?? null };
}

export function readAccountRateLimits(executable = codexExecutable()): Promise<AccountRateLimitsView> {
  return readAccount('account/rateLimits/read', { buckets: [], ordinaryUsageAllowed: null, availableResetCredits: null } as Pick<AccountRateLimitsView, 'buckets' | 'ordinaryUsageAllowed' | 'availableResetCredits'>, value => {
    const result = object(value);
    const byId = result.rateLimitsByLimitId == null ? null : object(result.rateLimitsByLimitId);
    const entries = byId ? Object.entries(byId) : result.rateLimits != null ? [['codex', result.rateLimits] as const] : null;
    if (!entries || entries.length > 100) throw new Error('INVALID_RESPONSE');
    const buckets: AccountLimitBucket[] = entries.map(([key, value]) => {
      const bucket = object(value); const id = optionalText(bucket.limitId) ?? optionalText(key)!;
      let credits: AccountLimitBucket['credits'] = null;
      if (bucket.credits != null) {
        const raw = object(bucket.credits);
        if (typeof raw.hasCredits !== 'boolean' || typeof raw.unlimited !== 'boolean') throw new Error('INVALID_RESPONSE');
        credits = { hasCredits: raw.hasCredits, unlimited: raw.unlimited, balance: optionalText(raw.balance) };
      }
      return { id, name: optionalText(bucket.limitName), primary: limitWindow(bucket.primary), secondary: limitWindow(bucket.secondary), credits };
    });
    if (result.ordinaryUsageAllowed != null && typeof result.ordinaryUsageAllowed !== 'boolean') throw new Error('INVALID_RESPONSE');
    const resets = result.rateLimitResetCredits == null ? null : object(result.rateLimitResetCredits);
    return { buckets, ordinaryUsageAllowed: result.ordinaryUsageAllowed as boolean | null ?? null, availableResetCredits: resets ? tokenCount(resets.availableCount) : null };
  }, executable);
}
