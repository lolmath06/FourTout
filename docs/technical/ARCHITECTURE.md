# FourTout architecture

[English](ARCHITECTURE.md) | [Français](../fr/technical/ARCHITECTURE.md)

[← Documentation](../README.md)

## Technology choices

| Choice | Reason |
| --- | --- |
| **Tauri 2** | Lightweight native application, Rust for FFmpeg/OCR/disk work, Windows and Linux installers. |
| **React 19, TypeScript, Vite 7** | Typed UI, quick startup, per-tool chunks. |
| **React Router HashRouter** | Identical routing without server rewrite rules in development and packaged builds. |
| **Zustand** | Shared favorites, recents, notifications, and settings without nested contexts. |
| **Tailwind CSS 4** | Dense, consistent UI; colors are centralized as `--ft-*` CSS variables. |
| **Vitest and Testing Library** | Vite-compatible transforms and real router integration tests. |
| **Storage interface over localStorage** | Simple persistence that can later move to a Tauri file store. |

## Structure

```text
src/
├── core/          Framework-independent business logic where possible
│   ├── tools/     Registry, categories, catalog, localization, and search
│   ├── intent/    resolveToolIntent() and the future local-LLM extension point
│   ├── storage/   KeyValueStore implementations
│   ├── files/ pdf/ image/ media/ ocr/ speech/ text/ code/ calc/ units/
│   ├── security/ sqlite/ diagnostics/ disks/ network/ currency/ convert/
│   ├── jobs/      Progress, error, and cancellation contracts
│   └── ui/ platform/
├── features/      Favorites, recents, notifications, handoff, jobs, settings
├── components/    Reusable UI and domain components
├── layouts/       Application shell
├── pages/         Route pages
├── tools/         Lazy implementation map, components, and pure tool logic
└── app/           Routes and application root

src-tauri/src/
├── media/ speech/ models/ recovery/
├── rates.rs       ECB rates, the only outbound Internet request
├── security/ sqlite/ network/ diagnostics/ disks/
└── files/         Archives, hashes, encryption, deletion, folder operations
```

## Registry: one source of truth

Each tool is declared once in `src/core/tools/catalog/`. The declaration feeds
category and Tools pages, localized search, favorites and recents, the
`/tools/t/:id` route, drop constraints, the universal conversion graph, and the
future local assistant.

**Being in the catalog means working.** There is no availability or “coming
soon” state. An incomplete tool is not registered, and a test keeps the catalog
and implementation map aligned. `alsoIn` can expose one definition in several
categories without duplication. Startup validation rejects duplicate IDs and
unknown categories.

## Search and intent

```text
user query → resolveToolIntent() → IntentResolver chain
           → ToolRegistry authority → tool navigation
```

Deterministic search combines weighted fields (name before aliases, keywords,
and description), complete-query bonuses, directional bonuses and penalties
so “GIF to video” differs from “video to GIF,” and a coverage threshold that
prefers no result over an unrelated one. A future local resolver can be
registered, but every candidate is revalidated through `ToolRegistry` and the
deterministic resolver remains the fallback.

## Long-running operations

`useJob()` exposes status, progress, result, error, and cancellation. The
operation receives `report()`, an `AbortSignal`, and `throwIfCancelled()`.
Video compression, OCR, speech, hashing, encryption, and password recovery use
this contract and the global task bar survives navigation. Cancellation stops
the native process, removes temporary files, and never presents partial output
as complete. See [JOBS.md](JOBS.md).

## Errors and user feedback

There is no `alert()`. `notify.success/error/warning/info/loading` feeds the
shared `ToastViewport`; long operations update their existing loading notice.

## Files and algorithm placement

`FileDropZone` handles browser-readable files and validates the current tool's
`acceptedInputs`. Path-based tools use native `PathPicker`, then either
`NativeToolShell` or `useNativeAction` plus `RunBar` for custom multi-selection
or plan/execute layouts.

| TypeScript | Rust |
| --- | --- |
| Data models and shared types | File-system traversal |
| Labels, formatting, units | Streaming large-file I/O |
| UI orchestration and state | Streaming hashes and copies |
| Pure disk-independent logic | Archive path validation |
| | Partial reads such as hex windows |

Every file capability also has a callable non-React function, so future
automation invokes the same API as the interface instead of simulating clicks.

## Privacy

Tool pages can show the configurable local-processing note. `network` marks
the capabilities that open connections; currency rates are the only automatic
application service request. Tests enforce this and Tauri's CSP blocks
unexpected outbound connections.

## Interface scale

`core/ui/zoom.ts` asks the WebView to zoom and reflow, preserving sharp text
and correct pointer coordinates for crop and PDF editors. Browser/tests fall
back to CSS `zoom`. `transform: scale()` is prohibited because it blurs and
misaligns. Density and animation settings switch root CSS tokens.

## Languages

The UI ships 16 complete locales. French source messages passed to `t()` are
fingerprinted into `src/i18n/messages/<locale>.json`; localized catalog names,
descriptions, and keywords are indexed by tool ID under `src/i18n/catalog/`.
Search builds a locale-specific index with lower-weight English and French
terms. Runtime fallback order is selected locale → English → source, but the
fallback is only a safety net because every real locale has full coverage. See
[I18N.md](I18N.md).

## Open work

- Replace `LocalStorageStore` with a Tauri file-backed store.
- Add the local assistant through `registerIntentResolver`, keeping the
  deterministic resolver as fallback and the registry as authority.

Other future work is tracked in [ROADMAP.md](../../ROADMAP.md).
