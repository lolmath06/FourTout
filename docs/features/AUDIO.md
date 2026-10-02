# Audio and speech

[English](AUDIO.md) | [Français](../fr/features/AUDIO.md)

[← Documentation](../README.md)

## Available audio tools

All tools use the local, cancelable FFmpeg foundation with progress reporting;
see [MEDIA.md](MEDIA.md).

| Tool | Purpose |
| --- | --- |
| Convert audio | MP3, WAV, FLAC, OGG, Opus, and AAC/M4A. |
| Compress audio | Light, balanced, or strong MP3/Opus/AAC compression with displayed savings. |
| Trim audio | Extract a `hh:mm:ss.mmm` range with a player for locating timestamps. |
| Merge audio | Reorder files, then transcode and normalize with FFmpeg. |
| Adjust volume | Apply gain in dB with clipping warnings. |
| Normalize audio | EBU R128 `loudnorm` presets for standard, podcast, or music. |
| Change speed | 0.5×–2× while **preserving pitch** with `atempo`. |
| Remove silence | Configurable threshold and minimum duration with `silenceremove`. |
| Extract video audio | Export MP3/WAV/etc. or **copy the track** without re-encoding. |
| Record microphone | WebView MediaRecorder capture, exported through FFmpeg as WAV or WebM. |
| Text to speech | Local Piper synthesis, preview, WAV, or MP3. |
| Text file to audio | Editable TXT/Markdown input using the same pipeline. |
| PDF to audio | Text extraction or OCR followed by audiobook-style speech. |
| Transcribe audio | Timestamped text from **audio or video** with whisper.cpp. |
| Generate subtitles | SRT and WebVTT from audio or video. |

`AudioPreview` provides reusable playback, pause, timeline, and volume controls.

### Microphone recording

Capture uses `getUserMedia` and `MediaRecorder` in the WebView.

On Linux, WebKitGTK does not show a permission dialog by itself and rejects
capture by default. `src-tauri/src/microphone.rs` enables media streams, then
intercepts WebView permission requests. It accepts audio-only requests solely
after user consent; camera and every other permission type are rejected.

`mic_request_permission` opens a real native **Allow** / **Deny** dialog only
when the user clicks *Start*, never at application launch. The decision lasts
for the session. After denial, **Allow microphone** can reopen the dialog. On
macOS and Windows, the system WebView handles permission and
`mic_permission_state` returns `granted`.

Stopping, unmounting, or failing always stops every `MediaStream` track and
`MediaRecorder`, closes the `AudioContext`, cancels the level loop, and revokes
the object URL. A synchronous lock prevents double-clicks from opening two
captures.

The native GTK dialog and physical capture require a manual test: start a
recording, allow access, speak, stop, replay, and confirm the system microphone
indicator turns off. Repeat with denial and confirm the error and retry button.

## Speech synthesis (TTS) — `available`

Engine: **Piper**, with `fr_FR-siwis-medium` and `en_US-lessac-medium`. See
[MODELS.md](../technical/MODELS.md) for installation, size, licenses, and
measurements.

```text
text → normalization → segmentation → per-segment synthesis
     → PCM concatenation → WAV (→ MP3 through FFmpeg)
```

Segmentation in `core/speech/segment.ts` follows language boundaries, not a
blind counter: paragraphs, then sentences, grouped to about 480 characters.
Common abbreviations and decimal numbers do not end sentences. An overlong
sentence is split at a comma or space, never inside a word.

Native concatenation in `speech/wav.rs` joins the same voice's PCM segments
under a new header. It is exact and immediate and avoids re-encoding WAV.

**Listen to preview** synthesizes only the first sentence, capped at 200
characters. Full generation is a global job in `features/jobs/speech.ts`, so it
survives navigation. Cancellation kills Piper, stops the loop, and removes all
temporary segments; partial output is never presented as a result.

WAV is always available, with MP3 through FFmpeg. Results report duration,
size, voice, and format. The measured full-pipeline throughput is 339
characters per second on an i9-14900HX, about 20× faster than playback.

## Transcription (STT) and subtitles — `available`

Engine: **whisper.cpp**, with `base` (*Fast*, default) and optional `small`
(*Accurate*) models. The measured tradeoff is documented in
[MODELS.md](../technical/MODELS.md).

```text
audio or video → FFmpeg (mono 16 kHz WAV, -vn) → whisper.cpp
               → timestamped segments → text, SRT, VTT
```

MP4, MKV, WebM, and MOV use the same path; FFmpeg extracts their audio. Users
can select automatic detection, French, or English. Auto-detection is reliable
after several seconds of speech; an explicit language is safer for short clips.

Segments are shown with timestamps and can be edited individually. Editing
preserves timings, so exported SRT/VTT uses corrected text at the original
positions. Exports support copy, `.txt`, `.srt`, and `.vtt`; UTF-8 accents are
preserved and durations are always positive. Progress comes from whisper.cpp,
jobs survive navigation, and cancellation kills the process.

## PDF to audio

See [PDF.md](PDF.md). The tool extracts text, carefully removes repeating
headers and page numbers, and runs the synthesis pipeline. A PDF without a text
layer says so and offers the existing OCR tool.

## Fixtures

Audio, video, QR, watermark, favicon, palette, TTS text, and PDF-to-audio
fixtures are generated under `test-assets/generated/`. The speech fixtures
`audio-speech-fr.wav` and `audio-speech-en.wav` are created by the real Piper
voices from their matching text (`pnpm speech:assets`). The native integration
test then reads them with STT, providing a genuine TTS → STT cross-check. The
generator exits cleanly when engines are absent and never downloads anything.
