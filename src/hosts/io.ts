import { constants } from "node:fs";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export const FILE_BYTES = 1024 * 1024;

/** Open first: a pathname size check cannot rule out a FIFO or a growing file. */
export async function readText(path: string, signal?: AbortSignal, maxBytes = FILE_BYTES): Promise<string | undefined> {
  signal?.throwIfAborted();
  const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NONBLOCK | constants.O_NOFOLLOW);
  const file = await open(path, flags).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw new Error("Cannot open a regular host file.");
  });
  if (!file) return undefined;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Host file is not a bounded regular file.");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      signal?.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error("Host file exceeds the byte limit.");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    signal?.throwIfAborted();
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await file.close();
  }
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Check again after preparing the replacement, so an observed outside edit is never overwritten. */
export async function replaceText(path: string, text: string, expected: string | undefined): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    if (await readText(path) !== expected) throw new Error("Host file changed during the operation; retry explicitly.");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
