/**
 * Dev-only runner for the e2e bundles: stubs the 'vscode' module so the
 * extension data layer can run under plain Node against the real network.
 *
 * Usage:
 *   npx esbuild scripts/e2e.ts --bundle --platform=node --format=cjs \
 *     --outfile=scripts/.e2e.build.cjs --external:vscode --external:playwright-core
 *   node scripts/run-e2e.cjs scripts/.e2e.build.cjs
 */
const path = require('node:path');
const Module = require('module');

const vscodeStub = {
  window: {
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    withProgress: (_opts, task) => task({ report: () => undefined }),
  },
  commands: { executeCommand: async () => undefined },
  ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
  workspace: {
    getConfiguration: () => ({ get: (_key, defaultValue) => defaultValue }),
  },
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return origLoad.call(this, request, ...rest);
};

const entry = process.argv[2] ?? path.join(__dirname, '.e2e.build.cjs');
require(path.resolve(entry));
