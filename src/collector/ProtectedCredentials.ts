import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface CollectorCredential { token: string; fingerprintKey: string; offlineSigningKey?: string; }
function command(program: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = []; let bytes = 0;
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) child.kill(); else chunks.push(Buffer.from(chunk)); });
    child.stderr.resume(); child.on('error', () => reject(new Error('SECURE_STORAGE_UNAVAILABLE')));
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks).toString('utf8').trim()) : reject(new Error('SECURE_STORAGE_UNAVAILABLE')));
    child.stdin.end(input ?? '');
  });
}

export async function saveCredential(filename: string, credential: CollectorCredential): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const body = JSON.stringify(credential);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  if (process.platform === 'win32') {
    const encrypted = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Security; $data=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'], body);
    await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, filename); return;
  }
  if (process.platform === 'linux') {
    await command('sudo', ['-n', 'systemd-creds', 'encrypt', '--with-key=host', '--name=token-inspector-device', '-', temporary], body); await fs.rename(temporary, filename); return;
  }
  throw new Error('SECURE_STORAGE_UNAVAILABLE');
}

export async function loadCredential(filename: string, fromFile = false): Promise<CollectorCredential> {
  let body: string;
  if (process.platform === 'win32') {
    const encrypted = await fs.readFile(filename, 'utf8');
    body = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'], encrypted);
  } else if (process.platform === 'linux') {
    // systemd supplies this monitor-owned credential in a protected runtime directory.
    const directory = fromFile ? undefined : process.env.CREDENTIALS_DIRECTORY;
    body = directory ? await fs.readFile(path.join(directory, 'token-inspector-device'), 'utf8') : await command('sudo', ['-n', 'systemd-creds', 'decrypt', '--name=token-inspector-device', filename, '-']);
  } else throw new Error('SECURE_STORAGE_UNAVAILABLE');
  const value = JSON.parse(body) as CollectorCredential;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(value.token) || !/^[A-Za-z0-9+/=]{40,64}$/.test(value.fingerprintKey)) throw new Error('INVALID_CREDENTIAL');
  if (value.offlineSigningKey !== undefined && (typeof value.offlineSigningKey !== 'string' || value.offlineSigningKey.length > 512 || !value.offlineSigningKey.startsWith('-----BEGIN PRIVATE KEY-----'))) throw new Error('INVALID_CREDENTIAL');
  return value;
}
