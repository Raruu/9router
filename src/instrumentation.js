export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only composite snapshot. Runtime modules keep sync seams and never
    // import SQLite/node APIs into browser bundles.
    const { installModelCatalogRuntime } = await import("@/lib/modelCatalog/runtime.js");
    await installModelCatalogRuntime();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();
  }
}
