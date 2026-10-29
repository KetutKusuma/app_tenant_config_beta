// Helper murni: cadangkan dulu ke History, baru tulis ke DB target.
export type BackupWriteResult<T> =
  | { status: "written"; result: T; historyId: string }
  | { status: "stale" };

export async function backupThenWrite<T>(steps: {
  backup: () => Promise<string>; // id entri History
  write: () => Promise<T | null>; // null = 0 baris (versi bentrok)
  discard: (historyId: string) => Promise<void>;
  onDiscardError?: (err: unknown) => void; // default: console.error
}): Promise<BackupWriteResult<T>> {
  const onDiscardError = steps.onDiscardError ?? ((err: unknown) => console.error("gagal membuang cadangan", err));
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
    await discardSafely();
    throw err;
  }
  if (result === null) {
    await discardSafely();
    return { status: "stale" };
  }
  return { status: "written", result, historyId };
}
