import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createGenerationWorkflow } from "../src/services/generationWorkflow.ts";

describe("map generation workflow", () => {
  test("moves through loading to the generated scene on success", async () => {
    const workflow = createGenerationWorkflow();
    const steps: number[] = [];
    const result = await workflow.run(async () => true, (step) => steps.push(step), 0);

    assert.equal(result, true);
    assert.deepEqual(steps, [1, 2]);
    assert.equal(workflow.isRunning, false);
  });

  test("returns to the selection step after a failed request", async () => {
    const workflow = createGenerationWorkflow();
    const steps: number[] = [];
    const result = await workflow.run(async () => false, (step) => steps.push(step), 0);

    assert.equal(result, false);
    assert.deepEqual(steps, [1, 0]);
    assert.equal(workflow.isRunning, false);
  });

  test("ignores duplicate Generate clicks until the current request settles", async () => {
    const workflow = createGenerationWorkflow();
    const steps: number[] = [];
    let requestCount = 0;
    let resolveRequest!: (success: boolean) => void;
    const request = () => {
      requestCount += 1;
      return new Promise<boolean>((resolve) => { resolveRequest = resolve; });
    };

    const first = workflow.run(request, (step) => steps.push(step), 0);
    const duplicate = await workflow.run(request, (step) => steps.push(step), 0);
    assert.equal(duplicate, null);
    assert.equal(requestCount, 1);
    assert.deepEqual(steps, [1]);

    resolveRequest(true);
    assert.equal(await first, true);
    assert.deepEqual(steps, [1, 2]);
  });
});
