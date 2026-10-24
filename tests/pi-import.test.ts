import { expect, test } from 'vitest';
import { runFakeToolProbe } from '../gateway/pi-probe.mjs';
test('independent Pi adapter executes a fake tool and awaited lifecycle hooks', async () => {
  expect(process.version).toBe('v24.22.1');
  const result = await runFakeToolProbe();
  expect(result.executed).toEqual([8]);
  expect(result.hooks).toEqual(['before', 'after']);
  expect(result.events).toContain('tool_execution_end');
  expect(result.events.at(-1)).toBe('agent_end');
});
