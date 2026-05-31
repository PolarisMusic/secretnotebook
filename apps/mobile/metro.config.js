const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

// Watch the entire workspace so changes in packages/* hot-reload.
config.watchFolders = [workspaceRoot];

// Look in the local node_modules first, then the workspace root's.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// pnpm symlinks; avoid Metro resolving the same module through two paths.
config.resolver.disableHierarchicalLookup = true;

// TS with `module: "NodeNext"` (which packages/* use so their dist output
// runs on Node) emits relative imports with explicit `.js` extensions —
// e.g. `dist/index.js` contains `from './sodium.js'`. Metro's
// platform-extension lookup (`./sodium.native.js` → `./sodium.android.js`
// → `./sodium.js`) only fires when the request has NO extension; with
// `./sodium.js` Metro short-circuits to the exact file and the Node-
// flavored `sodium.js` wins, dragging `node:module` into the RN bundle.
//
// Strip the trailing `.js` from any relative request so Metro can do its
// normal platform-aware lookup and pick `.native.js` (or `.android.js` /
// `.ios.js`) when present. Only relative paths — bare package names
// already get the right treatment via the resolver.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // fall through to the original request
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
