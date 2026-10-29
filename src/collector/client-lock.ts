import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function clientLock(directory: string): Promise<() => Promise<void>> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 }); const filename = path.join(directory, 'collector.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await fs.open(filename, 'wx', 0o600); await file.writeFile(String(process.pid)); await file.close();
      return async () => { await fs.unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const stat = await fs.lstat(filename); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32) throw new Error('COLLECTOR_STATE_LOCKED');
      const pid = Number(await fs.readFile(filename, 'utf8')); if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('COLLECTOR_STATE_LOCKED');
      try { process.kill(pid, 0); } catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { await fs.unlink(filename); continue; } }
      throw new Error('COLLECTOR_RUNNING_CLOSE_IT_FIRST');
    }
  }
  throw new Error('COLLECTOR_STATE_LOCKED');
}
