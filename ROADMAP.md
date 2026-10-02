# Roadmap

[English](ROADMAP.md) | [Français](ROADMAP.fr.md)

FourTout is complete for its intended scope: all 196 tools are usable. This
page lists ideas that may come next. Nothing here is promised, and **none of
these items appears in the application**: the catalog contains working tools
only.

---

## Out of scope: PROMĒTHEÚS Rescue

These features will **not** be added to FourTout, regardless of the project's
future. They belong in a dedicated rescue suite:

- disk imaging, image restoration, and cloning;
- partition recovery and GPT or MBR table reconstruction;
- destructive file-system recovery and write-enabled `fsck`;
- raw writes to a block device;
- bootable media and rescue environments;
- bare-metal backup and restore.

The reason is not technical. These operations require a different environment,
often outside the installed system, a different risk model, and a much
stronger confirmation flow than a desktop utility. Mixing them into FourTout
would put a disk-erasing button next to an image converter.

FourTout diagnoses, recovers only what can demonstrably be recovered, and
never modifies the original.

---

## Package size

- **ONNX runtime bundled twice.** Background removal loads its WebAssembly
  runtime from explicit URLs under `public/ort/`. Vite nevertheless emits a
  second copy in `dist/assets/` by following the package import: 13 MB in every
  installer that is never read. Removing it requires a bundler-level exclusion
  and an end-to-end background-removal check in the packaged app, not only in
  tests, which load the runtime from another path. Until then this is harmless
  dead weight, not a functional defect.

---

## Distribution

- **Installer signatures.** Windows code signing and GPG signatures for Linux
  packages. Until then SmartScreen warns on first launch, as documented.
- **Visual identity.** `src-tauri/icons/` still contains Tauri's default icon.
- **Flatpak package** for Linux distributions that prefer it.
- **macOS.** The code is cross-platform, but no macOS build or test has been
  performed.

## Tools

- **RAR.** The format is closed and its reference decompressor cannot be
  redistributed under a compatible license. 7z support arrived in phase 9
  through the pure-Rust `sevenz-rust2` library.
- **7z archive encryption.** The “Protected archive” tool already provides
  widely compatible ZIP AES-256. A second encrypted format with less certain
  compatibility should wait for a real request.
- **Two-way synchronization.** Current synchronization runs from source to
  destination after displaying a plan before any write. Reconciling two
  modified sides requires conflict detection and history: a full feature, not
  a checkbox.
- **Versioned backup.** Current backup is a full, dated, verifiable copy.
  Incremental snapshots, block deduplication, and version history form a
  separate product.
- **Pixel-perfect Word to PDF.** This would require a Word layout engine. The
  current tool preserves content and structure and states that limitation.
- **More OCR languages.** The infrastructure supports them; the corresponding
  data must be bundled or downloaded.

## Interface

- **Local assistant.** The “What do you want to do?” bar already uses an
  intent resolver. It is deterministic today; a local model could replace it
  with fallback to the current resolver. Nothing would leave the device.
- **Broader batch processing.** Several tools already support it, and the
  shared foundation could extend it further.
- **More languages.** The interface currently ships 16 complete locales; new
  ones require a fully translated catalog and search metadata.

## Technical work

- **JavaScript chunk splitting.** A few chunks exceed 500 KiB after
  minification. This has no perceptible impact in a desktop application but can
  be improved.
- **Optional bundled FFmpeg.** `resolve_binary` already supports it. What
  remains is choosing a license for the redistributed build.

---

Have an idea not listed here? Open an issue.
