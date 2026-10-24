import { expect, test } from 'vitest';
import cases from './fixtures/contracts/cases.json';
import { assertContract } from '../shared/cad-contracts.ts';
for (const fixture of cases) test(`strict contract: ${fixture.name}`, () => {
  const run = () => assertContract(fixture.kind, fixture.input);
  if (fixture.valid) expect(run).not.toThrow(); else expect(run).toThrow();
});
test.each([NaN, Infinity, -Infinity])('rejects non-JSON dimension %s', value => {
  expect(() => assertContract('operation', {op:'pad', id:'p', sketch:'s', length:value})).toThrow();
});
