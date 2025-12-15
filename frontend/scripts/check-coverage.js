/**
 * Coverage gate for CRA/Jest (react-scripts test --coverage).
 *
 * Enforces:
 * - Global thresholds (overall project coverage)
 * - Per-file thresholds (defaults to only changed files in a PR)
 *
 * Why a separate gate (instead of Jest's coverageThreshold)?
 * - We can always run tests, upload artifacts, and still fail the job at the end.
 * - We can apply per-file rules in a more flexible way.
 */

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_ROOT = path.resolve(REPO_ROOT, 'frontend');
const COVERAGE_DIR = path.resolve(FRONTEND_ROOT, 'coverage');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function pct(covered, total) {
  if (!total) return 100;
  return (covered / total) * 100;
}

function normalizeToRepoRelative(fileKey) {
  const norm = fileKey.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/frontend/');
  if (idx >= 0) return norm.slice(idx + 1); // strip leading slash
  // Sometimes keys may already be relative like "src/..." when run from frontend.
  if (norm.startsWith('src/')) return `frontend/${norm}`;
  if (norm.startsWith('frontend/')) return norm;
  return norm;
}

function getCoveragePctForFile(fileCov) {
  // Istanbul format: s/f/b/l objects with hit counts.
  const statements = fileCov.s ? Object.values(fileCov.s) : [];
  const functions = fileCov.f ? Object.values(fileCov.f) : [];
  const branches = fileCov.b ? Object.values(fileCov.b).flat() : [];
  // CRA's coverage-final.json (istanbul) typically does NOT include a "l" map for line coverage.
  // Derive line coverage from statementMap: each statement contributes a line (start.line).
  const statementMap = fileCov.statementMap || {};
  const lineSet = new Set();
  const coveredLineSet = new Set();
  for (const [sid, loc] of Object.entries(statementMap)) {
    const line = loc?.start?.line;
    if (typeof line !== 'number') continue;
    lineSet.add(line);
    const hit = fileCov.s?.[sid];
    if (typeof hit === 'number' && hit > 0) {
      coveredLineSet.add(line);
    }
  }

  const stmtCovered = statements.filter((n) => n > 0).length;
  const fnCovered = functions.filter((n) => n > 0).length;
  const brCovered = branches.filter((n) => n > 0).length;
  const lineCovered = coveredLineSet.size;
  const lineTotal = lineSet.size;

  return {
    statements: pct(stmtCovered, statements.length),
    functions: pct(fnCovered, functions.length),
    branches: pct(brCovered, branches.length),
    lines: pct(lineCovered, lineTotal),
    covered: {
      statements: stmtCovered,
      functions: fnCovered,
      branches: brCovered,
      lines: lineCovered
    },
    totals: {
      statements: statements.length,
      functions: functions.length,
      branches: branches.length,
      lines: lineTotal
    }
  };
}

function loadThresholds() {
  const thresholdFile = path.resolve(FRONTEND_ROOT, 'coverage-thresholds.json');
  if (!exists(thresholdFile)) {
    throw new Error(`Missing coverage thresholds file: ${thresholdFile}`);
  }
  return readJson(thresholdFile);
}

function isExcluded(repoRelPath, excludeList) {
  return (excludeList || []).some((pat) => {
    // Simple prefix/exact matching to avoid adding glob dependencies.
    // - If pattern ends with '/', treat as prefix
    // - Else, treat as exact path match
    if (pat.endsWith('/')) return repoRelPath.startsWith(pat);
    return repoRelPath === pat;
  });
}

function getChangedFrontendSourceFiles() {
  const baseRef = process.env.GITHUB_BASE_REF || '';
  const headSha = process.env.GITHUB_SHA || 'HEAD';

  if (!baseRef) {
    console.warn('[coverage-gate] GITHUB_BASE_REF not set; cannot compute changed files. Falling back to all files.');
    return null;
  }

  // Ensure base ref exists locally. (best effort)
  const baseRefFull = `origin/${baseRef}`;
  const hasBase = spawnSync('git', ['rev-parse', '--verify', baseRefFull], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  if (hasBase.status !== 0) {
    spawnSync('git', ['fetch', '--no-tags', 'origin', `${baseRef}:${baseRef}`], {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    });
  }

  const diff = spawnSync('git', ['diff', '--name-only', `${baseRefFull}...${headSha}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  if (diff.status !== 0) {
    console.warn('[coverage-gate] git diff failed; falling back to all files.');
    return null;
  }

  const files = diff.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => p.startsWith('frontend/src/'))
    .filter((p) => !p.includes('__mocks__'))
    .filter((p) => !p.endsWith('.d.ts'))
    .filter((p) => !p.endsWith('.test.ts'))
    .filter((p) => !p.endsWith('.test.tsx'));

  return new Set(files);
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

function main() {
  const thresholds = loadThresholds();

  const coverageFinalPath = path.resolve(COVERAGE_DIR, 'coverage-final.json');

  if (!exists(coverageFinalPath)) {
    fail(`[coverage-gate] Missing ${coverageFinalPath}. Did Jest run with --coverage?`);
  }

  const globalReq = thresholds.global || {};
  const globalFailures = [];

  const coverageFinal = readJson(coverageFinalPath);
  const excludeList = thresholds.exclude || [];

  // Compute global coverage from coverage-final.json (CRA doesn't always emit coverage-summary.json).
  const globalTotals = {
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 }
  };

  for (const [fileKey, fileCov] of Object.entries(coverageFinal)) {
    const repoRel = normalizeToRepoRelative(fileKey);
    if (!repoRel.startsWith('frontend/src/')) continue;
    if (isExcluded(repoRel, excludeList)) continue;
    const filePct = getCoveragePctForFile(fileCov);
    for (const metric of ['statements', 'functions', 'branches', 'lines']) {
      const totalCount = filePct.totals[metric];
      const coveredCount = filePct.covered[metric];
      if (typeof totalCount !== 'number' || typeof coveredCount !== 'number') continue;
      globalTotals[metric].total += totalCount;
      globalTotals[metric].covered += coveredCount;
    }
  }

  const globalActual = {
    statements: pct(globalTotals.statements.covered, globalTotals.statements.total),
    branches: pct(globalTotals.branches.covered, globalTotals.branches.total),
    functions: pct(globalTotals.functions.covered, globalTotals.functions.total),
    lines: pct(globalTotals.lines.covered, globalTotals.lines.total)
  };

  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    if (typeof globalReq[metric] !== 'number') continue;
    const actual = globalActual[metric];
    if (actual + 1e-9 < globalReq[metric]) {
      globalFailures.push(`${metric}: ${actual.toFixed(2)}% < ${globalReq[metric]}%`);
    }
  }

  const mode = thresholds.mode || 'all'; // "changed" or "all"
  const changed = mode === 'changed' ? getChangedFrontendSourceFiles() : null;

  const perFileReq = thresholds.perFile || {};
  const perFileMetric = Object.keys(perFileReq);
  const perFileFailures = [];

  for (const [fileKey, fileCov] of Object.entries(coverageFinal)) {
    const repoRel = normalizeToRepoRelative(fileKey);
    if (!repoRel.startsWith('frontend/src/')) continue;
    if (isExcluded(repoRel, excludeList)) continue;
    if (changed && !changed.has(repoRel)) continue;

    const filePct = getCoveragePctForFile(fileCov);

    for (const metric of perFileMetric) {
      const required = perFileReq[metric];
      if (typeof required !== 'number') continue;
      const actual = filePct[metric];
      if (typeof actual !== 'number') continue;
      if (actual + 1e-9 < required) {
        perFileFailures.push(
          `${repoRel} :: ${metric} ${actual.toFixed(2)}% < ${required}% (total ${filePct.totals[metric] ?? 'n/a'})`
        );
        // Only report first metric failure per file to keep logs readable
        break;
      }
    }
  }

  if (globalFailures.length === 0 && perFileFailures.length === 0) {
    console.log('[coverage-gate] PASS');
    console.log(
      `[coverage-gate] Global coverage: lines ${globalActual.lines.toFixed(2)}%, statements ${globalActual.statements.toFixed(
        2
      )}%, branches ${globalActual.branches.toFixed(2)}%, functions ${globalActual.functions.toFixed(2)}%`
    );
    if (changed) {
      console.log(`[coverage-gate] Per-file checks applied to ${changed.size} changed frontend/src files`);
    } else {
      console.log('[coverage-gate] Per-file checks applied to all frontend/src files (or changed-files unavailable)');
    }
    return;
  }

  console.error('[coverage-gate] FAIL');
  console.error(
    `[coverage-gate] Global coverage: lines ${globalActual.lines.toFixed(2)}%, statements ${globalActual.statements.toFixed(
      2
    )}%, branches ${globalActual.branches.toFixed(2)}%, functions ${globalActual.functions.toFixed(2)}%`
  );

  if (globalFailures.length) {
    console.error('[coverage-gate] Global threshold failures:');
    for (const f of globalFailures) console.error(`- ${f}`);
  }

  if (perFileFailures.length) {
    console.error('[coverage-gate] Per-file threshold failures:');
    for (const f of perFileFailures.slice(0, 200)) console.error(`- ${f}`);
    if (perFileFailures.length > 200) {
      console.error(`[coverage-gate] ... and ${perFileFailures.length - 200} more`);
    }
  }

  process.exit(2);
}

main();


