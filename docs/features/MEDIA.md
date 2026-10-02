# Media architecture (FFmpeg)

[English](MEDIA.md) | [Français](../fr/features/MEDIA.md)

[← Documentation](../README.md)

## Overview

The media foundation powers the **Audio** tools and the entire **Video** suite
(conversion, compression, trimming, merging, cropping, subtitles, and more).
Everything runs **locally** through FFmpeg; no content leaves the machine.

The video-specific layer—detection of genuinely usable codecs, per-encoder
quality presets, dimension calculations, and honest compression reporting—is
described in [VIDEO.md](VIDEO.md).

Principles:

- **No shell execution.** FFmpeg is launched with `std::process::Command` and
  strictly separated arguments (`src-tauri/src/media/`). User paths are never
  concatenated into an interpreted command line.
- **Clean binary resolution.** A bundled binary is preferred in packaged
  applications, with the system FFmpeg used as a development fallback.
- **Cancelable, with no zombie processes.** Every job tracks its child process
  and actually kills it when canceled. Temporary files are removed after
  success, failure, or cancellation.
- **Path guard.** `media_exec` rejects any argument representing an absolute
  path outside FourTout's temporary directory.

## Native commands (`src-tauri/src/media/command.rs`)

| Command | Purpose |
| --- | --- |
| `media_available` | Checks whether FFmpeg can run. |
| `media_encoders` | Lists encoders **advertised** by the binary. |
| `media_probe_encoders` | Actually tests encoders with a 64×64 encode and returns those that work; cached for the session. |
| `media_reset_encoder_probes` | Clears those results after hardware changes or for diagnostics. |
| `media_temp` | Returns a temporary output path. |
| `media_stage` | Writes input bytes to a temporary file and returns its path. |
| `media_probe` | Runs ffprobe and returns JSON describing duration, codecs, and streams. |
| `media_exec` | Runs FFmpeg with `media://progress` events and cancellation. |
| `media_read` | Reads a temporary output. |
| `media_cleanup` | Removes temporary files. |
| `media_cancel` | Kills the FFmpeg process associated with a job. |

A tool's frontend flow in `src/core/media/client.ts` is: stage inputs → allocate
an output with `temp` → run `exec` with Job Manager progress and cancellation →
`read` → `cleanup`. Argument builders in `operations/audio.ts` and
`operations/video.ts` are pure functions, covered by tests and exercised with
the real FFmpeg binary.

Three input forms coexist: user files (`files`), application-generated content
(`extraInputs`, such as generated SRT), and files derived from already prepared
paths (`operation.stageText`, used for a concat demuxer list). All are cleaned
up in the same way.

## Codecs

Availability depends on the **FFmpeg build in use**:

- Audio: MP3 (libmp3lame), WAV (pcm_s16le), FLAC, OGG/Vorbis (libvorbis),
  Opus (libopus), and AAC/M4A (aac).
- Video: H.264 (libx264 **or** libopenh264), H.265, VP9, AV1 (libsvtav1 or
  libaom-av1), always resolved at runtime through `media_encoders`; GIF uses an
  optimized palette.
- Subtitles: `srt` for MKV, `webvtt` for WebM, and `mov_text` for MP4. The last
  codec is absent from several common builds, including Fedora's.

`src/core/media/capabilities.ts` combines the advertised list with a real test
encode from `media_probe_encoders`: being listed is not enough. For example, a
compiled but unusable `h264_nvenc` is rejected before it can be offered. See
[VIDEO.md](VIDEO.md).

Fedora's default FFmpeg can omit `libx264`, `libvpx`, or `libvorbis`. The
bundled full build supplies them, which is why the sidecar matters. GIF-to-video
automatically selects an available H.264 encoder.

## Windows and Fedora packaging

`resolve_binary` uses this order:

1. Packaged resources: `resources/ffmpeg/ffmpeg` (`ffmpeg.exe` on Windows),
   then `ffmpeg/ffmpeg`, then the resource root.
2. Development fallback: `ffmpeg` from `PATH`.

Packaging must include binaries that are intentionally not stored in the
repository:

- **Fedora x86_64:** a complete static FFmpeg build, such as a johnvansickle
  build, at `src-tauri/resources/ffmpeg/{ffmpeg,ffprobe}` and declared under
  `tauri.conf.json > bundle.resources`.
- **Windows x86_64:** `ffmpeg.exe` and `ffprobe.exe`, such as gyan.dev or BtbN
  builds, in the same location.

The end user does not need a system installation. Licenses for the chosen
GPL/LGPL builds must be distributed beside the binaries.

## Temporary files

Files live under `std::env::temp_dir()/fourtout-media/` with randomized names
based on the process ID and timestamp. Paths containing spaces, accents, or
other Unicode characters are supported and tested. Cleanup is systematic.

## Long-running jobs

Media operations use the shared Job Manager. `media://progress` feeds progress,
the job's cancellation signal calls `media_cancel` to kill FFmpeg, and jobs
survive navigation.

## Speech foundation (Piper and whisper.cpp)

Speech synthesis and transcription follow the same rules: no shell, separated
arguments, a tracked child process that is killed on cancellation, and working
files confined to `fourtout-media/`. They reuse `media_stage`, `media_temp`,
`media_read`, and `media_cleanup`, plus FFmpeg to normalize media to mono 16 kHz
WAV before transcription or export synthesis as MP3.

Unlike FFmpeg, speech binaries are not assumed to be installed. The model
manager declares, downloads, and verifies them; see
[MODELS.md](../technical/MODELS.md). Commands include `tts_speak`,
`tts_concat`, `stt_transcribe`, `speech_cancel`, and the `models_*` family.

## Tests

- `src-tauri/tests/speech_integration.rs`: real French and English
  text-to-speech-to-text round trips and multi-segment synthesis, skipped when
  engines are unavailable.
- `src-tauri/tests/media_integration.rs`: real execution and inspection,
  Unicode paths, and invalid-input errors, skipped without FFmpeg.
- `src/core/media/media.test.ts`: pure audio builders plus real FFmpeg
  execution verified with ffprobe.
- `src/core/media/video.test.ts`: resizing, cropping, rotation, speed, cuts,
  copy and normalized merges, audio tracks, and subtitles.
- `src/core/media/pipeline.test.ts`: cleanup after success, failure, and
  cancellation through a simulated native bridge.
- `src-tauri/src/media/`: parsing and path-guard unit tests.
