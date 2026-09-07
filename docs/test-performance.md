# Test runtime measurement

## Current suite: under 30 seconds

Measured September 7, 2026 on an Apple M5 Pro Mac with 18 logical CPUs, using Bun 1.3.3 and dependencies installed with `bun install --frozen-lockfile`.

The default `bun run test` discovers all tests under `src/` and `scripts/`. Each file runs in a separate process, with up to eight workers bounded by available CPU parallelism. Measured expensive files start first; scheduling hints do not control discovery or exclude new tests. Native options still delegate to Bun's serial runner. `bun run test:serial` uses the same discovery roots.

Wall time includes process startup and captured stdout/stderr, measured with:

```sh
/usr/bin/time -p bun run test > /tmp/ship-tests.log 2>&1
```

Runs were sequential, with no other validation jobs launched concurrently.

| Run | Wall time | Result |
| --- | ---: | --- |
| 1 | 17.50 s | 689 passed, 96 files, zero failures |
| 2 | 17.01 s | 689 passed, 96 files, zero failures |
| 3 | 18.44 s | 689 passed, 96 files, zero failures |

All three runs are below the 30-second target. Each executed 336,660 assertions. These are local measurements, not a guarantee for slower CPUs or heavily loaded machines.

The installed-dependency baseline took 31.59 seconds across 95 files with two failures: the Yamato ten-minute flooding scenario exceeded Bun's default five-second timeout, and the review-page test's asset-validation subprocess required an absent ignored review ZIP. That failing run is diagnostic evidence, not a passing-suite speedup comparison. Earlier measurements of 34 files / 228 tests do not represent the current suite.

Changes:

- Schedule measured expensive files first and raise the worker cap from six to eight.
- Discover all `src/` and `scripts/` tests, adding the previously omitted reference clearance tests.
- Serve real retained review pages through Vite using a temporary public directory with directory symlinks. This retains every page assertion and removes repeated whole-asset validation and writes to the shared served directory. `bun run build` remains responsible for asset hashes and freshness.
- Give the Yamato ten-minute flooding scenario the same 15-second per-test timeout as its Bismarck counterpart. No simulation steps, fixtures, or assertions were removed or shortened.
- Reject invalid runner concurrency instead of silently scheduling no work.

Temporary runner fixtures verified success, assertion failures, module-load failures, and invalid concurrency. Native name filtering was also checked against the newly included reference tests.

`bun run build` was run separately and fails on pre-existing missing ignored review ZIPs for Bismarck, Yamato, Baltimore, Enterprise and Type VIIC. The asset validator and authoring/build artifacts were not changed by this test-runtime work. This failure remains visible in the build gate; a passing test suite is not a claim that asset freshness validation passed.
