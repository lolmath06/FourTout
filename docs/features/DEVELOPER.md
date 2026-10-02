# Developer tools

[English](DEVELOPER.md) | [Français](../fr/features/DEVELOPER.md)

[← Documentation](../README.md)

The 21 developer tools are local. SQLite reads a disk file; the others operate
on pasted text. Core code is under `src/core/code/` and interfaces under
`src/tools/impl/dev/`. Every input is untrusted, and no tool executes user code
or content through `eval`, `new Function`, or dynamic loading.

## JSON — `src/core/code/data.ts`

Native `JSON.parse` is wrapped to report line, column, and context. Key sorting
never reorders arrays, whose order is part of the data. UTF-8 and emoji are
preserved.

## XML — `src/core/code/data.ts`

FourTout's parser has no DTD, entity, or external-resource resolution. External
entity declarations fail before any read. XXE tests instrument both `fetch` and
`XMLHttpRequest` and confirm that validation, formatting, and minification leak
no file content and make no request. CDATA and angle brackets inside attributes
are handled correctly.

## YAML — `src/core/code/yaml.ts`

`js-yaml` runs with the restricted `core` schema: strings, numbers, booleans,
null, sequences, and mappings only. Object-instantiating tags such as
`!!js/function` and `!!python/object` are rejected.

## SQL — `src/core/code/sql.ts`

`sql-formatter` formats text. No statement is executed and no server is
contacted.

## JWT — `src/core/code/tokens.ts`

**Decoded does not mean verified.** The tool locally decodes header and payload,
formats `exp`, `iat`, and `nbf`, and flags expiration and `alg: none`. A
permanent warning separates this inspection from signature verification.

## JWT signature verification — `src/core/code/jwtVerify.ts`

Three rules are mandatory:

1. The expected algorithm comes from the user, never from the token. Header and
   selection must match before cryptography runs.
2. `alg: none` is always rejected.
3. Signature and claim validity are separate verdicts: a validly signed token
   can still be expired or not yet valid.

| Algorithm | Mechanism | Expected key |
| --- | --- | --- |
| HS256, HS384, HS512 | HMAC-SHA | Shared secret |
| RS256, RS384, RS512 | RSA PKCS#1 v1.5 | SPKI or PKCS#1 **public** PEM key |

ES256 and JWKS downloads are not offered. Private keys are refused because
verification never requires one. Native Rust in `src-tauri/src/security/jwt.rs`
performs the operation; HMAC uses constant-time `verify_slice`. Secrets cross
IPC for the call only and are never logged, persisted, or added to recents.
TypeScript owns policy and claim evaluation; Rust owns cryptography, allowing
independent tests against injected verifiers and real HS/RSA fixture tokens.

## UUID, Unix timestamps, and numeric bases

UUID v4 and time-sortable v7 use `crypto.getRandomValues` and fail explicitly
if secure randomness is absent; there is no `Math.random` fallback. Tests check
canonical form, version, RFC 4122 variant bits, and uniqueness.

Unix timestamps distinguish seconds from milliseconds and show local, UTC, and
ISO 8601 forms. Base conversion uses `BigInt`, preserving large integers and
rejecting digits outside the selected base.

## Regular expressions — `src/core/code/regex.ts`, `regexRunner.ts`

JavaScript regex execution cannot be interrupted inside a catastrophic
backtracking `exec`. Subject-length and between-match time budgets alone are
therefore insufficient. Patterns run in `regex.worker.ts`; `regexRunner.ts`
terminates the worker after two seconds, keeping the UI responsive.

`runRegex` additionally caps input at 200,000 characters, results at 1,000
matches, and collection-loop time at 400 ms. The worker is bundled as a classic
IIFE for WebView compatibility. A synchronous test fallback exists, but the UI
warns that timeout protection is reduced when it is used.

## Web formatting and minification — `src/core/code/web.ts`

| Language | Formatting | Minification |
| --- | --- | --- |
| HTML | Prettier | FourTout's minifier |
| CSS | Prettier | CSSO |
| JavaScript | Prettier | Terser |

These libraries parse but never execute code. Syntax errors retain useful
positions. HTML minification preserves `pre`, `textarea`, conditional comments,
and inline-element spacing. Inline styles and scripts are minified; an invalid
inline script is retained instead of deleted. Tests reparse minified JavaScript
for syntax without executing it.

## Cron — `src/core/code/cron.ts`

`cronstrue` explains expressions and `cron-parser` calculates real upcoming
occurrences. The UI warns that simultaneous day-of-month and day-of-week fields
use **OR**, not AND. Wrong field counts and out-of-range values are rejected.

## TOML — `src/core/code/toml.ts`

`smol-toml` parses TOML 1.0. Validation never rewrites input and reports line,
column, and source context without a stack trace. Reformatting serializes the
data model, preserving values, tables, nested tables, arrays of tables, dates,
numbers, booleans, and multiline/literal strings.

Comments, blank lines, and original ordering are not part of that model and are
lost during reformatting. The interface warns beforehand and counts actual
comment lines; `#` inside strings is not counted. This is an explicit canonical
rewrite rather than a falsely lossless formatter.

## Base32 — `src/core/code/base32.ts`

Dependency-free RFC 4648 support includes the standard `A–Z, 2–7` alphabet and
the extended hexadecimal `0–9, A–V` alphabet. Crockford and z-base-32 are
different encodings and are not presented as options.

Decoding rejects impossible useful lengths, internal `=` padding, and non-zero
padding bits. It accepts lowercase and ignores whitespace. RFC section 10
vectors are tested in both directions, plus a UTF-8 round trip.

## SQLite explorer — `src-tauri/src/sqlite/`

Bundled `rusqlite` provides the same SQLite implementation on Fedora and
Windows. Three independent guards enforce read-only access:

1. the connection uses `SQLITE_OPEN_READ_ONLY`;
2. `PRAGMA query_only` also blocks in-memory and temporary writes;
3. SQLite's parsed-operation authorizer permits only reads, selects, functions,
   recursion, and an explicit PRAGMA allowlist.

Text classification exists only to explain refusals; it is not a security
boundary. PRAGMAs that accept table arguments are separated from those allowed
only without a value. Integration tests try 28 direct and disguised writes,
then require the database SHA-256 to remain identical.

The UI distinguishes NULL, empty strings, and BLOBs. BLOBs show their size and
a 16-byte hexadecimal preview; CSV uses an empty field for NULL and SQLite's
`X'…'` form for BLOBs. Results default to 500 rows and cap at 5,000. Identifiers
are quoted correctly. Non-databases are recognized by the `SQLite format 3`
signature, with encrypted databases mentioned as a possibility.

## Code diff

Line comparison with highlighting; no code is run or transmitted.
