# Security

[English](SECURITY.md) | [Français](../fr/legal/SECURITY.md)

[← Documentation](../README.md)

This page documents FourTout's threat model, cryptographic choices, guarantees,
limits, and vulnerability-reporting process.

## Reporting a vulnerability

Do not open a public issue. Use the GitHub repository's **Security → Report a
vulnerability** private reporting flow. Include the FourTout version, operating
system, reproduction steps, observed impact, and ideally a minimal sample. A fix
will be released before public disclosure, with credit if desired.

## Threat model

FourTout is a local, single-user application with no server or account system.
Its main attack surfaces are untrusted files, output-path confinement, and
secrets such as encryption and PDF passwords. It does not claim to defend a
user account already controlled by an attacker, provide physical SSD forensic
resistance, or withstand state-level compromise.

## File encryption

`src-tauri/src/files/crypto.rs` writes `.ftenc` files.

| Element | Choice |
| --- | --- |
| Key derivation | Argon2id, 64 MiB, 3 passes, parallelism 1, 256-bit key |
| Encryption | XChaCha20-Poly1305 authenticated encryption |
| Salt | Fresh 16-byte OS CSPRNG value per encryption |
| Nonce | Random 16-byte prefix plus 8-byte block counter |
| Chunks | Independently authenticated 1 MiB blocks |
| Associated data | Full header, block number, and authenticated final-block flag |

The versioned header stores bounded KDF parameters, salt, nonce prefix, and
chunk size so future parameter changes do not make old files unreadable and a
forged header cannot request absurd memory. The format provides confidentiality,
integrity, authenticated truncation detection, and no partial output after a
wrong password, corruption, or cancellation. It does not hide approximate size,
the original filename, or the FourTout signature.

Passwords are never logged, stored in temporary files, or placed in headers.
Derived key memory is cleared after cipher initialization. There is no password
recovery: losing it loses the encrypted content. Sources are never deleted.

## Password-protected archives

Archives use WinZip AES-256, never broken legacy ZipCrypto. Automated tests read
output with independent 7-Zip. ZIP encryption leaves filenames visible; encrypt
the archive itself with `.ftenc` when names must also be hidden.

## Untrusted input

- Archive extraction rejects traversal, absolute paths, and symlinks and lists
  every refusal. Folder organization applies the same root confinement.
- XML rejects all entity declarations and external DTDs before parsing. XXE
  tests verify both no local-file leak and no network request.
- YAML accepts only the core scalar/list/mapping schema and rejects executable
  object tags.
- Regex evaluation runs in a worker killed after two seconds, with 200,000
  input characters and 1,000 matches at most.
- The calculator uses a dedicated parser and never `eval` or `new Function`.
- Prettier and Terser parse user code without executing it.
- Markdown/HTML previews sanitize scripts, inline handlers, active URLs, and
  other unsafe markup.

## Random generators

Encryption salts/nonces use the OS CSPRNG through `getrandom`; passwords,
passphrases, and UUIDs use `crypto.getRandomValues`. `Math.random()` never
produces secrets or identifiers. Missing secure randomness causes an explicit
failure. Password sampling uses rejection rather than biased modulo reduction.

## Secure deletion limits

The tool overwrites the file's current allocation with one random pass or three
passes, flushes and `fsync`s, removes the original directory name, then deletes.
This is strengthened software deletion, **not guaranteed physical erasure** on
SSDs, flash, copy-on-write file systems, snapshots, journals, trash, or backups.
The warning is permanent and an exact confirmation phrase is required. Full-disk
encryption is the reliable answer for critical SSD secrets.

## PDF recovery and JWT

PDF password recovery locally tests bounded dictionary/rule candidates for a
document the user is authorized to open. It is not exhaustive and says so.

JWT decoding is never presented as verification. Signature verification uses a
user-selected expected algorithm, always rejects `none`, and reports signature
and time-claim validity separately. Supported algorithms are HS256/384/512 and
RS256/384/512 with public keys. There is no ES256 or JWKS download. HMAC
comparison is constant-time. Tokens and keys stay local and are never persisted;
private keys are rejected.

## Read-only SQLite

The explorer combines `SQLITE_OPEN_READ_ONLY`, `PRAGMA query_only`, and
SQLite's parsed-operation authorizer with a narrow informational-PRAGMA
allowlist. Text classification only improves refusal messages. A test attempts
28 direct and disguised writes and requires the database SHA-256 to remain
identical. Results are bounded and identifiers safely quoted.

## Bounded network tools

Ping, port checks, and LAN discovery are explicit local diagnostics: at most 20
ping packets, 256 ports on one host, 256 addresses within at most an automatic
`/24`, and 16 concurrent connections. Native code recomputes the range; no user
input reaches a shell. Nothing runs on page load, cancellation stops new probes,
and no addresses, names, hardware addresses, or history are stored.

Stealth/SYN scans, evasion, banner and OS fingerprinting, vulnerability search,
brute force, Internet scans, ARP spoofing, and packet capture are intentionally
absent.

## Build-chain integrity

`pnpm-lock.yaml` and `src-tauri/Cargo.lock` are versioned. Model downloads are
verified by digest before installation. The CSP blocks unexpected WebView
outbound requests. Installers are not yet code-signed, so Windows SmartScreen
may warn; releases provide `SHA256SUMS.txt`, as explained in
[INSTALLATION.md](../guides/INSTALLATION.md).

## Test coverage

Automated suites cover encryption round trips, non-determinism, bad passwords,
tampering, truncation, cancellation and nonce reuse; independent 7-Zip
interoperability; archive/path confinement; destructive-action confirmation;
XXE and YAML restrictions; absence of calculator `eval`; mandatory unbiased
CSPRNG use; regex catastrophic-backtracking containment; JWT policy and real
cryptography; SQLite immutability; and network bounds.
