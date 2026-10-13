/* eslint-disable no-console */
/**
 * CI production build.
 *
 * react-scripts prints a compile failure and then calls process.exit. On the
 * Actions runner that last write is still buffered, so the log only shows
 * "Process completed with exit code 1".
 *
 * Replacing console before TypeScript loads crashes the CI runner while
 * typescript.js is still initializing (nullTransformationContext.factory).
 * Switch to synchronous logging only after that module has finished loading,
 * and drain stdout/stderr before exiting.
 */
const fs = require('fs');
const util = require('util');
const Module = require('module');

let writing = false;

function write(fd, args) {
  if (writing) return;
  writing = true;
  try {
    fs.writeSync(fd, `${util.format(...args)}\n`);
  } finally {
    writing = false;
  }
}

function installSyncConsole() {
  console.log = (...args) => write(1, args);
  console.info = (...args) => write(1, args);
  console.warn = (...args) => write(2, args);
  console.error = (...args) => write(2, args);
}

function isTypeScriptModule(request, exported) {
  const normalized = String(request).replace(/\\/g, '/');
  const byName =
    request === 'typescript' ||
    normalized.endsWith('/typescript/lib/typescript.js');
  // Only inspect this package. Reading `.version` on unrelated modules warns
  // during circular initialization and can disturb their exports.
  return byName && Boolean(exported && exported.nullTransformationContext);
}

const origLoad = Module._load;
let consolePatched = false;
Module._load = function load(request, parent, isMain) {
  const exported = origLoad.apply(this, arguments);
  if (!consolePatched && isTypeScriptModule(request, exported)) {
    consolePatched = true;
    installSyncConsole();
  }
  return exported;
};

const origExit = process.exit;
process.exit = function flushAndExit(code) {
  const exitCode = code === undefined ? 0 : code;
  let pending = 2;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    origExit.call(process, exitCode);
  };
  const mark = () => {
    pending -= 1;
    if (pending === 0) done();
  };
  try {
    process.stdout.write('', mark);
    process.stderr.write('', mark);
  } catch (err) {
    write(2, ['flush failed', err && (err.stack || err)]);
    done();
    return;
  }
  setTimeout(done, 1000);
};

process.on('uncaughtException', (err) => {
  write(2, ['uncaughtException', err && (err.stack || err)]);
  process.exit(1);
});

require('react-scripts/scripts/build');
