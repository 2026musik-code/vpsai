const esbuild = require('esbuild');

const supportedNodeBuiltins = [
  'assert', 'console', 'constants', 'crypto', 'dns', 'domain', 'events', 'module', 'net', 'os', 'path', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tty', 'url', 'util', 'vm', 'zlib'
];

const unsupportedNodeBuiltins = [
    'fs', 'child_process', 'dgram', 'cluster', 'http', 'https', 'tls'
];

const nodeProtocolPlugin = {
    name: 'node-protocol-alias',
    setup(build) {
        // Handle node:buffer externalization explicitly first
        build.onResolve({ filter: /^node:buffer$/ }, () => ({ path: 'node:buffer', external: true }));

        // Special handling for buffer to ensure hasOwnProperty exists (fix for safer-buffer)
        build.onResolve({ filter: /^buffer$/ }, args => {
             return { path: args.path, namespace: 'node-buffer-shim' };
        });

        build.onLoad({ filter: /.*/, namespace: 'node-buffer-shim' }, () => ({
            contents: `
                import * as buffer from 'node:buffer';
                module.exports = { ...buffer };
            `,
            loader: 'js',
        }));

        build.onResolve({ filter: new RegExp(`^(${supportedNodeBuiltins.join('|')})$`) }, args => {
            return { path: `node:${args.path}`, external: true };
        });

        build.onResolve({ filter: new RegExp(`^(${unsupportedNodeBuiltins.join('|')})$`) }, args => {
             return { path: args.path, namespace: 'node-unsupported-stub' };
        });

        build.onLoad({ filter: /.*/, namespace: 'node-unsupported-stub' }, () => ({
            contents: 'module.exports = {}',
            loader: 'js',
        }));
    }
}

const nodeFilePlugin = {
  name: 'node-file-stub',
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, args => ({
      path: args.path,
      namespace: 'node-file-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'node-file-stub' }, () => ({
      contents: 'module.exports = {}',
      loader: 'js',
    }));
  },
};

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  format: 'esm',
  platform: 'browser',
  target: 'esnext',
  plugins: [nodeFilePlugin, nodeProtocolPlugin],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url || 'file:///worker.js'); const __dirname = '/';",
  },
  logLevel: 'info',
}).catch((e) => {
    console.error(e);
    process.exit(1)
});
