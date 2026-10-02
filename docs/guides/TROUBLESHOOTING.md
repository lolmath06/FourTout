# Troubleshooting

[English](TROUBLESHOOTING.md) | [Français](../fr/guides/TROUBLESHOOTING.md)

[← Documentation](../README.md)

## The application does not start

### Linux — `error while loading shared libraries: libwebkit2gtk-4.1.so.0`

Install WebKitGTK:

| Distribution | Package |
| --- | --- |
| Fedora | `sudo dnf install webkit2gtk4.1` |
| Debian, Ubuntu | `sudo apt install libwebkit2gtk-4.1-0` |
| Arch | `sudo pacman -S webkit2gtk-4.1` |
| openSUSE | `sudo zypper install libwebkit2gtk-4_1-0` |

The `.rpm` and `.deb` declare this dependency, so their package managers
install it. Only the AppImage can encounter a missing library.

### Linux — blank window or broken rendering

Some graphics drivers have problems with WebKitGTK hardware acceleration. Try:

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 fourtout
```

If that fixes the problem, add the variable to your desktop launcher.

### Windows — WebView2 not found

Install the *Evergreen Runtime* from
[Microsoft's WebView2 page](https://developer.microsoft.com/microsoft-edge/webview2/).
Windows 11 and current Windows 10 installations already include it.

### Windows — SmartScreen blocks the installer

This is expected while installers remain unsigned. Choose **More info** →
**Run anyway**, after comparing the downloaded file's SHA-256 digest with the
release's `SHA256SUMS.txt`.

## Audio or video tools are unavailable

When FFmpeg is missing, the relevant page says so. Install it:

| System | Command |
| --- | --- |
| Fedora | `sudo dnf install ffmpeg-free` |
| Debian, Ubuntu | `sudo apt install ffmpeg` |
| Arch | `sudo pacman -S ffmpeg` |
| Windows | `winget install Gyan.FFmpeg`, or use [ffmpeg.org](https://ffmpeg.org/download.html) and add `bin` to `PATH` |

Then check:

```bash
ffmpeg -version
ffprobe -version
```

**Restart FourTout on Windows after changing `PATH`** because a running process
does not reload its environment.

### An expected codec is not offered

This is deliberate. FourTout offers only encoders that the installed FFmpeg
can **actually use**, testing each with a short encode at startup. FFmpeg may
advertise `h264_nvenc` even when the required GPU or driver is absent; FourTout
prefers not to offer an encoder that will fail after the user starts a job.

Fedora's `ffmpeg-free` omits some patent-encumbered codecs. RPM Fusion provides
a more complete FFmpeg build.

## Speech recognition or synthesis does not work

These tools require a model, which is not bundled. Install it under
**Settings → Models**. Internet access is needed once for the download; see
[Models](../technical/MODELS.md).

If a download fails with a digest error, nothing is installed. The integrity
check is doing its job; retry the download.

## The microphone does not work on Linux

WebKitGTK requires native arbitration of microphone permission. FourTout grants
it when the recorder asks. If nothing happens:

1. Confirm the microphone works elsewhere with `gnome-sound-recorder` or
   `arecord -l`.
2. Confirm PipeWire or PulseAudio is running.
3. Under Flatpak or Snap, confirm microphone access is allowed.

## An operation is very slow

Video compression, OCR, duplicate searches over large folders, and PDF
password recovery are inherently expensive.

- Progress appears in the tool and task indicator.
- You can leave the page; the job continues.
- **Cancel** stops the real process and removes temporary files.

File encryption begins with an Argon2id derivation that takes about one second
and uses 64 MiB. This is **intentional**: it makes brute-force attacks costly.

## “Wrong password” even though it is correct

The exact message is “Wrong password, or altered file.” Authenticated
encryption cannot distinguish these two conditions; that is not a defect.

Check that:

- the `.ftenc` file was not truncated by an incomplete transfer;
- FourTout produced it — the signature is checked, and another format gives a
  different error;
- the keyboard layout matches the one used when the password was entered.

There is **no recovery mechanism**. This is expected behavior.

## The currency converter shows nothing

It is the only tool that requires Internet access.

- **Offline with cached rates:** FourTout uses the last known table and shows
  its date. Check the date before trusting the amount.
- **Offline without cached rates:** FourTout says so and shows no invented
  value.
- **Online but failing:** the European Central Bank publishes once per working
  day. A corporate firewall or proxy may block `ecb.europa.eu`.

## A protected archive does not open elsewhere

FourTout produces **WinZip AES-256**, supported by 7-Zip, WinRAR, PeaZip, Keka,
and Windows Explorer. Very old tools and old versions of `unzip` do not support
ZIP AES and will fail.

ZIP **filenames** remain visible without the password; only contents are
encrypted. That is a format limitation. To hide names as well, encrypt the
archive with the file-encryption tool.

## A Word-to-PDF result does not resemble the document

This is an explicit limitation on the tool page. FourTout preserves content
and structure — headings, paragraphs, bold, italic, lists, and simple tables —
but not Word layout. Columns, floating objects, headers, footers, specific
fonts, and images may differ or disappear.

Pixel-perfect reproduction requires a Word layout engine. Export from Word or
LibreOffice when exact layout matters.

## The interface is too large or too small

Use `Ctrl` `+`, `Ctrl` `-`, `Ctrl` `0`, or `Ctrl` plus the mouse wheel. The
same setting is available under **Settings → Appearance** from 80% to 150% and
is persisted.

If the interface looks enlarged twice, the WebView may be applying its own
zoom on top. `Ctrl` `0` resets it.

## Starting from scratch

**Settings → Local data → Erase everything** resets preferences, favorites,
recent tools, and cached rates.

To remove installed models as well, delete the application data directory:

| System | Path |
| --- | --- |
| Linux | `~/.local/share/app.fourtout.desktop/` |
| Windows | `%APPDATA%\app.fourtout.desktop\` |

No working file is stored there.

## Reporting a problem

Open a GitHub issue with the FourTout version, operating system, reproduction
steps, and exact error message.

**Do not open a public issue for a security vulnerability.** See
[Security](../legal/SECURITY.md#reporting-a-vulnerability).
