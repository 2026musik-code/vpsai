const esbuild = require('esbuild');

const supportedNodeBuiltins = [
  'assert', 'buffer', 'console', 'constants', 'crypto', 'dns', 'domain', 'events', 'http', 'https', 'module', 'net', 'os', 'path', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'tty', 'url', 'util', 'vm', 'zlib'
];

const unsupportedNodeBuiltins = [
    'fs', 'child_process', 'dgram', 'cluster'
];

const nodeProtocolPlugin = {
    name: 'node-protocol-alias',
    setup(build) {
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
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url || 'file:///worker.js');",
  },
  logLevel: 'info',
}).catch((e) => {
    console.error(e);
    process.exit(1)
});
