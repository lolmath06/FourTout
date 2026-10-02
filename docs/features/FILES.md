# Files, folders, and archives

[English](FILES.md) | [Français](../fr/features/FILES.md)

[← Documentation](../README.md)

File tools operate on **paths**, not bytes loaded into the WebView. Native Rust
streams large files with constant memory, centralizes path safety, and supports
real cancellation. `src-tauri/src/files/` contains archive, compression, hash,
signature, traversal, comparison, synchronization, search, hex, backup,
manifest, scan, split, rename, and DOCX modules. The typed frontend client is
`src/core/files/native.ts`; `PathPicker` and `NativeToolShell` provide shared UI.

## Progress and cancellation

Long operations receive a `jobId`, emit `files://progress`, and check a native
cancellation flag for every block. `files_cancel` stops the operation and the
client raises `JobCancelledError`. Partial or unverified output is never passed
off as success; a reassembled file with the wrong digest is deleted.

## Archive security

Before writing, `safe_relative_path` rejects parent traversal, POSIX absolute
paths, UNC and Windows roots, backslash traversal, and null bytes.
`resolve_inside` additionally requires the normalized result to remain under
the canonical destination. TAR symbolic and hard links are skipped and listed.
Refused entries do not hide otherwise recoverable content; the result explains
every omission.

Inspection reports format, entry count, compressed and declared expanded size,
and unsafe entries without extracting. More than 200,000 entries is refused. A
ratio above 200× and more than 64 MiB expanded triggers a visible decompression-
bomb warning. Creation uses the same safe-name validation and never follows
symlinks. Existing output is never overwritten unless explicitly requested;
otherwise a collision-safe neighboring name is chosen.

| Format | Create | Extract | Inspect | Integrity | Engine |
| --- | --- | --- | --- | --- | --- |
| ZIP | Yes | Yes | Yes | Per-entry CRC-32 | `zip` |
| 7z | Yes | Yes | Yes | Yes | `sevenz-rust2` |
| TAR | Yes | Yes | Yes | Structure/header only | `tar` |
| TAR.GZ / TAR.XZ | Yes | Yes | Yes | Yes | `tar` + compression library |
| GZ / XZ, single file | Yes | Yes | — | Yes | `flate2` / `lzma-rust2` |
| RAR | No | No | No | No | Closed format; no redistributable decoder |

All engines are bundled Rust libraries. `.gz` and `.xz` hold one stream, not a
folder tree; TAR.GZ/TAR.XZ are separate archive formats. Integrity testing
fully decompresses content. Plain TAR has no content checksum, so FourTout can
prove only structure and header checksums and states that limit.

Password archives use interoperable WinZip AES-256, never insecure ZipCrypto.
Independent 7-Zip tests verify the exact bytes, wrong-password refusal, and
Unicode paths. ZIP exposes filenames even when content is encrypted; `.ftenc`
can hide the entire archive file. Encrypted 7z is not offered because ZIP AES
already provides the supported interoperable path.

## Hashes, duplicates, splitting, and renaming

Hashing reads 1 MiB blocks and updates selected MD5, SHA-1, SHA-256, and
SHA-512 algorithms in one pass. MD5 and SHA-1 remain available for matching
legacy download checksums but always carry a cryptographic warning. Expected
digests are compared automatically.

Duplicate detection groups by size, then hashes three 64 KiB windows plus size,
then computes full SHA-256 only for remaining candidates. It reports groups and
recoverable space but never deletes anything.

Splitting writes numbered `.part001` files and a JSON manifest with source name,
size, SHA-256, part count, and sizes. Reassembly can start from any part,
rejects gaps, streams concatenation, and verifies the manifest. Without a
manifest it clearly reports that integrity could not be proven.

Batch rename first builds a pure preview plan. It detects duplicate targets,
external collisions, Windows-invalid characters and reserved names, trailing
spaces/dots, and names over 255 bytes. Any conflict blocks all changes. A
two-stage temporary rename safely supports swaps such as `a → b`, `b → a`.

## Folder analysis, comparison, and synchronization

Traversal never follows symlinks by default and reports unreadable directories.
Tree output can ignore common generated/hidden folders and bounds depth while
reporting truncation.

Fast folder comparison uses type and size and says **probably identical**.
Reliable mode hashes equal-sized files with SHA-256 and can say **identical**.
Timestamps are clues, never proof. Relative-path matching follows platform case
semantics and separately reports case-only conflicts.

Synchronization is one-way: source is authoritative. **Update** copies and
replaces; **Mirror** also deletes destination-only entries. `build_plan`
produces the exact displayed operations and execution never recalculates them.
Each operation records source size and timestamp and refuses a file changed
after planning. Copies use destination-side temporary files followed by atomic
rename, so cancellation preserves the old file.

Source-inside-destination and destination-inside-source configurations are
refused. Mirror requires typing `DELETE` only when deletions actually exist.
Partial execution is reported with completed/total counts, never as success.

## Search

Search is on demand and never indexed or retained. Name, extension, size, date,
and content filters are evaluated cheapest first. Content search opens only
files recognized as text by the native counterpart of the frontend encoding
detector; cross-tests keep both implementations aligned. Binary files remain
searchable by metadata. Results arrive in batches of 25. Files over 64 MiB are
not opened for content and are counted separately.

## Inspection, preview, and hexadecimal editing

`magic.rs` is the single signature authority for common documents, images,
archives, executables, audio/video, databases, and byte-order marks. BOMs are
checked before MP3 sync words; MPEG version/layer/bitrate/frequency are also
validated. A BOM alone is not proof of text, so decoded content must have valid
surrogates and acceptable control characters.

Inspection contrasts filename claims, byte signature, and text encoding/BOM/
line endings. It never renames automatically. Preview follows detected content,
not extension, and reuses existing image/media/PDF/text/archive renderers before
falling back to hex. Handoffs route the already selected file to registered,
implemented specialized tools; tests reject dead targets.

The bounded hex editor reads 512-byte windows (native maximum 64 KiB), searches
the whole file in one stream, counts overlapping matches, highlights matches
across rows, and loads their windows on demand. It supports byte replacement
only: no insertion, deletion, scripting, templates, or disassembly. File size
never changes and saving defaults to a new file.

## Backup and restoration

The transparent format contains a readable `data/` tree and `manifest.json`
with relative paths, sizes, dates, and SHA-256. It is a full dated copy, not an
incremental/versioned or proprietary container. Verification classifies every
file as intact, missing, modified, or unreadable. Restore announces collisions,
names damaged backup files, and never deletes extra destination content.

Interrupted backups describe only files actually copied and include a warning.
A non-empty destination that is not already a FourTout backup is refused.

## Checksum manifests and HMAC

Text manifests use GNU `sha256sum` syntax and escaping; JSON with sizes is also
supported. Digest length identifies MD5, SHA-1, SHA-256, or SHA-512. Incoming
manifest paths are data, never instructions: traversal and absolute paths are
refused and listed while legitimate entries continue.

HMAC-SHA-256, SHA-512, and legacy SHA-1 operate on text or streamed files. Keys
are not logged, stored, or added to recents and are cleared when leaving. RFC
4231 and RFC 2202 vectors are tested.

## Symbolic links, units, and portability

Shared traversal policy supports `report` (default, inventory but do not
follow), `skip`, and `follow-inside`. The last follows only targets under the
canonical root and cuts loops through visited canonical paths. Synchronization
never copies or deletes symlinks and warns in its plan.

File-system sizes use binary KiB/MiB/GiB labels and verification-oriented views
also show exact bytes. Rounded precision changes with magnitude. File counts
and total operation counts remain distinct.

Archive paths normalize to `/`; UI handles both separators. No user path is
hard-coded. Unicode filenames are tested across ZIP and TAR formats. Windows
invalid names, hidden attributes, and case-insensitive collisions are checked
even when planning on Linux. Atomic replacement uses platform-correct rename.
Permission errors are listed rather than swallowed.

## Tests

Unit and integration suites cover path guards, symlink policy, signatures and
MP3 lookalikes, comparison and sync plans, text/binary search, hex windows and
cross-block/overlapping matches, backup/verify/restore, manifests and HMAC
vectors, every archive format, damaged/truncated/hostile archives, independent
generated fixture contracts, real preview rendering, handoff navigation, and
large ignored performance cases. Fixture-dependent tests skip with an explicit
message until `pnpm test:assets` is run.
