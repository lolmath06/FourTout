# Speech engines and models

[English](MODELS.md) | [Français](../fr/technical/MODELS.md)

[← Documentation](../README.md)

## Contents

- [Why these engines](#why-these-engines)
- [Catalog](#catalog)
- [File locations](#file-locations)
- [Installation](#installation)
- [Offline operation](#offline-operation)
- [Windows and Fedora packaging](#windows-and-fedora-packaging)
- [Known limitations](#known-limitations)
- [Background-removal models](#background-removal-models)

FourTout speaks and transcribes **locally**. Nothing is sent over the network
during use. The only network access is the initial, user-initiated download of
engines and models.

## Why these engines

| Need | Selected engine | Rejected alternative |
| --- | --- | --- |
| Speech synthesis (TTS) | **Piper** 2023.11.14-2 | Kokoro offers higher quality but requires ONNX Runtime, an external phonemizer, and a 90–310 MB model, without a ready-to-package standalone Windows/Linux binary. |
| Speech recognition (STT) | **whisper.cpp** b4938 | Whisper through ONNX uses the same models but requires a custom execution stack and has no official cross-platform binary. |

Both selected engines provide standalone Linux x86-64 and Windows x86-64
binaries, CPU execution, an MIT license, and a command-line interface that can
be monitored and stopped reliably.

## Catalog

`src-tauri/src/models/mod.rs` declares every file with its official URL,
SHA-256 digest, and size. Nothing unpinned is downloaded.

| Item | Contents | Size | License | Source |
| --- | --- | --- | --- | --- |
| `engine-piper` | Piper, ONNX Runtime, and espeak-ng | 26.5 MB Linux / 22.5 MB Windows | MIT | [rhasspy/piper](https://github.com/rhasspy/piper) |
| `voice-fr-siwis` | `fr_FR-siwis-medium.onnx` and config | 63.2 MB | CC BY 4.0 (SIWIS corpus) | [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) |
| `voice-en-lessac` | `en_US-lessac-medium.onnx` and config | 63.2 MB | Blizzard Challenge 2013 | [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) |
| `engine-whisper` | `whisper-cli` and ggml libraries | 9.5 MB Linux / 8.4 MB Windows | MIT | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| `stt-base` — *Fast* | `ggml-base.bin` | 128.5 MB | MIT | [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) |
| `stt-small` — *Accurate* | `ggml-small.bin` | 487.6 MB | MIT | Same source |

A minimal usable installation—Piper, one voice, whisper.cpp, and `base`—uses
about **227 MB**. Both voices use about 291 MB. The *Accurate* model is optional.

### Transcription-model tradeoff

Measurements on an Intel Core i9-14900HX using four threads and 18.2 seconds of
French speech:

| Model | Time | Real-time factor | RAM (RSS) | Observed quality |
| --- | --- | --- | --- | --- |
| `base` (128 MB) | 1.44 s | **0.08×** | 284 MB | Correct sentences with some approximate agreement and numbers. |
| `small` (488 MB) | 4.39 s | **0.24×** | 750 MB | Clearly more faithful French, about three times slower. |

`base` is the default: it transcribes roughly one hour of audio in five minutes,
keeps the installer reasonable, and works well for clean recordings. Users can
choose `small` when accuracy matters more.

### Synthesis throughput

On the same machine with `fr_FR-siwis-medium`:

| Measurement | Text | Compute | Audio | Throughput | Real-time factor |
| --- | --- | --- | --- | --- | --- |
| Single call | 297 characters | 0.60 s | 18.2 s | 495 chars/s | 0.033× |
| **Real pipeline**, 36 segments | 4,427 characters | 13.1 s | 257 s | **339 chars/s** | **0.051×** |

The full pipeline is about 30% slower because Piper reloads its model for each
segment. This enables immediate cancellation and honest progress while still
producing speech about **20 times faster than playback**. A 300,000-character
book takes about 15 minutes. Each process uses about 194 MB of RAM.

## File locations

`models::resolve_engine` searches in this order:

1. packaged resources under `resources/speech/<engine>/`;
2. the user model directory;
3. `PATH`, for development only.

| System | Model directory |
| --- | --- |
| Fedora / Linux | `~/.local/share/app.fourtout.desktop/models` |
| Windows | `%APPDATA%\app.fourtout.desktop\models` |

`FOURTOUT_MODELS_DIR` overrides the location for tests or shared installations.
The directory contains `engines/piper/`, `engines/whisper/`, `voices/`, `stt/`,
and a working `.partial/` directory cleared after every installation.

## Installation

An installation panel appears inside a tool while a required item is missing.
It states the download, size, and license and acts only after a user click.

Each file is written to `.part` and **verified with SHA-256** before being put
in place. Interrupted downloads, full disks, and cancellation therefore cannot
make a partial model appear valid. Archive extraction checks every path to
prevent traversal and preserves executable bits. Every item can be removed and
reinstalled.

## Offline operation

Once installed, synthesis, transcription, PDF-to-audio, and automatic subtitles
make **no network connection**. Both engines have been exercised in an isolated
network namespace (`unshare -rn`) and complete normally.

## Windows and Fedora packaging

The catalog selects platform assets at compile time with `#[cfg(target_os =
…)]`; Linux downloads the Linux `.tar.gz`, Windows the Windows `.zip`. Nothing
is expected in the end user's `PATH`.

- **Fedora:** the archive preserves permissions. `libpiper_phonemize.so`,
  `libwhisper.so`, and `libggml-*.so` live beside the executable and resolve
  through `RPATH=$ORIGIN`; no `/usr/...` path is hard-coded.
- **Windows:** neighboring DLLs such as `onnxruntime.dll`, `espeak-ng.dll`, and
  `ggml-*.dll` are loaded from the executable directory. Paths with spaces are
  safe because no shell is used.
- **Optional bundled engines:** put binaries in
  `src-tauri/resources/speech/piper/` and `.../whisper/`, then declare them in
  the platform Tauri configuration's `bundle.resources`. `resolve_engine`
  prefers them, leaving only voices and models for the installer panel.

## Known limitations

- One French and one English medium-quality voice are provided. Other Piper
  voices require a catalog entry.
- Transcription auto-detects language, but explicitly choosing French or
  English is more reliable for very short clips.
- Invented proper nouns such as “FourTout” and acronyms may be transcribed
  phonetically by either Whisper model.
- There is no GPU acceleration. The portable CPU builds use half the available
  cores, capped at eight, to keep the machine responsive.

## Background-removal models

The **Remove background** tool runs U²-Net through ONNX Runtime in the WebView.

| Item | File | Size | License |
| --- | --- | --- | --- |
| `seg-u2netp` — Fast | `segmentation/u2netp.onnx` | 4.6 MB | Apache 2.0 |
| `seg-u2net` — Accurate | `segmentation/u2net.onnx` | 176 MB | Apache 2.0 |

Like speech engines, both are declared in `src-tauri/src/models/mod.rs` with an
official URL, SHA-256 digest, and size, and are installed only on request.

Speech engines run natively and read their own files; segmentation runs in the
WebView and therefore needs the model bytes. `models_read_file` accepts only a
catalog item identifier and a file declared by that item, never an arbitrary
path, so it can read only files installed by FourTout. U²-Net was selected for
licensing as well as quality; see
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
