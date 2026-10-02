# Video architecture

[English](VIDEO.md) | [Français](../fr/features/VIDEO.md)

[← Documentation](../README.md)

The video suite builds on the shared [media foundation](MEDIA.md): the same
native commands, temporary files, progress, and real cancellation.

## Offer only what the engine can do

FFmpeg builds expose different codecs. Fedora may provide `libopenh264` but not
`libx264` or `mov_text`; GPU encoders can be compiled in yet unusable on the
current hardware. FourTout therefore distinguishes:

1. `media_encoders`: encoders FFmpeg advertises;
2. `media_probe_encoders`: candidates that pass a real, 12-second-bounded
   64×64 test encode.

Only the second list drives the UI. Results are cached per session and retain
accepted and rejected encoders for diagnostics. Container-specific helpers in
`capabilities.ts` determine codecs, maximum compatibility, and subtitle support.

Software encoders are preferred for reliability—such as `libx264`, then
`libopenh264`, before NVENC/QSV/VAAPI. Pipelines also provide ordered runtime
fallbacks because real files can expose profile, resolution, or memory failures
not seen by the probe. Retries occur only for recognized encoder-unavailable
errors and are disclosed. An explicitly selected custom encoder never changes
behind the user's back.

## Encoder-specific quality

`src/core/media/video/presets.ts` maps an intent such as high quality or small
file to each encoder's real controls: CRF and presets for x264/x265, VP9 and AV1
specific scales, and a source-aware target bitrate for OpenH264 and hardware
encoders. A universal CRF would fail on OpenH264. `yuv420p` is always selected
for broad playback compatibility.

`sizeOutcome()` never describes a larger output as a successful saving. It says
the source was already sufficiently optimized and never reports a false 0%
gain.

## Dimensions and cropping

`dimensions.ts` enforces even dimensions for `yuv420p` and never upscales
silently. Vertical video remains vertical; “720p” refers to its short side.
Displayed crop fractions become even, contained source pixels through
`cropRectFor`, so the exported region matches the overlay. Aspect constraints
are applied in source pixels.

## Merging

`concatCompatible()` compares codecs, dimensions, frame rate, and audio. Fully
compatible files use the concat demuxer with `-c copy`. Others use a
`filter_complex` pipeline that scales without distortion, pads, sets square
pixels, normalizes frame rate, and resamples stereo audio at 48 kHz. Silent
inputs receive duration-matched silence so tracks remain aligned.

## Subtitles

| Tool | Effect | Re-encoding |
| --- | --- | --- |
| Add track | Creates a player-switchable text track | No (`-c copy`) |
| Burn in | Renders text into video pixels | Video only |
| Extract | Writes existing text tracks as SRT/VTT | No |

Soft tracks use SRT in MKV, WebVTT in WebM, and `mov_text` in MP4. When
`mov_text` is unavailable, FourTout switches to MKV and says so. Bitmap subtitle
formats are reported but not falsely presented as text; OCR would be required.
Burning escapes FFmpeg filter paths safely, including Windows drive letters,
commas, and colons.

Automatic video subtitles reuse the existing `TranscriptWorkbench` and
whisper.cpp pipeline. The optional burn step has a separate job ID so it does
not replace the transcription job.

## Jobs and temporary files

Long encodes live in the global background-job controller, not a React
component. FFmpeg `-progress pipe:1` drives progress; cancellation calls
`media_cancel` and kills the child process; no partial result is returned.
Notifications and result state survive navigation.

`runMedia` stages user files, generated inputs, and derived text files such as
concat lists, then cleans every temporary in `finally` after success, error, or
cancellation. Original files are never modified or deleted.

## Errors and one decision point

`src/core/media/errors.ts` translates known FFmpeg failures—invalid input,
missing codecs or tracks, incompatible containers, full disk, denied access,
and cancellation—while retaining unknown technical messages rather than
inventing an explanation.

All tools call `src/core/media/video/pipelines.ts`, the single place selecting
containers, encoders, quality, filters, and fallbacks. This lets the integration
matrix test the exact decisions made by the interface.

## Shared interface

`VideoToolShell` handles drop, cached ffprobe data, capabilities, global jobs,
errors, and results. `VideoPreview`, `CropOverlay`, `VideoInfoList`, and
`shared.ts` provide playback, crop selection, reordering, container defaults,
audio copy/re-encode choices, and size reports. FourTout intentionally remains
a collection of focused tools, not a video editor.

## Tests

The test matrix performs real capability detection and executes every tool
pipeline against fixtures, then inspects output with ffprobe. Additional suites
cover operation builders, staging and cleanup, hardware encoders that are
advertised but unusable, native probes, dimensions, presets, errors, job
survival/cancellation, and catalog-to-implementation alignment.
