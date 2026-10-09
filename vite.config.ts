/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

const artDir = fileURLToPath(new URL('./_build/art', import.meta.url));

/**
 * Content-Security-Policy, injected as a <meta> tag.
 * Production: no inline scripts or styles, no eval, no third-party origins.
 * Dev: Vite injects <style> tags for HMR and needs its websocket.
 * When a real server exists, send these as HTTP headers too (and add
 * frame-ancestors 'none', which <meta> can't express).
 */
function csp(): Plugin {
  let dev = false;
  return {
    name: 'hotm-csp',
    configResolved(c) { dev = c.command === 'serve'; },
    transformIndexHtml() {
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        dev ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:*" : "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "worker-src 'self' blob:",
      ].join('; ');
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the built game works from a sub-path such as https://<user>.github.io/<repo>/.
  base: './',
  plugins: [csp()],
  resolve: {
    alias: { '@art': artDir },
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: false,
    fs: {
      // Only the project and the art folder are servable.
      strict: true,
      allow: ['.', artDir],
    },
  },
  preview: { host: 'localhost' },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
