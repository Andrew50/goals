/**
 * CI test runner that always prints coverage gate failures (even if unit tests fail).
 *
 * Why:
 * - `react-scripts test` exits non-zero on failing tests, which prevents follow-up steps
 *   (like the coverage gate) from running in typical CI shell pipelines.
 * - This wrapper runs both and fails the job if either fails, while still printing a
 *   compact list of coverage threshold failures.
 */
/* eslint-disable no-console */
const { spawnSync } = require('child_process');

function run(cmd, args, opts) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true, // lets us resolve react-scripts from node_modules/.bin on all platforms
    ...opts
  });
  // spawnSync returns `status` as exit code (or null if killed by signal)
  const code = typeof res.status === 'number' ? res.status : 1;
  return code;
}

function main() {
  console.log('[test:ci] Running unit tests with coverage...');
  const testExit = run('react-scripts', ['test', '--watchAll=false', '--coverage', '--passWithNoTests', '--ci'], {
    env: { ...process.env }
  });

  // Always run the coverage gate so failures are visible even when tests failed.
  console.log('[test:ci] Running coverage gate...');
  const gateExit = run('node', ['scripts/check-coverage.js'], {
    env: { ...process.env, COVERAGE_GATE_FORMAT: process.env.COVERAGE_GATE_FORMAT || 'compact' }
  });

  if (testExit === 0 && gateExit === 0) {
    console.log('[test:ci] PASS');
    process.exit(0);
  }

  // Prefer the unit test exit code if tests failed; otherwise propagate the gate exit code.
  const finalExit = testExit !== 0 ? testExit : gateExit;
  console.error(`[test:ci] FAIL (tests=${testExit}, coverage-gate=${gateExit})`);
  process.exit(finalExit || 1);
}

main();





