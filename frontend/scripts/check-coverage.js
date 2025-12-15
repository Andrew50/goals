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

const VERBOSE =
  process.env.COVERAGE_GATE_VERBOSE === '1' ||
  process.env.COVERAGE_GATE_VERBOSE === 'true' ||
  process.env.COVERAGE_GATE_VERBOSE === 'yes';

const OUTPUT_FORMAT = (process.env.COVERAGE_GATE_FORMAT || '').toLowerCase(); // "compact" | (default verbose)

function toIntEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

const MAX_FAILURES_TO_PRINT = toIntEnv('COVERAGE_GATE_MAX_FAILURES', 500);
const TOP_LOWEST_FILES_TO_PRINT = toIntEnv('COVERAGE_GATE_TOP_LOWEST_FILES', 30);

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

function fmtPct(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 'n/a';
  return `${n.toFixed(2)}%`;
}

function metricLabel(metric) {
  switch (metric) {
    case 'statements':
      return 'statements';
    case 'branches':
      return 'branches';
    case 'functions':
      return 'functions';
    case 'lines':
      return 'lines';
    default:
      return String(metric);
  }
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

function tryReadGithubEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !exists(eventPath)) return null;
  try {
    return readJson(eventPath);
  } catch (e) {
    console.warn('[coverage-gate] Failed to parse GITHUB_EVENT_PATH payload; ignoring.');
    return null;
  }
}

function isPullRequestContext() {
  if (process.env.GITHUB_BASE_REF) return true;
  const eventName = process.env.GITHUB_EVENT_NAME || '';
  if (eventName.includes('pull_request')) return true;
  const payload = tryReadGithubEventPayload();
  return Boolean(payload && payload.pull_request);
}

function ensureGitRefAvailable(ref, fetchSpec) {
  const has = spawnSync('git', ['rev-parse', '--verify', ref], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  if (has.status === 0) return true;
  if (!fetchSpec) return false;

  const fetched = spawnSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', fetchSpec], {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  });
  return fetched.status === 0;
}

function ensureShaAvailable(sha, targetRef, fetchSpec) {
  // Prefer using the SHA directly if it's already present locally. Only fall back to fetching into targetRef.
  const hasLocal = ensureGitRefAvailable(sha, null);
  if (hasLocal) return sha;
  if (!fetchSpec) return null;
  const ok = ensureGitRefAvailable(targetRef, fetchSpec);
  return ok ? targetRef : null;
}

function resolveDiffBaseAndHead() {
  const payload = tryReadGithubEventPayload();
  const pr = payload?.pull_request;
  if (pr?.base?.sha && pr?.head?.sha) {
    // Prefer explicit SHAs from the PR payload when available.
    const baseSha = pr.base.sha;
    const headSha = pr.head.sha;
    return { base: baseSha, head: headSha, baseFetchSpec: `${baseSha}:refs/coverage-gate/base`, headFetchSpec: `${headSha}:refs/coverage-gate/head` };
  }

  const baseRef = process.env.GITHUB_BASE_REF || process.env.COVERAGE_GATE_BASE_REF || '';
  const head = process.env.GITHUB_SHA || process.env.COVERAGE_GATE_HEAD_REF || 'HEAD';
  if (!baseRef) return null;

  // If baseRef is already a full ref like "origin/main", use it as-is; otherwise treat it as a branch name.
  const base = baseRef.includes('/') ? baseRef : `origin/${baseRef}`;
  // For branch bases, fetching "branch" updates refs/remotes/origin/branch in a typical clone.
  const baseFetchSpec = baseRef.includes('/') ? null : baseRef;
  return { base, head, baseFetchSpec, headFetchSpec: null };
}

function getChangedFrontendSourceFiles({ allowSkip = false } = {}) {
  const resolved = resolveDiffBaseAndHead();
  if (!resolved) {
    const msg = '[coverage-gate] Unable to determine diff base; cannot compute changed files.';
    if (allowSkip) {
      console.warn(`${msg} Skipping changed-files gating.`);
      return null;
    }
    console.warn(`${msg} Falling back to all files.`);
    return null;
  }

  let baseRefForDiff = resolved.base;
  let headRefForDiff = resolved.head;

  // Ensure base/head are present locally. If they are SHAs, fetch into stable local refs.
  const baseLooksLikeSha = /^[0-9a-f]{7,40}$/i.test(baseRefForDiff);
  const headLooksLikeSha = /^[0-9a-f]{7,40}$/i.test(headRefForDiff);

  if (baseLooksLikeSha) {
    const baseResolved = ensureShaAvailable(baseRefForDiff, 'refs/coverage-gate/base', resolved.baseFetchSpec);
    if (!baseResolved) {
      console.warn('[coverage-gate] Failed to resolve base SHA; falling back to all files.');
      return null;
    }
    baseRefForDiff = baseResolved;
  } else if (resolved.baseFetchSpec) {
    // Best-effort fetch of base branch if missing.
    ensureGitRefAvailable(baseRefForDiff, resolved.baseFetchSpec);
  }

  if (headLooksLikeSha) {
    const headResolved = ensureShaAvailable(headRefForDiff, 'refs/coverage-gate/head', resolved.headFetchSpec);
    if (!headResolved) {
      console.warn('[coverage-gate] Failed to resolve head SHA; falling back to all files.');
      return null;
    }
    headRefForDiff = headResolved;
  }

  const diff = spawnSync('git', ['diff', '--name-only', `${baseRefForDiff}...${headRefForDiff}`], {
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

function printCompactFailures({ globalFailures, perFileFailures }) {
  // Only print what failed + actual vs required.
  if (globalFailures.length) {
    console.error('[coverage-gate] global:');
    for (const f of globalFailures) {
      console.error(
        `[coverage-gate] - ${metricLabel(f.metric)} required ${fmtPct(f.required)} actual ${fmtPct(f.actual)} (${f.covered}/${f.total})`
      );
    }
  }
  if (perFileFailures.length) {
    console.error('[coverage-gate] per-file:');
    const sorted = perFileFailures.slice().sort((a, b) => (b.delta || 0) - (a.delta || 0));
    const limit = Math.min(sorted.length, MAX_FAILURES_TO_PRINT);
    for (const f of sorted.slice(0, limit)) {
      console.error(
        `[coverage-gate] - ${f.file} ${metricLabel(f.metric)} required ${fmtPct(f.required)} actual ${fmtPct(f.actual)} (${f.covered}/${f.total})`
      );
    }
    if (sorted.length > limit) console.error(`[coverage-gate] ... and ${sorted.length - limit} more`);
  }
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
  const includedTotals = {
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 }
  };

  // Support an "auto" mode: gate changed files in PRs; otherwise skip gating (to avoid forcing legacy projects to 80%).
  const configuredMode = (process.env.COVERAGE_GATE_MODE || thresholds.mode || 'auto').toLowerCase(); // "changed" | "all" | "auto"
  const prContext = isPullRequestContext();
  const shouldComputeChanged = configuredMode === 'changed' || configuredMode === 'auto';
  const changed = shouldComputeChanged ? getChangedFrontendSourceFiles({ allowSkip: configuredMode === 'auto' && !prContext }) : null;

  let effectiveMode = configuredMode;
  if (configuredMode === 'auto') {
    if (prContext) {
      // In PRs, auto mode MUST be able to compute changed files; otherwise we'd silently skip enforcement.
      if (!changed) {
        fail(
          '[coverage-gate] AUTO mode requires changed-files in PR context but failed to compute them. Ensure the checkout has git metadata and that base/head refs are fetchable.'
        );
      }
      effectiveMode = 'changed';
    } else {
      // Outside PRs, auto mode skips gating unless changed files are explicitly computable via env overrides.
      effectiveMode = changed ? 'changed' : 'auto';
    }
  }

  // In auto mode outside PRs (and with no explicit changed set), we skip gating entirely.
  const skipGating = effectiveMode === 'auto';

  const gatedTotals = {
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
      includedTotals[metric].total += totalCount;
      includedTotals[metric].covered += coveredCount;

      // Gated totals are either:
      // - all included files (mode=all)
      // - only changed files (mode=changed/auto when changed set is available)
      const inGate = effectiveMode === 'all' || (effectiveMode === 'changed' && changed && changed.has(repoRel));
      if (inGate) {
        gatedTotals[metric].total += totalCount;
        gatedTotals[metric].covered += coveredCount;
      }
    }
  }

  const includedActual = {
    statements: pct(includedTotals.statements.covered, includedTotals.statements.total),
    branches: pct(includedTotals.branches.covered, includedTotals.branches.total),
    functions: pct(includedTotals.functions.covered, includedTotals.functions.total),
    lines: pct(includedTotals.lines.covered, includedTotals.lines.total)
  };

  const gatedActual = {
    statements: pct(gatedTotals.statements.covered, gatedTotals.statements.total),
    branches: pct(gatedTotals.branches.covered, gatedTotals.branches.total),
    functions: pct(gatedTotals.functions.covered, gatedTotals.functions.total),
    lines: pct(gatedTotals.lines.covered, gatedTotals.lines.total)
  };

  const actualForThresholds = skipGating ? null : gatedActual;
  const totalsForThresholds = skipGating ? null : gatedTotals;

  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    if (typeof globalReq[metric] !== 'number') continue;
    if (skipGating) continue;
    const actual = actualForThresholds[metric];
    const required = globalReq[metric];
    if (actual + 1e-9 < required) {
      globalFailures.push({
        scope: 'global',
        file: null,
        metric,
        required,
        actual,
        covered: totalsForThresholds[metric].covered,
        total: totalsForThresholds[metric].total,
        delta: required - actual
      });
    }
  }

  const perFileReq = thresholds.perFile || {};
  const perFileMetric = Object.keys(perFileReq);
  const perFileFailures = [];
  // For verbose diagnostics, keep both:
  // - all included frontend/src files (regardless of mode=changed)
  // - gated files (after applying changed-files filter, if any)
  const allIncludedFileLineCoverage = [];
  const gatedFileLineCoverage = [];

  for (const [fileKey, fileCov] of Object.entries(coverageFinal)) {
    const repoRel = normalizeToRepoRelative(fileKey);
    if (!repoRel.startsWith('frontend/src/')) continue;
    if (isExcluded(repoRel, excludeList)) continue;

    const filePct = getCoveragePctForFile(fileCov);

    allIncludedFileLineCoverage.push({
      file: repoRel,
      linesPct: filePct.lines,
      covered: filePct.covered.lines,
      total: filePct.totals.lines
    });

    if (!skipGating) {
      const shouldGateFile = effectiveMode === 'all' || (effectiveMode === 'changed' && changed && changed.has(repoRel));
      if (!shouldGateFile) continue;
    } else {
      // auto mode outside PRs: no per-file gating
      continue;
    }
    gatedFileLineCoverage.push({
      file: repoRel,
      linesPct: filePct.lines,
      covered: filePct.covered.lines,
      total: filePct.totals.lines
    });

    for (const metric of perFileMetric) {
      const required = perFileReq[metric];
      if (typeof required !== 'number') continue;
      const actual = filePct[metric];
      if (typeof actual !== 'number') continue;
      if (actual + 1e-9 < required) {
        perFileFailures.push({
          scope: 'file',
          file: repoRel,
          metric,
          required,
          actual,
          covered: filePct.covered[metric],
          total: filePct.totals[metric],
          delta: required - actual
        });
      }
    }
  }

  if (globalFailures.length === 0 && perFileFailures.length === 0) {
    if (OUTPUT_FORMAT === 'compact') {
      console.log(
        `[coverage-gate] PASS global lines ${fmtPct(globalActual.lines)} statements ${fmtPct(globalActual.statements)} branches ${fmtPct(
          globalActual.branches
        )} functions ${fmtPct(globalActual.functions)}`
      );
      return;
    }

    console.log('[coverage-gate] PASS');
    console.log('[coverage-gate] Thresholds:');
    console.log(
      `[coverage-gate] - global: lines ${fmtPct(globalReq.lines)} statements ${fmtPct(globalReq.statements)} branches ${fmtPct(
        globalReq.branches
      )} functions ${fmtPct(globalReq.functions)}`
    );
    console.log(
      `[coverage-gate] - perFile: ${Object.keys(perFileReq)
        .map((k) => `${metricLabel(k)} ${fmtPct(perFileReq[k])}`)
        .join(', ') || '(none)'}`
    );
    console.log(`[coverage-gate] - mode: ${configuredMode}`);
    console.log(`[coverage-gate] - exclude: ${(excludeList || []).length ? excludeList.join(', ') : '(none)'}`);
    console.log('[coverage-gate] Actual global coverage (included files):');
    console.log(
      `[coverage-gate] - lines ${fmtPct(includedActual.lines)} (${includedTotals.lines.covered}/${includedTotals.lines.total}), statements ${fmtPct(
        includedActual.statements
      )} (${includedTotals.statements.covered}/${includedTotals.statements.total}), branches ${fmtPct(includedActual.branches)} (${
        includedTotals.branches.covered
      }/${includedTotals.branches.total}), functions ${fmtPct(includedActual.functions)} (${includedTotals.functions.covered}/${
        includedTotals.functions.total
      })`
    );
    if (skipGating) {
      console.log('[coverage-gate] Auto mode: not in PR context; skipping gating checks.');
    } else if (effectiveMode === 'all') {
      console.log('[coverage-gate] Per-file checks applied to all included frontend/src files');
    } else if (changed) {
      console.log(`[coverage-gate] Per-file checks applied to ${changed.size} changed frontend/src files`);
      console.log(
        `[coverage-gate] Actual global coverage (gated set): lines ${fmtPct(gatedActual.lines)} (${gatedTotals.lines.covered}/${gatedTotals.lines.total}), statements ${fmtPct(
          gatedActual.statements
        )} (${gatedTotals.statements.covered}/${gatedTotals.statements.total}), branches ${fmtPct(gatedActual.branches)} (${gatedTotals.branches.covered}/${
          gatedTotals.branches.total
        }), functions ${fmtPct(gatedActual.functions)} (${gatedTotals.functions.covered}/${gatedTotals.functions.total})`
      );
    } else {
      console.log('[coverage-gate] Per-file checks could not be scoped (changed-files unavailable); gating used included set.');
      console.log(
        `[coverage-gate] Actual global coverage (gated set): lines ${fmtPct(gatedActual.lines)} (${gatedTotals.lines.covered}/${gatedTotals.lines.total}), statements ${fmtPct(
          gatedActual.statements
        )} (${gatedTotals.statements.covered}/${gatedTotals.statements.total}), branches ${fmtPct(gatedActual.branches)} (${gatedTotals.branches.covered}/${
          gatedTotals.branches.total
        }), functions ${fmtPct(gatedActual.functions)} (${gatedTotals.functions.covered}/${gatedTotals.functions.total})`
      );
    }
    return;
  }

  console.error('[coverage-gate] FAIL');

  if (OUTPUT_FORMAT === 'compact') {
    printCompactFailures({ globalFailures, perFileFailures });
    process.exit(2);
  }

  console.error('[coverage-gate] Thresholds:');
  console.error(
    `[coverage-gate] - global: lines ${fmtPct(globalReq.lines)} statements ${fmtPct(globalReq.statements)} branches ${fmtPct(
      globalReq.branches
    )} functions ${fmtPct(globalReq.functions)}`
  );
  console.error(
    `[coverage-gate] - perFile: ${Object.keys(perFileReq)
      .map((k) => `${metricLabel(k)} ${fmtPct(perFileReq[k])}`)
      .join(', ') || '(none)'}`
  );
    console.error(`[coverage-gate] - mode: ${configuredMode}`);
  console.error(`[coverage-gate] - exclude: ${(excludeList || []).length ? excludeList.join(', ') : '(none)'}`);
  console.error('[coverage-gate] Actual global coverage (included files):');
  console.error(
    `[coverage-gate] - lines ${fmtPct(includedActual.lines)} (${includedTotals.lines.covered}/${includedTotals.lines.total}), statements ${fmtPct(
      includedActual.statements
    )} (${includedTotals.statements.covered}/${includedTotals.statements.total}), branches ${fmtPct(includedActual.branches)} (${
      includedTotals.branches.covered
    }/${includedTotals.branches.total}), functions ${fmtPct(includedActual.functions)} (${includedTotals.functions.covered}/${
      includedTotals.functions.total
    })`
  );
  if (skipGating) {
    console.error('[coverage-gate] Auto mode: not in PR context; skipping gating checks.');
  } else if (effectiveMode === 'all') {
    console.error('[coverage-gate] Per-file checks applied to all included frontend/src files');
    console.error(
      `[coverage-gate] Actual global coverage (gated set): lines ${fmtPct(gatedActual.lines)} (${gatedTotals.lines.covered}/${gatedTotals.lines.total}), statements ${fmtPct(
        gatedActual.statements
      )} (${gatedTotals.statements.covered}/${gatedTotals.statements.total}), branches ${fmtPct(gatedActual.branches)} (${gatedTotals.branches.covered}/${
        gatedTotals.branches.total
      }), functions ${fmtPct(gatedActual.functions)} (${gatedTotals.functions.covered}/${gatedTotals.functions.total})`
    );
  } else if (changed) {
    console.error(`[coverage-gate] Per-file checks applied to ${changed.size} changed frontend/src files`);
    console.error(
      `[coverage-gate] Actual global coverage (gated set): lines ${fmtPct(gatedActual.lines)} (${gatedTotals.lines.covered}/${gatedTotals.lines.total}), statements ${fmtPct(
        gatedActual.statements
      )} (${gatedTotals.statements.covered}/${gatedTotals.statements.total}), branches ${fmtPct(gatedActual.branches)} (${gatedTotals.branches.covered}/${
        gatedTotals.branches.total
      }), functions ${fmtPct(gatedActual.functions)} (${gatedTotals.functions.covered}/${gatedTotals.functions.total})`
    );
  } else {
    console.error('[coverage-gate] Changed-files unavailable; gating used included set.');
    console.error(
      `[coverage-gate] Actual global coverage (gated set): lines ${fmtPct(gatedActual.lines)} (${gatedTotals.lines.covered}/${gatedTotals.lines.total}), statements ${fmtPct(
        gatedActual.statements
      )} (${gatedTotals.statements.covered}/${gatedTotals.statements.total}), branches ${fmtPct(gatedActual.branches)} (${gatedTotals.branches.covered}/${
        gatedTotals.branches.total
      }), functions ${fmtPct(gatedActual.functions)} (${gatedTotals.functions.covered}/${gatedTotals.functions.total})`
    );
  }

  if (globalFailures.length) {
    console.error('[coverage-gate] Global threshold failures:');
    for (const f of globalFailures) {
      console.error(
        `- ${metricLabel(f.metric)}: actual ${fmtPct(f.actual)} (${f.covered}/${f.total}) < required ${fmtPct(f.required)} (missed by ${fmtPct(
          f.delta
        )})`
      );
    }
  }

  if (perFileFailures.length) {
    console.error('[coverage-gate] Per-file threshold failures:');
    const sorted = perFileFailures.slice().sort((a, b) => (b.delta || 0) - (a.delta || 0));
    const limit = Math.min(sorted.length, MAX_FAILURES_TO_PRINT);
    for (const f of sorted.slice(0, limit)) {
      console.error(
        `- ${f.file} :: ${metricLabel(f.metric)} actual ${fmtPct(f.actual)} (${f.covered}/${f.total}) < required ${fmtPct(
          f.required
        )} (missed by ${fmtPct(f.delta)})`
      );
    }
    if (sorted.length > limit) console.error(`[coverage-gate] ... and ${sorted.length - limit} more`);
  }

  if (VERBOSE) {
    console.error(`[coverage-gate] Verbose diagnostics (COVERAGE_GATE_VERBOSE=1):`);
    const lineSorted = allIncludedFileLineCoverage
      .slice()
      .sort((a, b) => (a.linesPct || 0) - (b.linesPct || 0))
      .slice(0, TOP_LOWEST_FILES_TO_PRINT);
    if (lineSorted.length) {
      console.error(`[coverage-gate] Lowest line coverage files (top ${lineSorted.length}):`);
      for (const f of lineSorted) {
        console.error(`- ${f.file} :: lines ${fmtPct(f.linesPct)} (${f.covered}/${f.total})`);
      }
    }

    if (changed) {
      const gatedSorted = gatedFileLineCoverage
        .slice()
        .sort((a, b) => (a.linesPct || 0) - (b.linesPct || 0))
        .slice(0, TOP_LOWEST_FILES_TO_PRINT);
      if (gatedSorted.length) {
        console.error(`[coverage-gate] Lowest line coverage files in changed set (top ${gatedSorted.length}):`);
        for (const f of gatedSorted) {
          console.error(`- ${f.file} :: lines ${fmtPct(f.linesPct)} (${f.covered}/${f.total})`);
        }
      }
    }
  }

  process.exit(2);
}

main();


