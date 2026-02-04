const esbuild = require('esbuild');

const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https', 'module', 'net', 'os', 'path', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'tty', 'url', 'util', 'vm', 'zlib'
];

const nodeProtocolPlugin = {
    name: 'node-protocol-alias',
    setup(build) {
        build.onResolve({ filter: new RegExp(`^(${nodeBuiltins.join('|')})$`) }, args => {
            return { path: `node:${args.path}`, external: true };
        });
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
  logLevel: 'info',
}).catch((e) => {
    console.error(e);
    process.exit(1)
});
