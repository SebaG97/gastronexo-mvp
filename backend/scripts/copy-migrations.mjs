import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const sourceDir = resolve('src/db/migrations');
const outputDir = resolve('dist/db/migrations');

await mkdir(outputDir, { recursive: true });

const entries = await readdir(sourceDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith('.sql')) {
    continue;
  }

  await copyFile(join(sourceDir, entry.name), join(outputDir, entry.name));
}
