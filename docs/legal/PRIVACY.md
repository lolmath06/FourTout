# Privacy

[English](PRIVACY.md) | [Français](../fr/legal/PRIVACY.md)

[← Documentation](../README.md)

FourTout processes your files on your device. This page states exactly what
leaves the device and what never does, based on what the code does rather than
on the project's intentions.

All claims are verifiable. FourTout's network layer is confined to native
code: `src-tauri/src/rates.rs` for exchange rates, `src-tauri/src/models/` for
models, `src-tauri/src/network/` for diagnostic probes, and, for the
**Internet & Web** category, `src-tauri/src/internet/`, `src-tauri/src/ytdlp/`
and `src-tauri/src/webcapture/`. The application's Content
Security Policy (`connect-src 'self' ipc:`) **prevents the interface from
making any outgoing request**. No page, tool, or JavaScript dependency can
open a connection, even accidentally.

## What never leaves your device

| Domain | Processing |
| --- | --- |
| **PDF** | Merging, splitting, compression, redaction, OCR, and password operations run locally through pdf.js, pdf-lib, or the native engine. |
| **Images** | Conversion, compression, cropping, watermarking, EXIF handling, and OCR are local. |
| **Audio and video** | FFmpeg runs on your machine against local files. |
| **Text and documents** | Analysis, cleanup, comparison, Markdown, and DOCX processing run inside the application. |
| **Files and archives** | Archives, hashes, duplicates, splitting, renaming, organization, and erasure use the native Rust engine and local paths. |
| **Encryption** | Argon2id and XChaCha20-Poly1305 run locally. Passwords are not sent, logged, or written to temporary files. |
| **Passwords** | Generation uses the operating system's cryptographic generator. zxcvbn strength analysis runs in the app; the entered password is never transmitted. |
| **JWT** | Tokens are decoded **and verified** locally. Neither token nor key is sent, logged, saved, or added to recent items. |
| **SQLite databases** | Databases are opened read-only from disk. Queries cannot modify the file, and its contents are never sent anywhere. |
| **Diagnostics and recovery** | A damaged file is read, never modified; tests recalculate its digest after operations. Results are written beside it under a new name. Nothing is uploaded. |
| **Disks and partitions** | Inventory is read-only. Serial numbers and volume IDs may be displayed during the session but are never stored in recents, settings, or logs, and no online vendor lookup occurs. |
| **Speech** | Once models are installed, synthesis and transcription run locally. |
| **Background removal** | The model runs in the application. The image is never sent to an online service. |
| **AI upscaling** | Once the model is installed, the image is enlarged in the application. It is never sent to an online service. |
| **ISO images** | Creating, inspecting, and extracting images is done by the native engine on local paths. Nothing is written to a disk or partition. |
| **Compress to a maximum size** | Video and audio use the local FFmpeg; images and PDFs are processed in the application. |
| **Universal converter** | Content detection reads the beginning of the file locally. |

## What leaves the device, and why

Only the features below contact the Internet, and each one says so in its
interface: they are the only tools not marked `local`. A further family opens
connections only on your local network.

**Do not read "FourTout is local" as covering these tools.** The download,
shortening, and capture tools exist precisely to reach a remote address that you
provide.

### 1. Currency converter

**Sent:** one `GET` request to the European Central Bank's daily reference feed:
`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`.

**Not sent:** the amount, selected currencies, or history. The request has no
parameter, identity header, or cookie. Conversion runs locally from the
downloaded rate table.

The native Rust binary performs the request, not the WebView. The interface CSP
therefore remains closed, and the promise can be audited in one file.

Offline, the last known rate table is reused **with its date displayed**. If no
table has ever been downloaded, FourTout says so and displays no invented rate.
To prevent this request, do not open the currency converter. Its page clearly
identifies it as the catalog's only tool that contacts a remote server.

### 2. Models for speech, background removal, and AI upscaling

**Sent:** an explicitly requested download from GitHub for Piper, whisper.cpp,
and U²-Net components, or from Hugging Face for voices, transcription models,
and the upscaling model, initiated from Settings → Models or from the tool.

**Not sent:** the text to synthesize, audio to transcribe, or image to process.
Once installed, models work entirely offline. Every download is verified by
digest before installation; a mismatch is rejected and nothing is installed.
See [Models](../technical/MODELS.md).

### 3. Internet & Web tools

| Tool | What is sent, and to whom |
| --- | --- |
| File downloader | A request to the address you entered (and its redirects). |
| Media downloader, excerpt, GIF | yt-dlp contacts the media service for the address you entered. |
| URL shortener | The address you entered, to the provider you chose (is.gd, v.gd or TinyURL), **which stores it**. |
| Web page to PDF, image, or MHTML | A locally installed Chromium browser loads the address you entered, with a blank temporary profile. |

**Not sent:** your files, your browser's cookies, history or sessions, any
identifier, any telemetry. Credentials embedded in addresses are rejected, and
FourTout does not bypass DRM, payment, or login. A page that requires a login is
seen as an anonymous visitor would see it.

**yt-dlp** is not bundled. On request, FourTout downloads it from the official
release page (GitHub), checks it against the official SHA-256 sums, runs it once
to confirm the version, and stores it in the application data directory. A
failed check installs nothing. See [Internet & Web](../features/INTERNET.md).

**Nothing starts without a click**, and each job can be cancelled; partial output
is removed.

### 4. Speed test

**Sent:** test data generated by FourTout, to and from Cloudflare's measurement
service (`speed.cloudflare.com`). Cloudflare necessarily sees your IP address,
as any web server does.

**Not sent:** any of your files, or any identifier.

### 5. Network tools — your local network only

**Ping**, **Test ports**, and **Discover devices on the local network** open
real connections, exactly where you direct them.

**Sent:** ICMP packets to the entered host, TCP connections to the listed
ports, and, for discovery, an echo request to each address on the subnet to
which the machine is **directly connected**. The interface announces the range
before sending anything, and the range is limited to 256 addresses.

**Not sent:** nothing goes to a remote FourTout service; no such service
exists. Results are not transmitted, aggregated, or uploaded.

Observed addresses, resolved names, hardware addresses, and probe history are
not retained. Recent items may remember that a network tool was opened, never
the network topology. No probe starts on page load: each screen displays its
range and target count and waits for explicit confirmation.

To produce no network traffic, do not run these three tools. Their pages say
that they **use the network**, not that they need the Internet. The currency
converter, the Internet & Web tools, and the speed test have the `internet`
capability. See [Network tools](../features/NETWORK.md).

## What FourTout does not have

- **No account:** no registration, sign-in, or identity.
- **No telemetry:** no usage measurement, automatic crash report, or machine
  identifier.
- **No analytics:** no page loads third-party scripts, and the CSP would block
  them anyway.
- **No advertising.**
- **No automatic updates:** FourTout does not contact a server to check for a
  new release.
- **No synchronization:** nothing is copied to a cloud service.

## Data stored locally

| Data | Contents | Location |
| --- | --- | --- |
| Preferences | Theme, language, interface scale, density, animations | WebView local storage |
| Favorites | Tool IDs | Same |
| Recent tools | Tool IDs and timestamps | Same |
| Exchange rates | Last ECB table and its date | Same |
| Speech, background-removal, and AI-upscaling models | Downloaded files | Application data directory |
| yt-dlp engine | The verified binary, if you installed it | Application data directory, `engines/yt-dlp` |

| System | Path |
| --- | --- |
| Linux | `~/.local/share/app.fourtout.desktop/` |
| Windows | `%APPDATA%\app.fourtout.desktop\` |

None of this contains processed-file content. Settings → Local data erases all
application-owned local data.

## Temporary files

Some media operations use temporary files, for example video concatenation,
multi-pass transcoding, or the private folder yt-dlp writes into. Web capture
creates a temporary browser profile and deletes it afterwards. They are created in the system temporary directory and
**removed when the operation ends, whether it succeeds, fails, or is
cancelled**.

File encryption uses no temporary file. It writes directly to the requested
output and removes that output if the operation fails.

## What FourTout cannot protect

Honesty about limitations is part of the privacy promise:

- **A shared file remains shared.** Removing photo metadata does not remove
  information visibly present in the image.
- **Secure deletion is not physical erasure.** On SSDs, memory cards,
  copy-on-write file systems, snapshots, and backups, software cannot guarantee
  that all earlier copies physically disappear. FourTout states this before
  the action.
- **FourTout redaction removes the selected PDF content**, but a PDF may hold
  data that FourTout cannot see. Always inspect the result.
- **The operating system sees everything.** Recent-file lists, thumbnails,
  indexing, trash, and automatic backups remain outside FourTout's control.

## Verifying these claims

```text
# The complete FourTout network layer:
src-tauri/src/rates.rs        # ECB rates — the only Internet request
src-tauri/src/models/         # model downloads, after an explicit request
src-tauri/src/network/        # local-network diagnostic probes
src-tauri/src/internet/       # HTTP core, file downloads, speed test, URL shortener
src-tauri/src/ytdlp/          # yt-dlp installation and invocation
src-tauri/src/webcapture/     # headless Chromium capture, blank temporary profile

# Probe limits and their tests:
src-tauri/src/network/cidr.rs # at most 256 addresses, no wider than /24
src-tauri/src/network/ports.rs# at most 256 ports per run

# CSP that prevents the interface from making outgoing requests:
src-tauri/tauri.conf.json     # app.security.csp
```

You may also monitor process traffic during a session. Apart from the
currency converter, the Internet & Web tools, the speed test, an explicitly
requested model or yt-dlp download, and diagnostic probes you started yourself,
there is none.
