import { rename, writeFile } from "node:fs/promises";

export async function writeFileAtomic(path: string, data: string | Buffer): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
