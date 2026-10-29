export type StorageBlockReason = 'STORAGE_FULL' | 'STORAGE_PERMISSION_REQUIRED';

export function storageBlockReason(error: unknown): StorageBlockReason | undefined {
  const failure = error as { code?: unknown; errcode?: unknown };
  const sqliteCode = typeof failure?.errcode === 'number' ? failure.errcode & 255 : undefined;
  if (failure?.code === 'ENOSPC' || failure?.code === 'SQLITE_FULL' || sqliteCode === 13) return 'STORAGE_FULL';
  if (['EACCES', 'EPERM', 'EROFS', 'SQLITE_READONLY', 'SQLITE_PERM'].includes(String(failure?.code)) || sqliteCode === 8 || sqliteCode === 3) return 'STORAGE_PERMISSION_REQUIRED';
  return undefined;
}
