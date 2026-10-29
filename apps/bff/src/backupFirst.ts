// Helper murni: cadangkan dulu ke History, baru tulis ke DB target.
export type BackupWriteResult<T> =
  | { status: "written"; result: T; historyId: string }
  | { status: "stale" };

// Error yang dilaporkan server pg (severity + SQLSTATE 5 karakter): statement autocommit sudah di-rollback server.
export function isServerReportedPgError(err: unknown): boolean {
  const e = err as { severity?: unknown; code?: unknown } | null;
  return !!e && typeof e === "object" && typeof e.severity === "string" && typeof e.code === "string" && e.code.length === 5;
}

export async function backupThenWrite<T>(steps: {
  backup: () => Promise<string>; // id entri History
  write: () => Promise<T | null>; // null = 0 baris (versi bentrok)
  discard: (historyId: string) => Promise<void>;
  onDiscardError?: (err: unknown) => void; // default: console.error
  onWriteUncertain?: (err: unknown, historyId: string) => void; // default: console.error
}): Promise<BackupWriteResult<T>> {
  const onDiscardError = steps.onDiscardError ?? ((err: unknown) => console.error("gagal membuang cadangan", err));
  const onWriteUncertain = steps.onWriteUncertain ?? ((err: unknown, id: string) => console.error(`hasil tulis tidak pasti, cadangan ${id} dipertahankan`, err));
  const historyId = await steps.backup();

  // Buang cadangan; kegagalan hanya dilaporkan, tidak menimpa hasil/error utama
  const discardSafely = async () => {
    try {
      await steps.discard(historyId);
    } catch (err) {
      onDiscardError(err);
    }
  };

  let result: T | null;
  try {
    result = await steps.write();
  } catch (err) {
    // Koneksi putus/timeout: UPDATE mungkin sudah commit, cadangan isi lama jadi satu-satunya salinan → pertahankan.
    if (isServerReportedPgError(err)) await discardSafely();
    else onWriteUncertain(err, historyId);
    throw err;
  }
  if (result === null) {
    await discardSafely();
    return { status: "stale" };
  }
  return { status: "written", result, historyId };
}
