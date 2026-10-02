# Long-running operations and global jobs

[English](JOBS.md) | [Français](../fr/technical/JOBS.md)

[← Documentation](../README.md)

A long-running operation (password recovery today; transcoding, OCR, or
transcription tomorrow) must **not** belong to the lifecycle of the React
component that started it. Leaving the tool page must neither stop it nor lose
track of it. Phase 2D introduces the infrastructure that guarantees this.

## Two separate mechanisms

| | `core/jobs` (`useJob`) | `features/jobs` (global store) |
| --- | --- | --- |
| Scope | local to the component | **global**, outside React |
| Use | short, *synchronous* PDF operations (merge, compression, and so on) that only live as long as the screen | long-running *native* operations that must survive navigation |
| Cancellation | the component's `AbortController` | native flag through the controller |

`useJob` remains the contract for short operations run by `PdfToolShell`. The
**global manager** is new and targets long-running native operations.

## The global manager — `src/features/jobs/`

- `store.ts` — a Zustand store that is the **source of truth** for jobs: `id`,
  `toolId`, `kind`, `title`, `status` (`running` | `cancelling` | `done` |
  `error`), `progress`, `total`, `result`, `error`, `startedAt`/`endedAt`, and
  `cancellable`. It only retains state that can be **displayed** (nothing heavy
  or non-serializable).
- `recovery.ts` — the recovery **controller**. It owns the native session
  (subscription to Tauri events) outside every component, updates the store on
  each progress event and at completion, and separately keeps the data that
  must not enter the store (document bytes and session). It is injectable in
  tests through `__setRecoveryStarter`.
- `hooks.ts` — `useToolJob(toolId)` reconnects a screen to its job, while
  `useActiveJobs()` drives the global indicator.

### Internal navigation

The tool page **subscribes** to the job through `useToolJob` instead of owning
it. It no longer cancels the job when unmounted. Leaving the tool and returning
to it restores the running job (counter, rate, elapsed time, ETA, and Stop
button) or its result without restarting anything. A job completed while the
page was away displays its result on return.

### Global indicator

While a job is active, `AppShell` displays “N operation(s) in progress” in the
sidebar, including when the sidebar is collapsed. Clicking it returns to the
relevant tool.

### Only one recovery job at a time

The native engine runs only one search at a time on a dedicated thread. The
controller mirrors that restriction: starting a second search while one is
running is refused with a clear message. Restarting replaces a completed job
(one job per tool, with no ghost duplicate).

## Reloading and closing — chosen strategy

The application distinguishes **internal SPA navigation** from an **actual
reload or window close**:

- **Internal navigation:** the job continues and remains visible as described
  above. React Router does not trigger `beforeunload`.
- **Actual reload or close:** `installRecoveryShutdownGuard()` in `main.tsx`
  listens for `beforeunload` and **stops** any native search that is still
  alive. This prevents a forbidden state: an invisible, CPU-intensive Rust
  operation that the frontend can no longer track.

Stopping is reliable and quick because the engine checks the cancellation flag
**inside** every batch, as described below. The native thread exits within a
few milliseconds.

## Cancellation fix in the native engine

In `src-tauri/src/recovery/engine.rs`, the cancellation flag was previously
checked only **between** batches. A batch contains 60,000 candidates; with
AES-256 (about 20,000 attempts per second, deliberately slow), one batch takes
about three seconds. Clicking Stop therefore appeared to do nothing until that
delay elapsed.

The flag is now checked **inside** the parallel verification of the batch:
`par_iter().find_any(|c| should_cancel() || verify(c))`. Once cancellation is
requested, `find_any` short-circuits on the next candidate handled by each
thread. The returned candidate is checked again to distinguish a real match
from a cancellation short-circuit. Stopping no longer depends on batch size and
takes roughly a millisecond in a release build. The counter stops increasing,
CPU use falls, no zombie thread or lock remains, and a new search can begin
immediately. A late “password found” notification cannot follow cancellation,
because the search returns a single terminal outcome.

The `recovery::engine` tests cover cancellation during a batch, cancellation
through a shared flag from another thread (followed by a working restart), and
the “start → immediate cancellation” race. On the TypeScript side,
`features/jobs/*.test.ts` covers creation, progress, reconnection, completion,
results, errors, immediate cancellation, and restarting.
