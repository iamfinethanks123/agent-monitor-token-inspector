import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const electronExecutable = process.env.ELECTRON_EXECUTABLE_PATH || require('electron');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const screenshotPath = path.join(os.tmpdir(), 'agent-monitor-smoke.png');
const timeoutMs = Number(process.env.AGENT_MONITOR_SMOKE_TIMEOUT_MS) || 20_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(description, predicate, timeout = timeoutMs) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  const suffix = lastError ? ` (${lastError.message})` : '';
  throw new Error(`Timed out waiting for ${description}${suffix}`);
}

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function sessionMeta({ id, threadSource, parentThreadId, model, role, nickname, cwd }) {
  return {
    timestamp: iso(),
    type: 'session_meta',
    payload: {
      id,
      cwd,
      model_provider: 'openai',
      model,
      thread_source: threadSource,
      ...(parentThreadId ? { parent_thread_id: parentThreadId } : {}),
      ...(role ? { agent_role: role } : {}),
      ...(nickname ? { agent_nickname: nickname } : {}),
    },
  };
}

function turnContext({ model, effort }) {
  return {
    timestamp: iso(),
    type: 'turn_context',
    payload: {
      model,
      effort,
      collaboration_mode: {
        settings: { model, reasoning_effort: effort },
      },
    },
  };
}

function eventMessage(message) {
  return {
    timestamp: iso(),
    type: 'event_msg',
    payload: { type: 'agent_message', message },
  };
}

function taskComplete(message) {
  return {
    timestamp: iso(),
    type: 'event_msg',
    payload: { type: 'task_complete', message },
  };
}

function lines(records) {
  return `${records.map(record => JSON.stringify(record)).join('\n')}\n`;
}

async function appendRecords(filePath, records) {
  await appendFile(filePath, lines(records), 'utf8');
}

async function writeTrace(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, lines(records), 'utf8');
}

function textLocator(page, pattern, { exact = false } = {}) {
  return page.getByText(pattern, { exact });
}

async function bodyText(page) {
  return page.locator('body').innerText().catch(() => '');
}

async function visibleText(page, pattern, options = {}) {
  const locator = textLocator(page, pattern, options).first();
  await expect(locator).toBeVisible({ timeout: timeoutMs });
  return locator;
}

async function visibleAnyText(page, patterns) {
  return waitFor(`one of: ${patterns.join(', ')}`, async () => {
    for (const pattern of patterns) {
      const locator = textLocator(page, pattern).filter({ visible: true }).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    return null;
  });
}

async function visible(locator) {
  return await locator.count() > 0 && await locator.first().isVisible().catch(() => false);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runButton(page, cwdName) {
  const runName = new RegExp(escapeRegExp(cwdName), 'i');
  const picker = page.getByRole('button', { name: /^Run:/ }).first();
  if (await page.locator('.app-shell--embedded').count()) return {
    click: async () => { await picker.press('ArrowDown'); await page.getByRole('option', { name: cwdName === 'fixture-project' ? /^Astra\b/ : cwdName === 'other-project' ? /^Other\b/ : runName }).first().click(); },
  };
  return waitFor(`the run selector for ${cwdName}`, async () => {
    const candidates = [
      page.locator('button.run-item').filter({ has: page.getByTitle(runName) }).first(),
      page.locator('button.run-item').filter({ hasText: cwdName }).first(),
      page.locator('[data-testid="run-item"]').filter({ hasText: cwdName }).first(),
      page.getByRole('button', { name: runName }).first(),
    ];
    for (const candidate of candidates) {
      if (await visible(candidate)) return candidate;
    }
    return null;
  });
}

async function agentLocator(page, id, labels) {
  const selectors = [
    `[data-agent-id="${id}"]`,
    `[data-testid="agent-node-${id}"]`,
    `[data-testid="agent-${id}"]`,
    `[data-id="${id}"]`,
    `.react-flow__node-${id}`,
  ];
  const byId = page.locator(selectors.join(', ')).first();
  if (await visible(byId)) return byId;

  for (const label of labels) {
    const text = textLocator(page, label, { exact: true }).first();
    if (!await text.count()) continue;
    const ancestors = [
      text.locator('xpath=ancestor::*[@data-agent-id][1]'),
      text.locator('xpath=ancestor::*[@data-testid][1]'),
      text.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]'),
      text.locator('xpath=ancestor::*[@role="button"][1]'),
    ];
    for (const candidate of ancestors) {
      if (await visible(candidate)) return candidate;
    }
    return text;
  }
  throw new Error(`Could not find agent ${id} (${labels.join(', ')})`);
}

async function flowNodeLocator(page, id, labels) {
  const flowNode = page.locator(`.react-flow__node[data-id="${id}"]`).first();
  if (await visible(flowNode)) return flowNode;
  return agentLocator(page, id, labels);
}

async function clickAgent(page, id, labels) {
  const locator = await flowNodeLocator(page, id, labels);
  await locator.click({ timeout: timeoutMs });
  return locator;
}

async function agentStatus(page, id, labels, statusPattern) {
  const locator = await agentLocator(page, id, labels);
  const text = await locator.innerText().catch(() => '');
  return statusPattern.test(text) ? text : null;
}

async function nodePosition(locator) {
  const transform = await locator.evaluate(element => element.style.transform).catch(() => '');
  if (transform) return { transform };
  const box = await locator.boundingBox().catch(() => null);
  return box ? { x: box.x, y: box.y } : null;
}

function positionsDiffer(before, after, tolerance = 8) {
  if (!before || !after) return true;
  if (before.transform && after.transform) return before.transform !== after.transform;
  if (before.x === undefined || after.x === undefined) return true;
  return Math.abs(after.x - before.x) > tolerance || Math.abs(after.y - before.y) > tolerance;
}

function boxesOverlap(first, second) {
  return first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;
}

async function visibleGraphNodeCount(page) {
  return page.locator('.react-flow__node').evaluateAll(elements => elements.filter(element => {
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }).length).catch(() => 0);
}

async function visibleGraphEdgeCount(page) {
  return page.locator('.react-flow__edges .react-flow__edge').evaluateAll(elements => elements.filter(element => {
    const path = element.querySelector('path');
    if (!path || !path.getAttribute('d')) return false;
    const groupStyle = getComputedStyle(element);
    const pathStyle = getComputedStyle(path);
    const box = path.getBoundingClientRect();
    const inViewport = box.right > 0 && box.bottom > 0 && box.left < window.innerWidth && box.top < window.innerHeight;
    return inViewport && groupStyle.visibility !== 'hidden' && groupStyle.display !== 'none' &&
      pathStyle.visibility !== 'hidden' && pathStyle.display !== 'none' && pathStyle.opacity !== '0' &&
      pathStyle.stroke !== 'none' && (box.width > 0 || box.height > 0);
  }).length).catch(() => 0);
}

async function dragNode(page, locator, dx, dy) {
  // Let the graph's animated initial framing settle before using screen coordinates.
  await sleep(700);
  const before = await locator.boundingBox();
  if (!before) throw new Error('Cannot drag an agent without a visible bounding box');
  const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await page.mouse.up();
  const after = await waitFor('the dragged node to move', async () => {
    const box = await locator.boundingBox().catch(() => null);
    return box && (Math.abs(box.x - before.x) > 10 || Math.abs(box.y - before.y) > 10) ? box : null;
  });
  return { before, after };
}

async function maybeOpenTrace(page) {
  // The details pane already contains the trace. Keep the graph visible for
  // the following live status and run-switching assertions.
  if (await page.locator('.details-section--trace').isVisible().catch(() => false)) return false;
  const traceButton = page.getByRole('button', { name: /open trace|view trace|trace/i }).first();
  if (await traceButton.isVisible().catch(() => false)) {
    await traceButton.click();
    return true;
  }
  const traceLink = page.getByText(/open trace|view trace/i).first();
  if (await traceLink.isVisible().catch(() => false)) {
    await traceLink.click();
    return true;
  }
  return false;
}

async function main() {
  let tempRoot;
  let electronApp;
  let page;
  const pageErrors = [];
  const consoleErrors = [];

  try {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-monitor-smoke-'));
    const traceRoot = path.join(tempRoot, 'codex-sessions');
    const sourceDir = path.join(traceRoot, '2026', '09', '16');
    const userDataDir = path.join(tempRoot, 'electron-user-data');
    const cwd = path.join(tempRoot, 'fixture-project');
    const otherCwd = path.join(tempRoot, 'other-project');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(otherCwd, { recursive: true });

    const rootId = 'smoke-root-thread';
    const childId = 'smoke-child-thread';
    const siblingId = 'smoke-sibling-thread';
    const nestedId = 'smoke-nested-thread';
    const otherId = 'smoke-other-root-thread';
    const rootPath = path.join(sourceDir, `${rootId}.jsonl`);
    const childPath = path.join(sourceDir, `${childId}.jsonl`);
    const siblingPath = path.join(sourceDir, `${siblingId}.jsonl`);
    const nestedPath = path.join(sourceDir, `${nestedId}.jsonl`);
    const otherPath = path.join(sourceDir, `${otherId}.jsonl`);

    await writeTrace(rootPath, [
      sessionMeta({ id: rootId, threadSource: 'user', model: 'gpt-6-astra', role: 'main', nickname: 'Astra', cwd }),
      turnContext({ model: 'gpt-6-astra', effort: 'medium' }),
    ]);
    await writeTrace(otherPath, [
      sessionMeta({ id: otherId, threadSource: 'user', model: 'gpt-5.5', role: 'main', nickname: 'Other', cwd: otherCwd }),
      turnContext({ model: 'gpt-5.5', effort: 'low' }),
    ]);

    const env = {
      ...process.env,
      AGENT_MONITOR_TRACE_ROOT: traceRoot,
      CODEX_HOME: path.join(tempRoot, 'codex-home'),
      HOME: path.join(tempRoot, 'home'),
      ELECTRON_USER_DATA_DIR: userDataDir,
      AGENT_MONITOR_USER_DATA: userDataDir,
      AGENT_MONITOR_RECEIVER_PORT: '0',
      ELECTRON_IS_DEV: '0',
    };

    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [projectRoot, `--user-data-dir=${userDataDir}`],
      env,
    });
    page = await electronApp.firstWindow();
    const windowState = await waitFor('the Agent Monitor window to maximize', async () => {
      const state = await electronApp.evaluate(({ BrowserWindow }) => {
        const current = BrowserWindow.getAllWindows()[0];
        return current ? { maximized: current.isMaximized(), bounds: current.getBounds() } : null;
      });
      return state?.maximized ? state : null;
    }, 5_000);
    expect(windowState.maximized).toBe(true);
    page.on('pageerror', error => pageErrors.push(error));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await visibleAnyText(page, ['Agent Monitor', 'Agents', 'LIVE', 'Live']);
    const inspectorNav = page.getByRole('button', { name: /任務地圖|Task map|Agent 圖與 Trace|Run inspector/ });
    if (await inspectorNav.isVisible().catch(() => false)) await inspectorNav.click();

    const primaryRun = await runButton(page, 'fixture-project');
    const otherRun = await runButton(page, 'other-project');
    if (!await page.locator('.app-shell--embedded').count()) {
      await expect(primaryRun).toBeVisible({ timeout: timeoutMs }); await expect(otherRun).toBeVisible({ timeout: timeoutMs });
    }
    await waitFor('the latest real run to load automatically', async () => await visibleGraphNodeCount(page) > 0);
    expect(await page.getByTitle('Load demo stream').count()).toBe(0);
    expect(await page.getByText('DEMO MODE', { exact: true }).count()).toBe(0);

    await primaryRun.click();
    const rootLabels = ['Astra', 'GPT-6 Astra', 'gpt-6-astra', 'Main Agent'];
    await waitFor('the selected root agent', async () => {
      const locator = await agentLocator(page, rootId, rootLabels).catch(() => null);
      return locator && await locator.isVisible().catch(() => false) ? locator : null;
    });
    await appendRecords(rootPath, [{ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 80, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 10 }, last_token_usage: { input_tokens: 80, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 10 } } } }]);
    await page.locator('summary.run-token-totals').click();
    await expect(page.getByRole('heading', { name: /Trace 用量詳情|Trace usage details/ })).toBeVisible();
    await page.getByRole('tab', { name: /By model/ }).click();
    await expect(page.locator('.token-breakdown__models')).toBeVisible();
    await page.keyboard.press('Escape');
    await appendRecords(rootPath, [eventMessage('SMOKE ROOT TRACE MARKER')]);
    await visibleAnyText(page, ['SMOKE ROOT TRACE MARKER', 'Astra', 'GPT-6 Astra', 'gpt-6-astra']);
    const rootNode = await flowNodeLocator(page, rootId, rootLabels);
    const rootPositionBefore = await nodePosition(rootNode);
    if (!rootPositionBefore) throw new Error('Root agent has no visible position');
    await waitFor('the root status', async () => agentStatus(page, rootId, rootLabels, /active|starting|running|idle|waiting/i));
    await visibleAnyText(page, ['GPT-6 Astra', 'gpt-6-astra']);
    await visibleAnyText(page, ['medium', 'MEDIUM']);

    await writeTrace(childPath, [
      sessionMeta({
        id: childId,
        threadSource: 'subagent',
        parentThreadId: rootId,
        model: 'gpt-5.6-luna',
        role: 'explorer',
        nickname: 'Explorer',
        cwd,
      }),
      turnContext({ model: 'gpt-5.6-luna', effort: 'high' }),
      eventMessage('SMOKE CHILD TRACE MARKER'),
    ]);
    const childLabels = ['Explorer', 'gpt-5.6-luna', 'GPT-5.6 Luna', 'explorer'];
    const child = await waitFor('the Explorer child agent', async () => {
      const locator = await flowNodeLocator(page, childId, childLabels).catch(() => null);
      return locator && await locator.isVisible().catch(() => false) ? locator : null;
    });
    const childBox = await child.boundingBox();
    if (!childBox) throw new Error('Child agent has no visible bounding box');
    await visibleAnyText(page, ['GPT-5.6 Luna', 'gpt-5.6-luna']);
    await visibleAnyText(page, ['high', 'HIGH']);

    const draggedPosition = await dragNode(page, child, 120, 70);
    const childPositionAfterDrag = await nodePosition(child);
    if (!childPositionAfterDrag || (draggedPosition.after.x === draggedPosition.before.x && draggedPosition.after.y === draggedPosition.before.y)) {
      throw new Error('Dragged child position was not retained immediately after drag');
    }

    await writeTrace(siblingPath, [
      sessionMeta({
        id: siblingId,
        threadSource: 'subagent',
        parentThreadId: rootId,
        model: 'gpt-5.6-luna',
        role: 'tester',
        nickname: 'Sibling Tester',
        cwd,
      }),
      turnContext({ model: 'gpt-5.6-luna', effort: 'high' }),
      eventMessage('SMOKE SIBLING TRACE MARKER'),
    ]);
    const siblingLabels = ['Sibling Tester', 'sibling', 'gpt-5.6-luna'];
    const sibling = await waitFor('the sequential sibling agent', async () => {
      const locator = await flowNodeLocator(page, siblingId, siblingLabels).catch(() => null);
      return locator && await locator.isVisible().catch(() => false) ? locator : null;
    });
    const siblingLayout = await waitFor('the sibling nodes to remain non-overlapping', async () => {
      const currentChildBox = await child.boundingBox().catch(() => null);
      const currentSiblingBox = await sibling.boundingBox().catch(() => null);
      if (!currentChildBox || !currentSiblingBox || boxesOverlap(currentChildBox, currentSiblingBox)) return null;
      return { currentChildBox, currentSiblingBox };
    });
    const childPositionAfterSibling = await nodePosition(child);
    if (positionsDiffer(childPositionAfterDrag, childPositionAfterSibling, 12)) {
      throw new Error(`Dragged child position changed after sibling discovery (${JSON.stringify(childPositionAfterDrag)} -> ${JSON.stringify(childPositionAfterSibling)})`);
    }
    if (!siblingLayout) throw new Error('Sibling layout was not measurable');

    await writeTrace(nestedPath, [
      sessionMeta({
        id: nestedId,
        threadSource: 'subagent',
        parentThreadId: childId,
        model: 'gpt-5.6-luna',
        role: 'tester',
        nickname: 'Nested Tester',
        cwd,
      }),
      turnContext({ model: 'gpt-5.6-luna', effort: 'max' }),
      eventMessage('SMOKE NESTED TRACE MARKER'),
    ]);
    const nestedLabels = ['Nested Tester', 'tester', 'SMOKE NESTED TRACE MARKER'];
    await waitFor('the nested tester agent', async () => {
      const locator = await flowNodeLocator(page, nestedId, nestedLabels).catch(() => null);
      return locator && await locator.isVisible().catch(() => false) ? locator : null;
    });
    await visibleAnyText(page, ['Nested Tester', 'tester', 'SMOKE NESTED TRACE MARKER']);

    const rootPositionAfter = await nodePosition(await flowNodeLocator(page, rootId, rootLabels));
    if (positionsDiffer(rootPositionBefore, rootPositionAfter, 12)) {
      throw new Error(`Root graph position moved after child discovery (${JSON.stringify(rootPositionBefore)} -> ${JSON.stringify(rootPositionAfter)})`);
    }

    await page.getByTitle('Fit graph', { exact: true }).click();
    try {
      await waitFor('three visible React Flow spawn edges', async () => await visibleGraphEdgeCount(page) >= 3);
    } catch (error) {
      const edgeDebug = await page.locator('.react-flow__edges').evaluate(element => ({
        childCount: element.childElementCount,
        html: element.innerHTML.slice(0, 12_000),
      })).catch(() => null);
      console.error(`SMOKE EDGE DOM: ${JSON.stringify(edgeDebug)}`);
      throw error;
    }

    await clickAgent(page, childId, childLabels);
    await visibleAnyText(page, ['Explorer', 'explorer']);
    await visibleAnyText(page, ['high', 'HIGH']);
    await waitFor('the child status in the detail view', async () => agentStatus(page, childId, childLabels, /active|starting|running|idle|waiting/i));
    await maybeOpenTrace(page);
    await visibleText(page, 'SMOKE CHILD TRACE MARKER');

    await appendRecords(childPath, [taskComplete('SMOKE CHILD COMPLETE MARKER')]);
    await waitFor('the child finished status', async () => agentStatus(page, childId, childLabels, /finished/i));

    await appendRecords(rootPath, [taskComplete('SMOKE ROOT COMPLETE MARKER')]);
    await waitFor('the root finished status', async () => agentStatus(page, rootId, rootLabels, /finished/i));

    if (await visibleGraphNodeCount(page) < 4) {
      throw new Error('The selected primary run did not retain all four graph nodes before switching runs');
    }
    const otherIdLocator = page.locator(`.react-flow__node[data-id="${otherId}"], [data-agent-id="${otherId}"]`);
    if (await otherIdLocator.count() !== 0) {
      throw new Error('The unrelated run appeared in the primary graph before selection');
    }

    await otherRun.click();
    const otherLabels = ['Other', 'gpt-5.5', 'GPT-5.5'];
    await waitFor('the selected unrelated run agent', async () => {
      const locator = await agentLocator(page, otherId, otherLabels).catch(() => null);
      return locator && await locator.isVisible().catch(() => false) ? locator : null;
    });
    await visibleAnyText(page, ['gpt-5.5', 'GPT-5.5']);
    await visibleAnyText(page, ['low', 'LOW']);
    await waitFor('the previous run nodes to leave the selected graph', async () => {
      const primaryNodes = page.locator(`.react-flow__node[data-id="${rootId}"], .react-flow__node[data-id="${childId}"], .react-flow__node[data-id="${siblingId}"], .react-flow__node[data-id="${nestedId}"]`);
      return await primaryNodes.evaluateAll(elements => elements.filter(element => {
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
      }).length).catch(() => 0) === 0;
    });

    await primaryRun.click();
    await waitFor('the primary run to reload after switching back', async () => {
      const locator = await agentLocator(page, rootId, rootLabels).catch(() => null);
      return locator && await locator.isVisible().catch(() => false) ? locator : null;
    });
    await clickAgent(page, childId, childLabels);
    await maybeOpenTrace(page);
    await visibleText(page, 'SMOKE CHILD TRACE MARKER');

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const compactAt = new Date().toISOString();
    await appendRecords(rootPath, [
      { type: 'token_usage_record', timestamp: compactAt, payload: { thread_id: rootId, response_id: 'smoke-compact-before', usage: { input_tokens: 1200, output_tokens: 2 } } },
      { type: 'event_msg', timestamp: compactAt, payload: { type: 'item_started', thread_id: rootId, item: { type: 'ContextCompaction', id: 'smoke-compact-operation' } } },
      { type: 'event_msg', timestamp: compactAt, payload: { type: 'item_completed', thread_id: rootId, item: { type: 'ContextCompaction', id: 'smoke-compact-operation' } } },
      { type: 'event_msg', timestamp: compactAt, payload: { type: 'context_compacted' } },
      { type: 'compacted', timestamp: compactAt, payload: {} },
      { type: 'token_usage_record', timestamp: compactAt, payload: { thread_id: rootId, response_id: 'smoke-compact-after', usage: { input_tokens: 200, output_tokens: 2 } } },
    ]);
    await waitFor('deduplicated compaction index', async () => {
      const view = await page.evaluate(runId => window.tokenInspector.diagnostics({ runId }), rootId);
      return view.compactionCompleted === 1 && view.compactions[0]?.inputChange === '-1000';
    });
    await page.getByRole('button', { name: /Context 與工具|Context & tools/ }).click();
    await page.getByRole('navigation',{name:'Context investigation modes'}).getByRole('button',{name:/壓縮分析|Compaction analysis/}).click();
    await expect(page.getByRole('heading', { name: /Context 壓縮與 Input 變化|Context compaction and input change/ })).toBeVisible();
    const compactions = page.getByLabel('Context compaction analysis');
    await expect(compactions.getByLabel('Compaction input proxy')).toContainText('1,200');
    await expect(compactions.getByLabel('Compaction input proxy')).toContainText('-1,000');
    await expect(compactions).toContainText(/推定|inferred/);
    await expect(compactions).toContainText(/未知／未知|Unknown \/ unknown/);
    await page.getByRole('navigation',{name:'Context investigation modes'}).getByRole('button',{name:/Client 清單|Client manifests/}).click();
    await expect(page.getByRole('heading', { name: /受控請求 Context 清單|Owned-client context manifests/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /匯入 Client 清單|Import client manifests/ })).toBeDisabled();
    await page.getByRole('button', { name: /數據品質|Data quality/, exact: true }).click();
    await expect(page.getByRole('heading', { name: /Monitor 自身資源|Monitor resource use/ })).toBeVisible();
    await page.getByRole('button', { name: /任務地圖|Task map/ }).click();
    await visibleText(page, 'SMOKE CHILD TRACE MARKER');
    const contractId = await page.evaluate(async runId => {
      const api = window.tokenInspector;
      const contract = await api.saveContract({ runId, objective: 'Synthetic acceptance contract', acceptance: 'Synthetic review criterion', environment: 'fixture-environment' });
      await api.importTrial({ id: 'smoke-setup-failure', contractId: contract.id, contractRevision: contract.revision, runId: null, variant: 'fixture-setup', outcome: 'setup_failed', acceptanceReviewed: false, evidenceRefs: [], environment: 'fixture-environment', cacheCondition: 'unknown', excludedReason: null });
      return contract.id;
    }, rootId);
    await page.getByRole('button', { name: /任務結果與實驗|Outcomes & experiments/ }).click();
    await expect(page.getByRole('heading', { name: /全部試驗與資源快照|All trial resource snapshots/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /setup_failed/ }).first()).toBeVisible();
    const reportScope = page.getByRole('combobox').filter({ has: page.locator(`option[value="${contractId}"]`) }).last();
    await reportScope.selectOption(contractId);
    await page.getByRole('button', { name: /^建立預覽$|^Prepare preview$/ }).click();
    await expect(page.getByLabel('Report preview page')).toContainText('fixture-setup');
    await expect(page.getByLabel('Report preview page')).toContainText('setup_failed');
    const previewBody = await page.getByLabel('Report preview page').textContent();
    const exportPath = path.join(tempRoot, 'frozen-fixture-report.md');
    const auditBefore = await page.evaluate(async () => (await window.tokenInspector.privacy()).auditEntries);
    await electronApp.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exportPath);
    await page.getByRole('button', { name: /保存呢份預覽|Save this exact preview/ }).click();
    await expect(page.getByText(/frozen-fixture-report\.md/)).toBeVisible();
    if (await readFile(exportPath, 'utf8') !== previewBody) throw new Error('Saved report differed from its frozen preview');
    const auditAfter = await page.evaluate(async () => (await window.tokenInspector.privacy()).auditEntries);
    if (auditAfter !== auditBefore + 1) throw new Error('Report export audit missing');
    await page.getByRole('button', { name: /設定與私隱|Settings & privacy/ }).click();
    await expect(page.getByRole('heading', { name: /逐 Project 私隱設定|Project privacy controls/ })).toBeVisible();
    const projectPolicy = await page.evaluate(async () => (await window.tokenInspector.privacy()).projects.find(project => project.id === '(unknown)').policy);
    const frozenPrivacyReport = await page.evaluate(async () => window.tokenInspector.report({}, 'json'));
    const blockedExportPath = path.join(tempRoot, 'privacy-blocked.json');
    await electronApp.evaluate(({ dialog, BrowserWindow }, args) => { dialog.showSaveDialog = async () => { await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`window.tokenInspector.setProjectPrivacy(${JSON.stringify({ ...args.policy, allowExports: false })})`); return { canceled: false, filePath: args.filePath }; }; }, { policy: projectPolicy, filePath: blockedExportPath });
    const blockedSave = await page.evaluate(async id => { try { await window.tokenInspector.exportReport(id); return false; } catch (error) { return /REPORT_PRIVACY_CHANGED|PREVIEW_EXPIRED/.test(error.message); } }, frozenPrivacyReport.previewId);
    if (!blockedSave) throw new Error('Changing project permissions during the save dialog did not block the frozen report');
    await readFile(blockedExportPath).then(() => { throw new Error('A blocked report file was written'); }, error => { if (error.code !== 'ENOENT') throw error; });
    await page.evaluate(async policy => window.tokenInspector.setProjectPrivacy(policy), projectPolicy);
    await page.getByLabel('Project statistics export').uncheck(); await page.getByLabel('Project source preview').uncheck();
    await page.getByRole('button', { name: /保存 Project 設定|Save project settings/ }).click();
    await waitFor('project preview and export restrictions', async () => {
      const result = await page.evaluate(async id => { const api = window.tokenInspector; const state = await api.privacy(); const policy = state.projects.find(project => project.id === '(unknown)').policy; const agent = (await window.agentMonitor.getSnapshot()).agents.find(agent => agent.threadId === id); let traceDenied = false; let exportDenied = false; try { await window.agentMonitor.getTrace(agent.id); } catch (error) { traceDenied = /PROJECT_SOURCE_PREVIEW_BLOCKED/.test(error.message); } try { await api.report({}, 'json'); } catch (error) { exportDenied = /PROJECT_EXPORT_RESTRICTED/.test(error.message); } return !policy.allowExports && !policy.allowSourcePreview && traceDenied && exportDenied; }, rootId);
      return result;
    });
    await page.getByLabel('Project statistics export').check(); await page.getByLabel('Project source preview').check(); await page.getByRole('button', { name: /保存 Project 設定|Save project settings/ }).click();
    await page.getByLabel('Budget metric').selectOption('elapsed_ms');
    await page.getByLabel('Resource budget threshold').fill('2');
    await page.getByRole('button', { name: /保存預算|Save budget/, exact: true }).click();
    await expect(page.locator('.inspector-finding').filter({ hasText: /120 s/ })).toBeVisible();
    const budget = await page.evaluate(async () => (await window.tokenInspector.budgets()).policies.find(policy => policy.metric === 'elapsed_ms'));
    if (!budget || budget.tokenLimit !== '120000') throw new Error('Time budget was not persisted in its own unit');
    await page.getByRole('button', { name: /分析與建議|Findings/, exact: true }).click();
    await page.getByRole('navigation',{name:'Analysis sections'}).getByRole('button',{name:/^異常與提醒$|^Incidents$/}).click();
    await expect(page.getByRole('heading', { name: /持續異常及提醒記錄|Persistent incidents and alerts/ })).toBeVisible();
    await page.getByRole('button', { name: /用量總覽|Overview/, exact: true }).click();
    await expect(page.getByRole('heading', { name: /由分鐘追蹤到整日|From minutes to a full day/ })).toBeVisible();
    await appendRecords(rootPath, [{ type: 'token_usage_record', timestamp: new Date().toISOString(), payload: { thread_id: rootId, response_id: 'smoke-usd-response', usage: { input_tokens: 8, cached_input_tokens: 6, output_tokens: 2, reasoning_output_tokens: 1 } } }]);
    await page.evaluate(async () => window.tokenInspector.refresh());
    await expect(page.getByLabel('Display unit')).toHaveValue('USD');
    await expect(page.getByLabel('Primary usage total')).toContainText('$');
    await page.getByText(/換算設定與價目來源|Conversion settings and price sources/, { exact: true }).click();
    await expect(page.getByLabel('USD conversion mode')).toHaveValue('automatic');
    const automatic = await page.evaluate(async () => window.tokenInspector.manualUsd());
    if (automatic.price?.mode !== 'automatic' || !automatic.price.catalog?.some(card => card.model === 'gpt-6.1-sol')) throw new Error('Automatic official model pricing was not enabled by default');
    await page.getByLabel('USD conversion mode').selectOption('uniform');
    await page.getByLabel('Uniform USD per million').fill('1');
    await page.getByRole('button', { name: /套用美元價目|Apply USD pricing/ }).click();
    await expect(page.getByLabel('Chart USD conversion')).toBeEnabled();
    await page.getByLabel('Chart USD conversion').check();
    await expect(page.getByRole('heading', { name: /美金估算走勢|USD estimate trend/ })).toBeVisible();
    const conversion = await page.evaluate(async () => window.tokenInspector.manualUsd());
    if (!conversion.price || conversion.price.uniformRate !== '1' || conversion.amount === null) throw new Error('User-defined USD conversion did not produce a known subtotal');
    await page.getByLabel('USD conversion mode').selectOption('automatic');
    await page.getByRole('button', { name: /套用美元價目|Apply USD pricing/ }).click();
    await expect(page.getByLabel('USD conversion mode')).toHaveValue('automatic');
    const restored = await page.evaluate(async () => window.tokenInspector.manualUsd());
    if (restored.price?.mode !== 'automatic') throw new Error('Switching back to automatic pricing failed');
    await page.getByLabel('Chart time window').selectOption('1');
    await expect(page.getByLabel('Chart bucket size')).toHaveValue('1');
    await expect(page.locator('.time-chart-card')).toHaveCount(12);
    await page.getByLabel('Chart time window').selectOption('1440');
    await page.getByLabel('Chart bucket size').selectOption('1440');
    await expect(page.locator('.time-dashboard-scope')).toContainText(/1 格|1 buckets/);
    await page.getByLabel('Chart bucket size').selectOption('1');
    await expect(page.locator('.time-dashboard-scope')).toContainText(/1440 格|1440 buckets/);
    await page.getByRole('button', { name: /設備與來源|Machines & sources/, exact: true }).click();
    await expect(page.getByRole('heading', { name: /離線統計交換|Offline statistics exchange/ })).toBeVisible();
    const pairingPath = path.join(tempRoot, 'offline-fixture-pairing.json');
    await electronApp.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, pairingPath);
    await page.evaluate(async () => window.tokenInspector.enrollDevice('Synthetic offline fixture'));
    const pairing = JSON.parse(await readFile(pairingPath, 'utf8'));
    const paired = await fetch(`${pairing.endpoint}/v2/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, pairingCode: pairing.pairingCode, platform: 'synthetic' }) }).then(response => response.json());
    const keys = generateKeyPairSync('ed25519'); const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const registered = await fetch(`${pairing.endpoint}/v2/offline/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-id': pairing.deviceId, authorization: `Bearer ${paired.deviceToken}` }, body: JSON.stringify({ workspaceId: pairing.workspaceId, publicKey }) });
    if (!registered.ok) throw new Error('Synthetic offline signing registration failed');
    const digest = value => createHash('sha256').update(value).digest('hex'); const offlineThread = 'smoke-offline-run'; const offlineResponse = 'smoke-offline-response';
    const model = { requestedModel: 'gpt-fixture', observedModel: null, providerRoute: 'openai', serviceTier: null, quotaAlias: null, provenance: 'observed', evidenceRefs: [] };
    const identity = { workspaceId: pairing.workspaceId, originMachineId: pairing.deviceId, projectId: null, runId: offlineThread, agentId: null, provider: 'openai', threadId: offlineThread, sessionId: null, rootTurnId: null, turnId: null, responseId: offlineResponse };
    const offlineSourceId = `source:${digest('offline-fixture-source')}`;
    const event = { id: `observation:${digest(`${offlineSourceId}:0:0:1`)}`, sourceId: offlineSourceId, generation: 0, byteStart: '0', byteEnd: '1', line: 1, semanticSequence: null, timestamp: new Date().toISOString(), kind: 'token_usage_record', schemaFingerprint: digest('fixture'), context: { threadId: offlineThread, sessionId: null, parentThreadId: null, forkedFromId: null, runtimeVersion: 'fixture', requestedModel: 'gpt-fixture', providerRoute: 'openai', serviceTier: null, projectId: null, turnId: null }, measurements: [{ kind: 'response', identity, model, values: { input: '3', cachedInput: '0', cacheWriteInput: null, output: '2', reasoningOutput: '0', total: '5' }, nativeTotal: null, presence: ['input_tokens', 'output_tokens'], issues: [], scopeId: `scope:${digest(JSON.stringify([pairing.workspaceId, pairing.deviceId, 'openai', offlineThread]))}`, responseKey: digest(JSON.stringify([pairing.workspaceId, pairing.deviceId, 'openai', offlineThread, offlineResponse])) }] };
    const batch = { schemaVersion: '2', workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, batchId: randomUUID(), sequenceStart: '1', sequenceEnd: '1', createdAt: new Date().toISOString(), adapterVersion: 'codex-passive/1', redactionPolicyId: 'statistics-only-v2', events: [event] };
    const payload = { schemaVersion: 'statistics-offline/1', workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, createdAt: new Date().toISOString(), gap: null, packets: [JSON.stringify(batch)] };
    const offlinePath = path.join(tempRoot, 'fixture.codexstats.json'); await writeFile(offlinePath, JSON.stringify({ payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), keys.privateKey).toString('base64') }));
    await electronApp.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, offlinePath);
    await page.getByRole('button', { name: /選擇離線統計檔案|Choose offline statistics file/ }).click();
    await expect(page.getByRole('button', { name: /確認匯入呢份統計|Confirm this statistics import/ })).toBeVisible();
    const beforeImport = await page.evaluate(async id => (await window.tokenInspector.devices()).devices.find(device => device.id === id).total, pairing.deviceId);
    if (beforeImport !== null) throw new Error('Offline preview mutated accounting');
    await page.getByRole('button', { name: /確認匯入呢份統計|Confirm this statistics import/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /ACK 1/ })).toBeVisible();
    const afterImport = await page.evaluate(async id => (await window.tokenInspector.devices()).devices.find(device => device.id === id).total, pairing.deviceId);
    if (afterImport !== '5') throw new Error('Synthetic offline import did not update canonical accounting');
    const localState = path.join(tempRoot, 'local-only-state'); const localSource = path.join(tempRoot, 'local-only-source'); await mkdir(localState); await mkdir(localSource);
    await writeFile(path.join(localState, 'client.json'), JSON.stringify({ endpoint: 'https://not-enabled.invalid', credentialFile: 'must-not-be-read' }));
    await writeFile(path.join(localSource, 'local.jsonl'), [sessionMeta({ id: 'local-only-fixture', threadSource: 'user', model: 'gpt-fixture', role: 'main', cwd }), { type: 'token_usage_record', payload: { thread_id: 'local-only-fixture', response_id: 'local-response', usage: { input_tokens: 2, output_tokens: 1 } } }].map(row => JSON.stringify(row)).join('\n') + '\n');
    const localResult = spawnSync(electronExecutable, [path.join(projectRoot, 'dist-electron/collector.cjs'), 'local', localSource, '--once'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AGENT_MONITOR_CLIENT_STATE: localState }, encoding: 'utf8', timeout: 10000 });
    if (localResult.status !== 0 || !localResult.stdout.includes('LOCAL_INDEXED:') || !localResult.stdout.includes('networking disabled')) throw new Error('Headless local-only collection failed');
    await page.getByRole('button', { name: /任務地圖|Task map/ }).click();
    await waitFor('the graph after the privacy reset', async () => await visibleGraphNodeCount(page) > 0);
    await clickAgent(page, childId, childLabels);
    await maybeOpenTrace(page);
    await visibleText(page, 'SMOKE CHILD TRACE MARKER');
    const historyPath = path.join(sourceDir, 'timeline-history.jsonl');
    await writeTrace(historyPath, [sessionMeta({ id: 'timeline-smoke', threadSource: 'user', model: 'gpt-6.1-sol', role: 'main', cwd }), ...Array.from({ length: 520 }, () => eventMessage('PRIVATE_TIMELINE_TEXT')), { type: 'response_item', timestamp: iso(), payload: { type: 'function_call', name: 'timeline_native_unique_tool', call_id: 'timeline-last-call', arguments: '{"cmd":"cat /TIMELINE_FILE"}' } }]);
    await page.evaluate(async () => window.tokenInspector.refresh());
    await page.getByRole('button', { name: /執行歷史|History/, exact: true }).click();
    await page.getByLabel('Run filter').selectOption('');
    await expect(page.getByRole('heading', { name: /完整保留歷史 Timeline|Retained full-history timeline/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /搜尋全部歷史|Search all history/ })).toBeEnabled();
    await page.getByLabel('Search retained timeline').fill('timeline_native_unique_tool');
    await page.getByRole('button', { name: /搜尋全部歷史|Search all history/ }).click();
    await expect(page.locator('.timeline-row')).toHaveCount(1); await expect(page.locator('.timeline-row')).toContainText('timeline_native_unique_tool');
    await page.locator('.timeline-row').click(); await expect(page.getByLabel('Selected timeline event')).toContainText('timeline-last-call');
    await page.getByLabel('Search retained timeline').fill(''); await page.getByRole('button', { name: /搜尋全部歷史|Search all history/ }).click();
    await page.getByText(/工具、模型、Provider 同時間篩選|Tool, model, provider and time filters/, { exact: true }).click();
    await page.getByLabel('Timeline agentId').fill('timeline-smoke'); await page.getByRole('button', { name: /套用進階篩選|Apply advanced filters/ }).click();
    await expect(page.locator('.timeline-summary')).toContainText('522');
    if (await page.locator('.timeline-row').count() > 12) throw new Error('Timeline virtualization rendered an unbounded batch');
    await page.getByRole('button', { name: /下一批|Next batch/ }).click(); await expect(page.locator('.inspector-pagination').filter({ hasText: /目前頁|Page/ })).toContainText('2');
    await page.getByRole('button', { name: /上一批|Previous batch/ }).click(); await expect(page.locator('.inspector-pagination').filter({ hasText: /目前頁|Page/ })).toContainText('1');
    if (await page.locator('.timeline-panel').textContent().then(text => text.includes('PRIVATE_TIMELINE_TEXT'))) throw new Error('Raw source text leaked into metadata timeline');
    await appendRecords(rootPath, [{ type: 'token_usage_record', timestamp: iso(), payload: { thread_id: rootId, response_id: 'scope-fast-native', model: 'gpt-6.1-sol', service_tier: 'fast', usage: { input_tokens: 2, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1 } } }]);
    await page.evaluate(async () => window.tokenInspector.refresh());
    await page.getByRole('button', { name: /用量總覽|Overview/, exact: true }).click();
    await page.getByLabel('Provider scope').selectOption('openai');
    await page.getByLabel('Service tier scope').selectOption('fast');
    const scoped = await page.evaluate(async () => { const summary = await window.tokenInspector.summary({ provider: 'openai', serviceTier: 'fast' }); return summary.usage.total.value; });
    if (scoped !== '3') throw new Error('Native scope fixture did not expose the exact fast-tier response');
    await expect(page.getByLabel('Primary usage total')).toContainText('$');
    await expect(page.locator('.inspector-hero')).toContainText('3 tokens');
    const localMachine = await page.evaluate(async () => (await window.tokenInspector.devices()).devices.find(device => device.state === 'local').id);
    await page.getByLabel('Agent scope filter').selectOption(JSON.stringify([localMachine, rootId]));
    await page.getByLabel('Agent accounting mode').selectOption('inclusive');
    await expect(page.locator('.inspector-hero')).toContainText('3 tokens');
    await page.getByRole('button', { name: /清除進階範圍|Clear advanced scope/ }).click();
    if (pageErrors.length) throw new Error(`Renderer page errors: ${pageErrors.map(error => error.message).join('; ')}`);
    if (consoleErrors.length) throw new Error(`Renderer console errors: ${consoleErrors.join('; ')}`);
    console.log(`PASS: Electron acceptance flow completed; screenshot saved to ${screenshotPath}`);
  } catch (error) {
    if (page) {
      console.error(`SMOKE BODY:\n${await bodyText(page)}`);
      if (pageErrors.length) console.error(`SMOKE PAGE ERRORS: ${pageErrors.map(item => item.message).join('; ')}`);
      if (consoleErrors.length) console.error(`SMOKE CONSOLE ERRORS: ${consoleErrors.join('; ')}`);
    }
    throw error;
  } finally {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }
    if (electronApp) await electronApp.close().catch(() => {});
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => {
  console.error(`FAIL: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
