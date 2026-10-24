import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPi } from '../scripts/verify-pi.ts';
test('source hash guard detects changed dependency contents without trusting folder names', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-guard-'));
  try {
    writeFileSync(join(root, 'file'), 'abc');
    const manifest = { file: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
    expect(() => verifyPi(root, manifest)).not.toThrow();
    writeFileSync(join(root, 'file'), 'changed');
    expect(() => verifyPi(root, manifest)).toThrow(/source drift/);
  } finally { rmSync(root, { recursive: true }); }
});
