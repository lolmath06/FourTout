# PDF password recovery

[English](PDF-RECOVERY.md) | [Français](../fr/features/PDF-RECOVERY.md)

[← Documentation](../README.md)

`pdf-recover-password` helps recover a **forgotten** password for a PDF the
user is authorized to open. It uses a local dictionary and rules. This is a
probable-candidate search, not exhaustive enumeration; a password outside the
corpus and rules will not be found, and the interface says so explicitly.

## Execution model

Repeated PDF password validation is CPU-intensive cryptography, so
`src-tauri/src/recovery/` runs it in multithreaded Rust. The frontend extracts
the encryption parameters (`/O`, `/U`, `/P`, `/ID`, revision, and so on) once;
the backend tests candidates on all cores and sends progress events. The PDF,
candidates, and result never leave the machine. Browser-only development mode
disables the tool because it has no native engine.

Measured on a 32-thread Fedora development machine:

| Encryption | Naive pdf-lib JS | Rust, 1 thread | Rust, 32 threads |
| --- | --- | --- | --- |
| AES-256 (R6) | 463/s | 1,160/s | **19,661/s** |
| AES-128 / RC4 (R4/R3) | 4,117/s | 56,639/s | **1,168,924/s** |

AES-256 revision 6 deliberately uses a slow derivation function with at least
64 SHA-2/AES-128 rounds (ISO 32000 algorithm 2.B). Parallel native execution
makes the roughly 14 million candidates in Full mode practical: around 12
minutes for AES-256 and seconds for AES-128/RC4 on that machine.

## Verifier

`src-tauri/src/recovery/verifier.rs` implements the standard security handler
for revisions 2–6: MD5 key derivation and RC4/AES-128 validation for R2–R4, and
hardened SHA-2/AES-128 derivation plus `/U` salt validation for R5–R6. A
password is accepted only after real validation against PDFs encrypted with the
three supported handlers.

Cryptographic dependencies are RustCrypto `md-5`, `sha2`, and `aes`; variable
PDF key-length RC4 is implemented directly. `rayon` provides parallelism. All
are MIT or MIT/Apache-2.0 and require no external native dependency.

## Corpus and rules

`src-tauri/resources/wordlists/seeds.txt.gz` contains only redistributable
sources: widely known common passwords and names/patterns written in the
generator, plus Fedora's public-domain `linux.words` filtered to alphabetic
words of 4–12 letters. No breach list is downloaded or bundled. Seeds are
deduplicated while preserving the first exact-case occurrence, then ordered by
probability.

| Current corpus | Value |
| --- | --- |
| Deduplicated seeds | **354,489** |
| Uncompressed text | 3.35 MB |
| Installed gzip file | **1.20 MB** |

`pnpm wordlist` regenerates it; without Fedora's `words` package, only the
handwritten seeds are included.

`src-tauri/src/recovery/rules.rs` generates candidates at runtime instead of
storing them. Ordered, bounded transformations cover case, numeric/year/symbol
suffixes, and common leetspeak substitutions. Variants are deduplicated within
each seed; rare collisions across seeds can make the displayed `~` total a
slight upper bound.

| Level | Seeds | Budget per seed | Expected candidates |
| --- | --- | --- | --- |
| **Quick** | First 30,000 | 2 | **~60,000** |
| **Extended** | All 354,489 | 4 | **~1,417,956** |
| **Full** | All 354,489 | 40 | **~14,179,560** |

## Flow and cancellation

1. The dropped PDF is inspected and its AES-256, AES-128, or RC4 type shown;
   unprotected PDFs are reported.
2. `recover_password` starts the selected level on a dedicated thread.
3. `recovery://progress` reports tested/total, throughput, and elapsed time
   every 60,000 candidates; the UI estimates remaining time.
4. `recovery://done` reports `found`, `exhausted`, `cancelled`, or `error`. A
   found password can be used to save an unlocked copy.
5. `recover_cancel` is checked inside parallel batches, so cancellation does
   not wait for the batch to end. See [JOBS.md](../technical/JOBS.md).

## Fixtures and tests

`pnpm test:assets` creates a Quick AES-128 fixture whose seed is around rank
800 and a deep AES-256 fixture using a seed around rank 8,000 plus a `2024`
rule. `recovery-fixture.json` stores their parameters and passwords for tests.

Rust tests cover the three real handlers, rules, success, exhaustion,
cancellation, progress, corpus reading, and the command layer. Integration
tests search the real corpus; `FT_HEAVY=1` enables the multi-batch deep fixture.
TypeScript tests cover encryption-parameter extraction, the non-app client
guard, and the interface's usage warning.

## Limits

- This is a bounded candidate search, not exhaustive brute force.
- AES-256 is slow by design; start with Quick.
- Only the user/open password is targeted, not the owner password.
- Common ASCII/UTF-8 passwords are supported. Full SASLprep normalization for
  unusual R6 Unicode passwords is not applied.
