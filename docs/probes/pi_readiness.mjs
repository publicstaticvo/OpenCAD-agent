// Source-only investigation: no installed Pi runtime, provider credentials, or network.
// Node 25.9.0; dependencies are borrowed read-only and explicitly version checked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [piRootArg, dependenciesArg] = process.argv.slice(2);
assert(piRootArg && dependenciesArg, "usage: node pi_readiness.mjs PI_ROOT DEPENDENCY_NODE_MODULES");
const piRoot = resolve(piRootArg);
const dependencies = resolve(dependenciesArg);
const metadata = (p) => JSON.parse(readFileSync(p, "utf8"));
assert.equal(metadata(`${dependencies}/typebox/package.json`).version, "1.3.27");
assert.equal(metadata(`${dependencies}/partial-json/package.json`).version, "0.1.7");
assert.equal(metadata(`${piRoot}/packages/agent/package.json`).version, "1.2.0");
const aliases = Object.fromEntries([
  ["@earendil-works/pi-ai", "ai"],
  ["@earendil-works/pi-agent-core", "agent"],
  ["@earendil-works/pi-telemetry", "telemetry"],
].map(([name, folder]) => [name, pathToFileURL(`${piRoot}/packages/${folder}/src/index.ts`).href]));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (aliases[specifier]) return { url: aliases[specifier], shortCircuit: true };
    if (specifier === "partial-json" || specifier === "typebox" || specifier.startsWith("typebox/")) {
      return nextResolve(specifier, { ...context, parentURL: pathToFileURL(`${dependencies}/../probe.mjs`).href });
    }
    return nextResolve(specifier, context);
  },
});
const { Agent } = await import("@earendil-works/pi-agent-core");
const { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, Type } = await import("@earendil-works/pi-ai");
const reports = [];
for (const [label, value, strict] of [["numeric", 8, false], ["coercion", true, false], ["strict_guard", true, true]]) {
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("dimension", { diameter: value })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Finished fake response"),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const executed = [];
  const hooks = [];
  const events = [];
  const agent = new Agent({
    initialState: { model: faux.getModel(), tools: [{
      name: "dimension", label: "dimension", description: "Probe only",
      parameters: Type.Object({ diameter: Type.Number({ minimum: 0.1 }) }, { additionalProperties: false }),
      execute: async (_id, args) => {
        executed.push(args.diameter);
        return { content: [{ type: "text", text: "Probe only; no CAD mutation" }], details: {} };
      },
    }] },
    streamFn: models.streamSimple.bind(models), toolExecution: "sequential",
    beforeToolCall: async ({ toolCall, args }) => {
      hooks.push({ raw: toolCall.arguments.diameter, normalized: args.diameter });
      if (strict && typeof toolCall.arguments.diameter !== "number") return { block: true, reason: "strict CAD schema" };
    },
    afterToolCall: async () => { hooks.push("after"); },
  });
  agent.subscribe((event) => { events.push(event.type); });
  await agent.prompt("Run the deterministic fake tool call");
  await agent.waitForIdle();
  assert(events.includes("tool_execution_end") && events.at(-1) === "agent_end");
  assert.deepEqual(executed, strict ? [] : [label === "numeric" ? 8 : 1]);
  reports.push({ label, executed, hooks, event_types: [...new Set(events)] });
}
console.log(JSON.stringify({ scope: "local Pi 1.2.0 source + two borrowed exact dependencies, not a package install or CAD integration test", reports }, null, 2));
