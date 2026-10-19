# ISO images

[English](ISO.md) | [Français](../fr/features/ISO.md)

[← Documentation](../README.md)

Three tools — `iso-create`, `iso-inspect` and `iso-extract` — read and write ISO
9660 images with a native Rust engine in `src-tauri/src/files/iso/`. They are
`local`: nothing is sent anywhere, and **nothing is ever written to a disk,
partition or USB drive**. The output of *Create* is a regular `.iso` file.

## Create

- ISO 9660 level 2 with **Joliet** (Unicode names for Windows) and **Rock
  Ridge** (long names and POSIX permissions for Linux and macOS: `SP`, `PX`,
  `TF`, `NM`).
- The volume name is validated (letters, digits, `_`, 32 characters).
- A file of 4 GiB or more is **rejected**: ISO 9660 cannot store it without
  multi-extent files, and the tool says so instead of producing a broken image.
- Symbolic links and special files are skipped and listed. Names that cannot be
  kept as they are (too long for Rock Ridge, changed in the Joliet tree) are
  reported.
- The folder is snapshotted: if a file changes while the image is written, the
  job fails. The image cannot be saved inside the folder it packs.
- The image is written to `<name>.fourtout-part`, then renamed. An existing
  file is never replaced silently. Cancellation removes the partial output.
- The image is **not bootable**: it is a data image.

## Inspect

Reads descriptors and directories only; the image is neither extracted nor
modified. Reports the volume name, publisher, creation and modification dates,
size, file systems present (ISO 9660, Joliet, Rock Ridge, UDF), the El Torito
boot catalog (BIOS or UEFI entries, emulation, load sector), and whether a
hybrid MBR or GPT is present. The tree is capped for display; totals describe
the whole image.

A pure UDF image (some Windows ISOs) is read through its ISO 9660 part only,
which may be nothing more than an explanatory file; the tool says so.

## Extract

Copies everything or only the entries you check.

- Every name in the image is treated as hostile. Path separators, `..`,
  reserved Windows names and absolute paths are neutralized, and a final guard
  refuses any destination outside the folder you chose.
- Nothing is overwritten without a request. Symbolic links from Rock Ridge are
  recorded, not recreated.
- Multi-extent files, Rock Ridge relocated directories, loops and excessive
  depth are handled; truncated or inconsistent images fail with a message.
- On error or cancellation, what was already extracted is **rolled back**.

## Cross-platform

The engine is pure Rust and byte-oriented, so Fedora and Windows share one code
path. Integration tests cross-check images against `isoinfo`, `bsdtar` and
`genisoimage` when those tools are available (Linux); fixtures for manual
testing are produced by `pnpm test:assets` (`sample.iso`, `sample-boot.iso`).
