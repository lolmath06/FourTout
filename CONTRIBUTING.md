# Contributing to FourTout

[English](CONTRIBUTING.md) | [Français](CONTRIBUTING.fr.md)

Thank you for your interest. This page explains how to get started, what the
project expects from contributions, and how to add a tool.

---

## Getting started

```bash
git clone <repository-url> FourTout
cd FourTout
pnpm install
pnpm app:dev
```

See [the development guide](docs/technical/DEVELOPMENT.md) for all
prerequisites, including Node, Rust, and system libraries.

---

## Before opening a pull request

```bash
pnpm verify                              # lint + typecheck + test + build
cd src-tauri && cargo test && cd ..
```

Everything must pass. If a test is skipped because FFmpeg or fixtures are
missing, run `pnpm test:assets` and install FFmpeg. It is better to discover
that before continuous integration does.

---

## Branches and commits

```bash
git checkout -b topic-of-the-change
```

Commit messages describe what the change does **for the user or the code**, not
the list of files it touches.

```text
Good: The regex tester no longer freezes the window on an expensive pattern
Bad:  fix regex + update tests
```

When fixing a defect, state what was wrong and why the fix works. The commit
body is the best place for that explanation.

---

## What the project expects

### No unverifiable promises

This rule takes precedence over every other one. If a tool has a limitation —
erasure is not physical, Word conversion is not pixel-perfect, or a decoded
JWT is not a verified JWT — describe it in the catalog `note` so it appears on
the tool page.

A tool that implies it does more than it really does is worse than a missing
tool.

### Being in the catalog means working

There is no “coming soon” state. An incomplete tool is not registered, and a
test keeps the catalog and implementation table exactly aligned. Future tools
belong in [ROADMAP.md](ROADMAP.md) or an issue, not in the interface.

### Tests that exercise real behavior

A test that only checks arguments passed to FFmpeg does not prove that the
resulting file is readable. FourTout tests run the real FFmpeg and inspect the
result with `ffprobe`; reopen generated PDFs with pdf.js; and read an AES
archive with `7z`, rather than with the same code that wrote it.

When the environment lacks a dependency, a test must **skip cleanly and state
why**; it must not fail.

Never do the reverse: do not weaken an assertion to make a test pass. Either
the code is wrong or the assertion was imprecise, and correcting the latter
must make it *stricter*.

### English canonical documentation and useful comments

Public documentation is canonical in English and mirrored in French. UI text
goes through the localization system. A comment that paraphrases code adds
nothing; a comment that explains **why this choice was made instead of
another** can prevent a regression six months later.

### Do not use `any` to silence the compiler

Do not hard-code colors either: components use the `--ft-*` CSS tokens.

---

## Adding a tool

Touch these files in this order. The detailed procedure is in
[the adding-a-tool guide](docs/technical/ADDING-A-TOOL.md).

1. **Catalog** — `src/core/tools/catalog/<category>.ts`. Declare the name,
   description, icon, plain-language search keywords, accepted inputs,
   produced outputs, capabilities, and a `note` for any limitation.
2. **Implementation** — `src/tools/impl/<category>/MyTool.tsx`. Business logic
   belongs in `src/core/`, not in the component, so it can be tested.
3. **Implementation table** — add a lazy import to
   `src/tools/implementations.ts`.
4. **Tests** — cover behavior in `src/core/`, opening the screen in a page
   test, and discoverability in the search matrix.

Register the tool only once it works. A test will fail otherwise, by design.

### Tools that need the native layer

Rust code belongs in `src-tauri/src/`, the command is registered in
`src-tauri/src/lib.rs`, and the TypeScript client belongs in a `native.ts` file
under `src/core/…/`. Long-running operations must report progress and **be
cancellable**. Cancellation must leave neither a partial output nor a
temporary file.

---

## Reporting an issue

Issue templates ask for the FourTout version, operating system, reproduction
steps, expected behavior, and observed behavior.

**Do not report a security vulnerability in a public issue.** Use
Security → Report a vulnerability. See the
[security policy](docs/legal/SECURITY.md#reporting-a-vulnerability).

---

## Contribution license

**FourTout is proprietary software**; see [LICENSE](LICENSE). Its source is
published for reading and auditing, not for reuse.

Contributions are welcome, but they do not change that framework. **Submitting
a contribution does not change FourTout's license.** By proposing a change,
you grant the rights holder permission to use, modify, and distribute it as
part of FourTout under that license.

No formal contributor license agreement (CLA) is currently required. If the
project begins accepting regular external contributions, the owner may decide
that one is necessary and will announce that decision here. Nothing is signed
by default today.

Open an issue before investing in substantial work. That is good practice for
any project, and especially for this one.
