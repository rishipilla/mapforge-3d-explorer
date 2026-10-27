export function createGenerationWorkflow() {
  let running = false;

  return {
    get isRunning() {
      return running;
    },
    async run(
      generate: () => Promise<boolean>,
      setStep: (step: number) => void,
      failureStep: number,
    ): Promise<boolean | null> {
      if (running) return null;
      running = true;
      setStep(1);
      try {
        const succeeded = await generate();
        setStep(succeeded ? 2 : failureStep);
        return succeeded;
      } finally {
        running = false;
      }
    },
  };
}
