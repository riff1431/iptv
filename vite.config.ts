// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { resolve } from "node:path";

// Allow overriding the Nitro preset via env so self-hosted (Dokploy/Docker) builds
// can target `node-server` while the default (Lovable-hosted) build stays on Cloudflare.
const nitroPreset = process.env.NITRO_PRESET;

// Patch mcpPlugin to normalize path separators on Windows to avoid assertion errors
const patchedMcpPlugin = (...args: Parameters<typeof mcpPlugin>) => {
  const plugin = mcpPlugin(...args);
  const originalConfigResolved = plugin.configResolved;
  if (originalConfigResolved) {
    plugin.configResolved = function (config) {
      const originalRoot = config.root;
      config.root = resolve(config.root);
      try {
        return originalConfigResolved.call(this, config);
      } finally {
        config.root = originalRoot;
      }
    };
  }
  return plugin;
};

const lovableConfig = defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [patchedMcpPlugin()],
  },
  ...(nitroPreset ? { nitro: { preset: nitroPreset } } : {}),
});

export default async (...args: Parameters<typeof lovableConfig>) => {
  const config = await lovableConfig(...args);
  config.plugins = config.plugins?.filter(
    (plugin) =>
      !(
        plugin &&
        typeof plugin === "object" &&
        "name" in plugin &&
        plugin.name === "vite-tsconfig-paths"
      ),
  );
  config.resolve = {
    ...config.resolve,
    tsconfigPaths: true,
  };
  config.build = {
    ...config.build,
    // The remaining large client file is the framework/router bootstrap
    // (about 606 kB, roughly 130 kB compressed). Feature-heavy wallet,
    // chart, PDF, IPTV, and payment code is split into separate chunks.
    chunkSizeWarningLimit: 650,
  };
  return config;
};
