# Privacy

[English](PRIVACY.md) | [Français](../fr/legal/PRIVACY.md)

[← Documentation](../README.md)

FourTout processes your files on your device. This page states exactly what
leaves the device and what never does, based on what the code does rather than
on the project's intentions.

All claims are verifiable. FourTout's network layer is confined to three
native areas: `src-tauri/src/rates.rs` for exchange rates,
`src-tauri/src/models/` for models, and `src-tauri/src/network/` for three
diagnostic probes that never leave the local network. The application's Content
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

## What leaves the device, and why

Only two features contact the Internet. A third family opens connections only
on your local network.

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

### 2. Models for speech and background removal

**Sent:** an explicitly requested download from GitHub for Piper, whisper.cpp,
and U²-Net components, or from Hugging Face for voices and transcription
models, initiated from Settings → Models.

**Not sent:** the text to synthesize, audio to transcribe, or image to process.
Once installed, models work entirely offline. Every download is verified by
digest before installation; a mismatch is rejected and nothing is installed.
See [Models](../technical/MODELS.md).

### 3. Network tools — your local network only

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
that they **use the network**, not that they need the Internet. Only the
currency converter has the `internet` capability. See
[Network tools](../features/NETWORK.md).

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
| Speech and background-removal models | Downloaded files | Application data directory |

| System | Path |
| --- | --- |
| Linux | `~/.local/share/app.fourtout.desktop/` |
| Windows | `%APPDATA%\app.fourtout.desktop\` |

None of this contains processed-file content. Settings → Local data erases all
application-owned local data.

## Temporary files

Some media operations use temporary files, for example video concatenation or
multi-pass transcoding. They are created in the system temporary directory and
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

# Probe limits and their tests:
src-tauri/src/network/cidr.rs # at most 256 addresses, no wider than /24
src-tauri/src/network/ports.rs# at most 256 ports per run

# CSP that prevents the interface from making outgoing requests:
src-tauri/tauri.conf.json     # app.security.csp
```

You may also monitor process traffic during a session. Apart from the currency
converter, an explicitly requested model download, and diagnostic probes you
started yourself, there is none.
