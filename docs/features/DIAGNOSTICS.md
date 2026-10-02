# Diagnostics and recovery

[English](DIAGNOSTICS.md) | [Français](../fr/features/DIAGNOSTICS.md)

[← Documentation](../README.md)

Four tools—`file-diagnose`, `archive-repair`, `pdf-repair`, and
`image-repair`—use `src-tauri/src/diagnostics/`, the client under
`src/core/diagnostics/`, and interfaces under `src/tools/impl/diagnostics/`.

## Three rules

1. **Never modify the source.** Every operation writes a collision-safe new
   path. A test hashes 21 fixtures, runs every applicable action, and requires
   every source hash to remain unchanged.
2. **Never invent content.** Missing bytes are not fabricated and checksums are
   never rewritten to disguise corrupted data.
3. **Every repair must be explainable byte by byte.** If the exact justified
   change cannot be stated, no action is offered.

The vocabulary is precise:

| Classification | Meaning |
| --- | --- |
| `safeRepair` | All content remains; only structural damage is corrected. |
| `recoverPartial` | Verified content is extracted and losses are counted. |
| `recoverVisual` | Decoded pixels are re-encoded; the image survives, not the original file. |
| `none` | No defensible automatic correction exists. |

Warnings such as a misleading extension are distinct from errors such as a
truncated archive. “18 of 21 files recovered” is never called a successful
repair.

## Generic diagnostics — `src-tauri/src/diagnostics/generic.rs`

Signatures, not extensions, identify files. A mismatched extension can be
corrected only by creating a renamed copy. End markers detect missing tails or
trailing bytes in PNG, JPEG, PDF, and GIF. Deeper analysis is explicitly
limited to ZIP, PDF, PNG, and JPEG rather than pretending to understand every
format.

## ZIP — `src-tauri/src/diagnostics/zip.rs`

ZIP readers depend on the trailing central directory, which can be damaged
while local entry data remains intact. Diagnostics inspect both structures and
distinguish missing EOCD, corrupt or out-of-range central directories,
truncation, trailing bytes, entry-count mismatch, and encryption.

Recovery ignores the central directory and scans local `PK\x03\x04` headers.
Each entry is decompressed and must pass CRC-32 before being written. Low-level
`flate2` input counters support entries using deferred size descriptors.
Output is either a recovery folder or a new ZIP containing only verified
entries—never the source archive.

Existing archive path protections reject `..`, absolute paths, and Windows
roots. Corruption never weakens those guards. Physically truncated compressed
streams cannot be reconstructed; the entry is reported lost and not written.

## PDF — `src-tauri/src/diagnostics/pdf.rs`

| Finding | Action | Exact change |
| --- | --- | --- |
| `pdf.trailing-garbage` | `pdf-strip-trailing` | Copy through the last `%%EOF`. |
| `pdf.bad-startxref` | `pdf-fix-startxref` | Replace only digits after `startxref`. |
| `pdf.no-startxref`, `pdf.no-eof` | `pdf-rebuild-xref` | Append a cross-reference table built from real objects. |

Rebuilding scans `N G obj` headers, honors the last definition of each object,
and marks undefined numbers free according to the format. It is refused for
compressed object streams (`/ObjStm`) because a byte scan cannot prove a
complete table.

A tolerant renderer opening a file is not proof of sound structure. Before an
action is offered and again before bytes reach disk, `structural_check`
requires complete objects, catalog and page-tree roots, valid `/Kids`, a page
count consistent with complete pages, and xref entries pointing exactly at
object headers. This is intentionally a narrow proof for supported repairs, not
a general PDF validator.

The candidate is then reopened with pdf.js and its pages counted. Failure is
reported as a failed repair and the output is removed; count discrepancies are
reported as real loss. Signed PDFs receive a permanent warning because any
structural rewrite invalidates byte-range signatures. FourTout neither verifies
nor claims to preserve those signatures.

## Images — `src-tauri/src/diagnostics/image.rs`

PNG chunks are checked by CRC and separated into critical and ancillary data.
A damaged ancillary chunk can be removed without losing pixels; a damaged
`IDAT` cannot be “fixed” by rewriting its CRC. JPEG segments, dimensions, scan
data, and the EOI marker are inspected without inventing missing scan lines.

The engine actually attempts structural cleanup and decoding before setting
`recoverable`; the UI never offers a button guaranteed to fail. A structurally
cleanable PNG preserves pixel bytes. JPEG or decoder-assisted recovery is
classified as visual and always writes PNG to avoid a second lossy JPEG pass.

## Interface contract

`DiagnosticShell` presents, in order: what is broken, what remains intact, each
specific available action, its losses, and only then its button. Results list
preserved and lost content, output location, and a recomputed source hash. “The
source was untouched” is displayed as verified evidence. Having no defensible
action is a valid result, not an application failure.

## Fixtures and proof

Every damaged fixture derives reproducibly from a healthy file made by an
independent tool, then altered by `scripts/generate-phase12-assets.mjs`.
`test-assets/generated/CONTRAT.json` records expected findings, repairability,
and hashes of expected recovered content calculated from the source data—not
from FourTout output.

Partition recovery, GPT/MBR reconstruction, disk imaging, cloning, bare-metal
restoration, destructive file-system recovery, raw device writes, and bootable
rescue media belong to PROMĒTHEÚS Rescue and are intentionally absent.
