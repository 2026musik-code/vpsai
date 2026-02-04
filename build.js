const esbuild = require('esbuild');

const supportedNodeBuiltins = [
  'assert', 'console', 'constants', 'crypto', 'dns', 'domain', 'module', 'net', 'os', 'path', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tty', 'url', 'util', 'vm', 'zlib'
];

const unsupportedNodeBuiltins = [
    'fs', 'child_process', 'dgram', 'cluster', 'http', 'https', 'tls'
];

const nodeProtocolPlugin = {
    name: 'node-protocol-alias',
    setup(build) {
        // Handle node:buffer externalization explicitly
        build.onResolve({ filter: /^node:buffer$/ }, () => ({ path: 'node:buffer', external: true }));
        // Handle node:events externalization explicitly
        build.onResolve({ filter: /^node:events$/ }, () => ({ path: 'node:events', external: true }));

        // Shim buffer
        build.onResolve({ filter: /^buffer$/ }, args => {
             // console.log('Shimming buffer');
             return { path: args.path, namespace: 'node-buffer-shim' };
        });
        build.onLoad({ filter: /.*/, namespace: 'node-buffer-shim' }, () => ({
            contents: `
                import * as buffer from 'node:buffer';
                module.exports = { ...buffer };
            `,
            loader: 'js',
        }));

        // Shim events
        build.onResolve({ filter: /^events$/ }, args => {
             // console.log('Shimming events');
             return { path: args.path, namespace: 'node-events-shim' };
        });
        build.onLoad({ filter: /.*/, namespace: 'node-events-shim' }, () => ({
            contents: `
                import EventEmitter from 'node:events';
                module.exports = EventEmitter;
            `,
            loader: 'js',
        }));

        build.onResolve({ filter: new RegExp(`^(${supportedNodeBuiltins.join('|')})$`) }, args => {
            // console.log(`Aliasing ${args.path} to node:${args.path}`);
            return { path: `node:${args.path}`, external: true };
        });

        build.onResolve({ filter: new RegExp(`^(${unsupportedNodeBuiltins.join('|')})$`) }, args => {
             // console.log(`Stubbing unsupported module: ${args.path}`);
             return { path: args.path, namespace: 'node-unsupported-stub' };
        });

        build.onLoad({ filter: /.*/, namespace: 'node-unsupported-stub' }, () => ({
            contents: `
                class MockAgent {}
                module.exports = {
                    Agent: MockAgent,
                    connect: () => {},
                    createConnection: () => {},
                    readFile: () => {},
                    readFileSync: () => {},
                    writeFile: () => {},
                    writeFileSync: () => {},
                };
            `,
            loader: 'js',
        }));
    }
}

const nodeFilePlugin = {
  name: 'node-file-stub',
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, args => {
      console.log(`Stubbing native module: ${args.path}`);
      return {
        path: args.path,
        namespace: 'node-file-stub',
      };
    });
    build.onLoad({ filter: /.*/, namespace: 'node-file-stub' }, () => ({
      contents: 'module.exports = {}',
      loader: 'js',
    }));
  },
};

console.log('Starting custom build with esbuild...');

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
}).then(() => {
    console.log('Custom build completed successfully.');
}).catch((e) => {
    console.error('Custom build failed:', e);
    process.exit(1);
});
