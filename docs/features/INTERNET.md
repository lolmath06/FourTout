# Internet & Web

[English](INTERNET.md) | [Français](../fr/features/INTERNET.md)

[← Documentation](../README.md)

The **Internet & Web** category groups the tools that exist to reach the
network. Unlike the rest of the catalog, they are **not `local`**: each one
says, in its own interface, what it contacts and what it sends.

| Tool | ID | Contacts |
| --- | --- | --- |
| Download a file from a URL | `url-download` | The address you enter |
| Download online media | `media-download` | The media site you point to, through yt-dlp |
| Download an excerpt of an online video | `media-url-excerpt` | Same |
| Online video to GIF or animated WebP | `media-url-gif` | Same |
| Shorten a URL | `url-shorten` | The shortening service you choose |
| Web page to PDF | `web-to-pdf` | The page you enter |
| Web page to image | `web-to-image` | The page you enter |
| Save a web page for offline reading (MHTML) | `web-save-offline` | The page you enter |
| Internet speed test | `speed-test` | Cloudflare's measurement service (also listed under Network) |

Sources: `src-tauri/src/internet/` (HTTP, downloads, speed test, shortener),
`src-tauri/src/ytdlp/`, `src-tauri/src/webcapture/`, the client in
`src/core/internet/`, and interfaces under `src/tools/impl/internet/`.

## Why the network goes through the native engine

The interface Content Security Policy stays `connect-src 'self' ipc:`: the
WebView never opens an outgoing connection. Every request is made by the Rust
binary, so the whole network surface can be audited in a handful of files, and
the same code runs on Fedora and Windows.

## Shared foundation

`src-tauri/src/internet/http.rs` is used by every tool above.

- Only `http` and `https`. Credentials embedded in the address are rejected.
- Redirects are followed **manually**, at most a fixed number of times. A
  redirect from HTTPS to HTTP is refused. Every hop is re-validated.
- Errors are structured (`kind`, message, HTTP status) and translated by the
  interface: not found, access denied, rate limited, timeout, no connection,
  TLS failure, destination problem, cancelled.
- Every long job reports progress and can be cancelled. Cancellation removes
  partial output.

## File downloader

- Probes with `HEAD`, then a ranged `GET` when the server rejects `HEAD`.
- Proposes a file name from `Content-Disposition` (RFC 5987 included), then the
  address, and sanitizes it (separators, reserved Windows names, length).
- Writes to `<name>.fourtout-part`, with a `.fourtout-meta` sidecar holding the
  validators. An interrupted download **resumes** with `Range` and `If-Range`
  only if the server confirmed the file did not change; otherwise it restarts
  from zero and says so.
- Optional expected SHA-256: a mismatch deletes the file.
- Never overwrites silently: the destination is chosen by you, and an existing
  file is refused unless you confirm.
- The file receives its final name only after a complete, verified download.

## Online media (yt-dlp)

- Formats: MP4, WebM, MP3, M4A, Opus, WAV, FLAC. Resolution choices never
  upscale: if the source is smaller, the source size is kept. An optional
  maximum size reuses the same budget planner as *Compress to a maximum size*.
- **Public content only.** FourTout does not bypass DRM, payment, login or
  geo-restrictions, and never reads your browser's cookies or profile. Private,
  subscriber-only, age-gated-with-login, live and DRM-protected items fail with
  a clear message.
- yt-dlp is **not bundled**. It is installed on request from the official
  release page. The installer resolves the latest tag, fetches the official
  `SHA2-256SUMS`, downloads the binary through the verified downloader, runs
  `--version` and requires it to equal the tag, then replaces the previous copy
  atomically. If a system yt-dlp is on `PATH`, it is used as a fallback.
  Location: the data directory under `engines/yt-dlp` (see
  [Models](../technical/MODELS.md)).
- Invocation uses an argument vector, never a shell: `--ignore-config`,
  `--no-playlist`, a `--` terminator before the address, an output template in a
  private temporary folder. The media title never reaches a path or an argument.
- Merging audio and video, converting to MP3 and trimming need FFmpeg; the tool
  says so when it is missing. Some recent YouTube formats need a JavaScript
  runtime (Deno or Node.js) on the system.
- An **excerpt** asks the service for the section only. When the site does not
  allow it, the whole source is downloaded and trimmed locally, and the result
  says which happened.

## URL shortener

Providers: is.gd, v.gd, TinyURL. The original address is sent to the provider
you pick, **which stores it**; the tool states this next to the button.
Addresses that only make sense on your own network (loopback, private ranges)
are rejected before anything is sent. FourTout adds no tracking and no account.

## Speed test

Download and upload streams against Cloudflare's `__down` and `__up`
endpoints, in parallel, with a latency probe. Reported values: median latency,
jitter (mean difference between consecutive measurements), and the 90th
percentile of long-enough transfers. Results vary with VPNs, Wi-Fi, server
distance and concurrent traffic, and the page says so. Only generated test data
is exchanged; none of your files.

## Web capture

- Needs a **Chromium-family browser already installed** (Chrome, Chromium,
  Edge, Brave). FourTout does not ship one. Detection: `PATH`, usual Windows
  install locations, and the `FOURTOUT_BROWSER` override.
- The browser starts headless with a **blank temporary profile**: no cookies,
  history, extensions or sessions, and the remote-debugging port is local
  (`127.0.0.1`, ephemeral). The profile is deleted afterwards, and cancelling or
  timing out kills the whole process tree (process group on Linux, Job Object on
  Windows).
- PDF: paper size, orientation, margins, background printing. Image: PNG, JPEG
  or WebP, viewport presets, optional full page (capped at 20,000 px). MHTML:
  the page and its resources in one file.
- A page that needs a login is captured as an anonymous visitor would see it.

## Tests

No test reaches the Internet. A local HTTP server
(`src-tauri/src/internet/testserver.rs`) covers redirects, ranges, ETags,
hangs and resets; yt-dlp is exercised with a fake executable and a local
release server; the web capture uses a fake DevTools server, and an integration
test drives a real Chromium when `FOURTOUT_BROWSER` points to one. For manual
checks, `pnpm fixtures:serve` serves the same behaviors on `127.0.0.1:8765`
(see [test-assets](../../test-assets/README.md)).
