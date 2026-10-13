/* eslint-disable no-console */
/**
 * CI production build.
 *
 * react-scripts logs the compile error and then calls process.exit. On the
 * Actions runner stdout is a pipe, so that write is still buffered and the
 * log only shows "Process completed with exit code 1". Write synchronously.
 */
const fs = require('fs');
const util = require('util');

function write(fd, args) {
  fs.writeSync(fd, util.format(...args) + '\n');
}

console.log = (...args) => write(1, args);
console.info = (...args) => write(1, args);
console.warn = (...args) => write(2, args);
console.error = (...args) => write(2, args);

process.on('uncaughtException', (err) => {
  write(2, ['uncaughtException', err && (err.stack || err)]);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  write(2, ['unhandledRejection', reason && (reason.stack || reason)]);
  process.exit(1);
});

require('react-scripts/scripts/build');
