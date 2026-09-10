export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only composite snapshot. Runtime modules keep sync seams and never
    // import SQLite/node APIs into browser bundles.
    const { installModelCatalogRuntime } = await import("@/lib/modelCatalog/runtime.js");
    await installModelCatalogRuntime();

    // Reset persisted exponential 429 backoff once per process. Keep active
    // model locks intact so restart never bypasses a real cooldown.
    const startupState = globalThis[Symbol.for("9router.startupState")] ||= {};
    if (!startupState.providerRetryBackoffReset) {
      const { resetProviderRetryBackoffOnStartup } = await import("@/lib/db/repos/connectionsRepo.js");
      await resetProviderRetryBackoffOnStartup();
      startupState.providerRetryBackoffReset = true;
    }

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();
  }
}
