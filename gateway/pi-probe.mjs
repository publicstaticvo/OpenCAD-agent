import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, Type } from '@earendil-works/pi-ai';
export async function runFakeToolProbe() {
  const fake = fauxProvider({ tokensPerSecond: 100000 });
  fake.setResponses([fauxAssistantMessage([fauxToolCall('dimension', { value: 8 })], { stopReason: 'toolUse' }), fauxAssistantMessage('done')]);
  const models = createModels();
  models.setProvider(fake.provider);
  const executed = [], hooks = [], events = [];
  const agent = new Agent({ initialState: { model: fake.getModel(), tools: [{
    name: 'dimension', label: 'dimension', description: 'SDK integration probe',
    parameters: Type.Object({ value: Type.Number() }),
    execute: async (_id, args) => { executed.push(args.value); return { content: [{ type: 'text', text: 'ok' }], details: {} }; },
  }] }, streamFn: models.streamSimple.bind(models), toolExecution: 'sequential',
    beforeToolCall: async () => { hooks.push('before'); }, afterToolCall: async () => { hooks.push('after'); },
  });
  agent.subscribe(event => { events.push(event.type); });
  await agent.prompt('Probe');
  await agent.waitForIdle();
  return { executed, hooks, events };
}
