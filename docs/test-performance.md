# Test runtime measurement

Measured September 6, 2026 using Bun 1.2.18 on the local macOS machine with 18 logical CPUs. Dependencies were installed from `bun.lock` before measuring. Both commands used the same runtime, checkout, 34 test files and 228 tests; no assertions, fixtures or simulation durations changed.

The previous test command remains available as `bun run test:serial`. The new `bun run test` launches a separate process per file, with up to six simultaneous workers, bounded by available CPU parallelism. Separate processes also prevent earlier test files from affecting later files' runtime state. Native Bun options use the serial runner.

Wall time was measured with Python `time.perf_counter()` around `subprocess.run`, including process startup and capturing all output. Serial and parallel commands alternated three times, with no other validation jobs launched concurrently. Every run exited successfully with 228 passing tests and zero failures.

| Run | Serial | Parallel |
| --- | ---: | ---: |
| 1 | 22.345 s | 4.252 s |
| 2 | 23.905 s | 4.956 s |
| 3 | 23.624 s | 4.674 s |
| Median | 23.624 s | 4.674 s |

Median runtime decreased **80.2%**, calculated as `1 - 4.674 / 23.624`, exceeding the 66% target. Results depend on CPU availability and system load; the original single-process command is retained for comparison and shared-state diagnosis.

Additional runner checks verified successful files, propagation of assertion and module-load failures, and native name filtering (one passing test, 227 filtered out).
