import { app, safeStorage } from 'electron';
import { existsSync, linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { FingerprintAccessView } from '../shared/inspector';

let access: FingerprintAccessView = { state: 'unavailable', phase: 'starting' };
export function fingerprintAccess(): FingerprintAccessView { return { ...access }; }

/** Only monitor-owned ciphertext is read; no Codex, browser or SSH credentials. */
export function workspaceFingerprintKey(directory: string): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return undefined;
  const filename = path.join(directory, 'fingerprint.enc');
  if (existsSync(filename)) { try { return safeStorage.decryptString(readFileSync(filename)); } catch { return undefined; } }
  const key = randomBytes(32).toString('base64');
  const ciphertext = safeStorage.encryptString(key); const temporary = `${filename}.${process.pid}.tmp`;
  writeFileSync(temporary, ciphertext, { mode: 0o600, flag: 'wx' });
  try { linkSync(temporary, filename); return key; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return safeStorage.decryptString(readFileSync(filename)); }
  finally { unlinkSync(temporary); }
}

/** OS keychain calls can wait for authorization; isolate them from the UI process. */
export function protectedFingerprintKey(authorize = false, onState?: (state: FingerprintAccessView) => void): Promise<string | undefined> {
  return new Promise(resolve => {
    const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--inspector-key-helper'];
    const helper = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = ''; let finished = false; let key: string | undefined; let received = 0; let response = false;
    const publish = (state: FingerprintAccessView) => { access = state; onState?.({ ...state }); };
    publish({ state: 'reading', phase: 'starting' });
    const finish = (state: FingerprintAccessView['state']) => { if (finished) return; finished = true; clearTimeout(timer); app.removeListener('before-quit',onQuit); helper.kill('SIGKILL'); publish({ state, phase: state === 'available' || state === 'unavailable' ? 'complete' : access.phase }); resolve(state === 'available' ? key : undefined); };
    const onQuit = () => finish('failed'); app.once('before-quit',onQuit);
    const timer = setTimeout(() => finish(access.phase === 'keychain' ? 'keychain_timeout' : 'startup_timeout'), authorize ? 60000 : 3000);
    helper.stdout.on('data', (chunk: Buffer) => {
      if (finished) return; received += chunk.length;
      if (received > 1024) { finish('failed'); return; }
      output += chunk.toString('utf8');
      let boundary;
      while ((boundary = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, boundary); output = output.slice(boundary + 1);
        try {
          const value = JSON.parse(line) as { phase?: unknown; key?: unknown };
          if (!value || typeof value !== 'object' || Array.isArray(value)) { finish('failed'); return; }
          if (value.phase === 'keychain' && Object.keys(value).length === 1 && !response) publish({ state: 'reading', phase: 'keychain' });
          else if (!response && Object.keys(value).every(field => field === 'key') && (value.key === undefined || typeof value.key === 'string' && /^[a-zA-Z0-9+/]{43}=$/.test(value.key))) { key = value.key as string | undefined; response = true; }
          else { finish('failed'); return; }
        } catch { finish('failed'); return; }
      }
    });
    helper.on('error', () => finish('failed'));
    helper.on('exit', code => {
      finish(code === 0 && response && !output ? key ? 'available' : 'unavailable' : 'failed');
    });
  });
}
