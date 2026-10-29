import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readAccountRateLimits, readAccountUsage } from '../src/main/AccountUsage';

async function server(account: unknown, result: unknown, run: (executable: string, methods: () => Promise<string[]>) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'account-usage-'));
  const executable = path.join(root, 'codex'); const log = path.join(root, 'methods.jsonl');
  const program = `#!${process.execPath}
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const account = ${JSON.stringify(account)}; const usage = ${JSON.stringify(result)};
createInterface({ input: process.stdin }).on('line', line => {
 const message = JSON.parse(line); appendFileSync(${JSON.stringify(log)}, JSON.stringify(message.method) + '\\n');
 const result = message.id === 1 ? {} : message.id === 2 ? { account } : usage;
 if (message.id) process.stdout.write(JSON.stringify({ id: message.id, result }) + '\\n');
});
`;
  await writeFile(executable, program, { mode: 0o700 });
  try { await run(executable, async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('reads official account totals without starting a thread or exposing account identity', async () => {
  await server({ type: 'chatgpt', email: 'example@example.test' }, { summary: { lifetimeTokens: 16272480636, peakDailyTokens: 2377128211 }, dailyUsageBuckets: [{ startDate: '2026-10-14', tokens: 27 }] }, async (executable, methods) => {
    const result = await readAccountUsage(executable);
    assert.equal(result.state, 'available'); assert.equal(result.lifetimeTokens, '16272480636'); assert.equal(result.peakDailyTokens, '2377128211');
    assert.equal(result.accountLabel, 'ex***@example.test'); assert.equal(result.dailyUsageBuckets?.[0].tokens, '27'); assert.ok(result.measuredAt);
    assert.deepEqual(await methods(), ['initialize', 'initialized', 'account/read', 'account/usage/read']);
    assert.ok(!JSON.stringify(result).includes('example@example.test'));
  });
});

test('retains official null values instead of turning unavailable totals into zero', async () => {
  await server({ type: 'chatgpt' }, { summary: { lifetimeTokens: null, peakDailyTokens: null }, dailyUsageBuckets: null }, async executable => {
    const result = await readAccountUsage(executable); assert.equal(result.state, 'available'); assert.equal(result.lifetimeTokens, null); assert.equal(result.dailyUsageBuckets, null);
  });
});

test('does not read usage or initiate sign-in for unsigned or API-key accounts', async () => {
  for (const [account, error] of [[null, 'SIGN_IN_REQUIRED'], [{ type: 'apiKey' }, 'UNSUPPORTED_ACCOUNT']] as const) {
    await server(account, {}, async (executable, methods) => {
      const result = await readAccountUsage(executable); assert.equal(result.state, 'unavailable'); assert.equal(result.error, error);
      assert.deepEqual(await methods(), ['initialize', 'initialized', 'account/read']);
    });
  }
});

test('rejects rounded or malformed official counts and reports a missing CLI safely', async () => {
  for (const lifetimeTokens of [9007199254740992, -1, '123']) await server({ type: 'chatgpt' }, { summary: { lifetimeTokens }, dailyUsageBuckets: null }, async executable => {
    const result = await readAccountUsage(executable); assert.equal(result.error, 'INVALID_RESPONSE'); assert.equal(result.lifetimeTokens, null);
  });
  assert.equal((await readAccountUsage('/missing-agent-monitor-test/codex')).error, 'CLI_UNAVAILABLE');
});

test('rejects invalid calendar dates and duplicated daily buckets', async () => {
  for (const dailyUsageBuckets of [[{ startDate: '2026-02-30', tokens: 1 }], [{ startDate: '2026-10-14', tokens: 1 }, { startDate: '2026-10-14', tokens: 2 }]]) {
    await server({ type: 'chatgpt' }, { summary: { lifetimeTokens: 3 }, dailyUsageBuckets }, async executable => {
      const result = await readAccountUsage(executable); assert.equal(result.error, 'INVALID_RESPONSE'); assert.equal(result.dailyUsageBuckets, null);
    });
  }
});

test('reads independent current quota buckets and exposes no account ids or write actions', async () => {
  const result = { ordinaryUsageAllowed: false, accountId: 'private-account-id', rateLimits: { limitId: 'legacy', primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
    codex: { limitId: 'codex', limitName: 'Codex', primary: { usedPercent: 25.5, windowDurationMins: 300, resetsAt: 1792070000 }, secondary: { usedPercent: 101, windowDurationMins: 10080, resetsAt: null }, credits: { hasCredits: true, unlimited: false, balance: '12.5' } },
    extra: { limitId: 'extra', primary: null, secondary: null, credits: null },
  }, rateLimitResetCredits: { availableCount: 2, credits: [{ id: 'private-reset-id' }] } };
  await server({ type: 'chatgpt', email: 'example@example.test' }, result, async (executable, methods) => {
    const value = await readAccountRateLimits(executable);
    assert.equal(value.state, 'available'); assert.equal(value.ordinaryUsageAllowed, false); assert.equal(value.availableResetCredits, '2');
    assert.equal(value.buckets.length, 2); assert.deepEqual(value.buckets[0].primary, result.rateLimitsByLimitId.codex.primary);
    assert.equal(value.buckets[0].secondary?.usedPercent, 101); assert.equal(value.buckets[1].primary, null);
    assert.equal(value.buckets[0].credits?.balance, '12.5'); assert.ok(value.measuredAt);
    assert.deepEqual(await methods(), ['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
    assert.ok(!/private-account-id|private-reset-id|example@example.test/.test(JSON.stringify(value)));
  });
});

test('current quota legacy fallback preserves unknowns and an explicit empty multi-bucket map', async () => {
  await server({ type: 'chatgpt' }, { rateLimits: { limitId: 'codex', primary: { usedPercent: 0, windowDurationMins: null, resetsAt: 0 } } }, async executable => {
    const value = await readAccountRateLimits(executable);
    assert.equal(value.state, 'available'); assert.equal(value.ordinaryUsageAllowed, null); assert.equal(value.availableResetCredits, null);
    assert.equal(value.buckets[0].primary?.resetsAt, 0); assert.equal(value.buckets[0].secondary, null); assert.equal(value.buckets[0].credits, null);
  });
  await server({ type: 'chatgpt' }, { rateLimits: { limitId: 'legacy' }, rateLimitsByLimitId: {} }, async executable => {
    const value = await readAccountRateLimits(executable); assert.equal(value.state, 'available'); assert.deepEqual(value.buckets, []);
  });
});

test('current quotas reject malformed windows and do not silently become zero', async () => {
  for (const primary of [{ usedPercent: -1 }, { usedPercent: '25' }, { usedPercent: null }, { usedPercent: 1, windowDurationMins: -1 }, { usedPercent: 1, resetsAt: 9007199254740991 }]) {
    await server({ type: 'chatgpt' }, { rateLimits: { primary } }, async executable => {
      const value = await readAccountRateLimits(executable); assert.equal(value.state, 'unavailable'); assert.equal(value.error, 'INVALID_RESPONSE'); assert.deepEqual(value.buckets, []);
    });
  }
  for (const result of [{}, { rateLimitsByLimitId: [] }, { rateLimits: {}, ordinaryUsageAllowed: 1 }, { rateLimits: {}, rateLimitResetCredits: { availableCount: -1 } }]) {
    await server({ type: 'chatgpt' }, result, async executable => assert.equal((await readAccountRateLimits(executable)).error, 'INVALID_RESPONSE'));
  }
});

test('current quota reads require existing supported sign-in and never start login', async () => {
  for (const account of [null, { type: 'apiKey' }]) await server(account, {}, async (executable, methods) => {
    assert.equal((await readAccountRateLimits(executable)).state, 'unavailable');
    assert.deepEqual(await methods(), ['initialize', 'initialized', 'account/read']);
  });
});
