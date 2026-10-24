import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function verifyPi(root: string, manifest: Record<string, string>): void {
  for (const [name, wanted] of Object.entries(manifest)) {
    const actual = createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex');
    if (actual !== wanted) throw new Error(`Pi source drift: ${name}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPi(process.cwd(), JSON.parse(readFileSync('docs/pi-source-sha256.json', 'utf8')) as Record<string, string>);
  console.log('Pi source fingerprint verified');
}
