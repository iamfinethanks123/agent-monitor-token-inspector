import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import type { InspectorStore } from '../storage/InspectorStore';
import type { SourceAvailabilityState, SourceAvailabilityView } from '../shared/data-quality';

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Inspect metadata only; never follow a source symlink or read original bytes. */
export async function sourceAvailability(store: Pick<InspectorStore, 'db' | 'workspaceId' | 'machineId'>, activeRoots: string[], input: unknown): Promise<SourceAvailabilityView> {
  if (!Array.isArray(input) || input.length > 200 || input.some(id => typeof id !== 'string' || !id || id.length > 256) || new Set(input).size !== input.length) throw new Error('INVALID_SOURCE_IDS');
  const roots = await Promise.all(activeRoots.map(async root => {
    const lexical = path.resolve(root);
    const hint = path.join(await fs.realpath(path.dirname(lexical)).catch(() => path.dirname(lexical)), path.basename(lexical));
    try { const stat = await fs.lstat(lexical); return { lexical, hint, canonical: stat.isDirectory() && !stat.isSymbolicLink() ? await fs.realpath(lexical) : null }; }
    catch { return { lexical, hint, canonical: null }; }
  }));
  const inspect = async (file: string): Promise<SourceAvailabilityState> => {
    if (!path.isAbsolute(file)) return 'blocked';
    const root = roots.find(root => within(root.canonical ?? root.hint, file) || within(root.lexical, file));
    if (!root) return 'outside_roots';
    if (!root.canonical) return 'root_unavailable';
    try {
      const parts = path.relative(within(root.canonical, file) ? root.canonical : root.lexical, file).split(path.sep).filter(Boolean);
      if (!parts.length) return 'blocked';
      let current = root.canonical;
      for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]); const stat = await fs.lstat(current);
        if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) return 'blocked';
      }
      await fs.access(current, constants.R_OK);
      return 'present';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : code === 'EACCES' || code === 'EPERM' ? 'unreadable' : 'unavailable';
    }
  };
  const items: SourceAvailabilityView['items'] = [];
  const source = store.db.prepare('SELECT path,machine_id FROM sources WHERE workspace_id=? AND id=?');
  for (const id of input as string[]) {
    const row = source.get(store.workspaceId, id);
    const state = !row ? 'not_retained' : row.machine_id !== store.machineId ? 'remote' : await inspect(String(row.path));
    items.push({ id, state });
  }
  return { measuredAt: new Date().toISOString(), items };
}
