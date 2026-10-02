# Installation

[English](INSTALLATION.md) | [Français](../fr/guides/INSTALLATION.md)

[← Documentation](../README.md)

## Contents

- [Windows 10 and 11](#windows-10-and-11)
- [Fedora, RHEL, and CentOS Stream](#fedora-rhel-and-centos-stream)
- [Other Linux distributions](#other-linux-distributions)
- [FFmpeg (audio and video)](#ffmpeg-audio-and-video)
- [Speech models (optional)](#speech-models-optional)
- [Verifying a download](#verifying-a-download)
- [Where is my data?](#where-is-my-data)
- [Installation problems](#installation-problems)

---

FourTout is a desktop application. There is nothing to configure: download the
package for your system, install it, and launch it.

Packages are published on the GitHub repository's **Releases** page together
with `SHA256SUMS.txt`, which lets you verify the downloaded file.

---

## Windows 10 and 11

**Recommended file:** `FourTout-<version>-Windows-x64-Setup.exe`, the NSIS
installer available from the repository's **Releases** page.

> **Do not use “Code → Download ZIP.”** That archive contains the source code,
> not the application.

1. Download the `.exe`.
2. Double-click it.
3. FourTout installs for the current user; **administrator rights are not
   required**.
4. FourTout appears in the Start menu.

An `.msi` is also published for Group Policy deployments.

### SmartScreen warning

The installers are not yet signed with a code-signing certificate. On first
launch, Windows therefore displays:

> Windows protected your PC — Unrecognized app

This is normal for unsigned software and does not indicate a defect. To
continue, choose **More info** → **Run anyway**. First verify the SHA-256 digest
of the downloaded file as explained below.

Signing requires a paid certificate from a recognized authority. It will be
added; until then, the documentation states the limitation instead of letting
users discover the warning unexpectedly.

### Windows prerequisites

- **WebView2:** included with Windows 11 and current Windows 10 installations.
  The installer downloads it automatically when necessary.
- **FFmpeg:** needed only by audio and video tools. See
  [FFmpeg](#ffmpeg-audio-and-video).

### Uninstallation

Use Settings → Apps → FourTout → Uninstall, or the “Uninstall FourTout” entry
in the Start menu.

### Verifying a Windows installation

Run this checklist once on a Windows machine after a release. It requires no
Node, Rust, or command line except for the optional digest check.

1. **Download** `FourTout-<version>-Windows-x64-Setup.exe` from Releases. Check
   its SHA-256 digest:

   ```powershell
   Get-FileHash .\FourTout-<version>-Windows-x64-Setup.exe -Algorithm SHA256
   ```

   Compare it with the corresponding line in `SHA256SUMS.txt`.
2. **Install** by double-clicking. While the installer remains unsigned, pass
   the SmartScreen warning with *More info* → *Run anyway*.
   **No User Account Control prompt should appear:** installation is scoped to
   the current user.
3. **Start menu:** FourTout appears with its own icon (navy square, white F),
   not a generic icon or the Tauri logo.
4. **Launch:** the window opens, its taskbar icon is correct, and its title is
   “FourTout.”
5. Try **three tools with no external dependency**: *Percentage calculations*,
   *JSON — format and validate*, and *Merge PDFs*. They must work immediately.
6. Try **a video tool**. Without FFmpeg in `PATH`, the screen must **say so
   clearly**, not fail silently. Install FFmpeg with
   `winget install Gyan.FFmpeg`, **restart FourTout**, and confirm that the tool
   becomes available.
7. Try **a model-based tool**. Open *Remove background*: the screen must offer
   a download and display its size, source, and license. Install it, process a
   photo, and inspect the resulting PNG.
8. Test **zoom** with `Ctrl` `+`, `Ctrl` `-`, and `Ctrl` `0`. Close and reopen
   the app: the scale must persist.
9. **Uninstall** from Settings → Apps. The Start-menu entry must disappear.

The data folder (`%APPDATA%\app.fourtout.desktop\`) survives uninstallation by
design because it contains preferences and models. Delete it manually to start
from scratch.

---

## Fedora, RHEL, and CentOS Stream

**Recommended file:** `FourTout-<version>-Fedora-x86_64.rpm` from the
repository's **Releases** page.

Double-clicking the `.rpm` opens GNOME Software or your desktop's package
manager. From a terminal:

```bash
sudo dnf install ./FourTout-<version>-Fedora-x86_64.rpm
```

FourTout then appears under *Utilities* in the Applications menu.

The package **recommends** `ffmpeg-free`; `dnf` installs it automatically with
FourTout unless explicitly prevented. Its strict dependencies include
`webkit2gtk-4.1` and `gtk3`, both present on every Fedora desktop installation.

### Uninstallation

```bash
sudo dnf remove four-tout
```

> The RPM package name is `four-tout`, the normalized form of “FourTout”
> produced by the packager.

---

## Other Linux distributions

**Recommended file:** `FourTout-<version>-Linux-x86_64.AppImage`.

```bash
chmod +x FourTout-<version>-Linux-x86_64.AppImage
./FourTout-<version>-Linux-x86_64.AppImage
```

The AppImage is self-contained: it installs nothing and requires no special
rights. It does not add an Applications-menu entry. Use an AppImage integrator
for that, or choose the `.rpm` on Fedora or `.deb` on Debian and Ubuntu, which
are also published.

The host system must provide `libwebkit2gtk-4.1`. Install it first on systems
that do not include it:

| Distribution | Package |
| --- | --- |
| Debian, Ubuntu | `libwebkit2gtk-4.1-0` |
| Fedora | `webkit2gtk4.1` |
| Arch | `webkit2gtk-4.1` |
| openSUSE | `libwebkit2gtk-4_1-0` |

---

## FFmpeg (audio and video)

FourTout's **34 audio and video tools** use FFmpeg. The other 117 tools do not
need it and work without it.

FourTout searches for FFmpeg in this order:

1. its own resources under `resources/ffmpeg/`, if present;
2. the system `PATH`.

| System | Installation |
| --- | --- |
| Fedora | `sudo dnf install ffmpeg-free` (automatically recommended by the RPM) |
| Debian, Ubuntu | `sudo apt install ffmpeg` |
| Arch | `sudo pacman -S ffmpeg` |
| Windows | Use [ffmpeg.org/download](https://ffmpeg.org/download.html) and add its `bin` directory to `PATH`, or run `winget install Gyan.FFmpeg` |

Pages that require FFmpeg clearly report when it is absent instead of failing
during processing. The codecs offered are those that the **installed** FFmpeg
can actually produce. FourTout tests them by performing a short encode at
startup rather than merely trusting FFmpeg's advertised list.

---

## Speech models (optional)

Speech synthesis through Piper and transcription through whisper.cpp each need
a model. Models are **not** bundled with the application: they range from tens
to hundreds of megabytes, and most users do not need them.

FourTout's model manager under Settings → Models downloads them only after an
explicit request, verifies their digest, and installs them in the application
data directory. Everything then works offline.

See [Models](../technical/MODELS.md) for details.

---

## Verifying a download

Every release includes `SHA256SUMS.txt`.

```bash
# Linux, macOS
sha256sum -c SHA256SUMS.txt --ignore-missing
```

```powershell
# Windows PowerShell
Get-FileHash .\FourTout-1.0.0-Windows-x64-Setup.exe -Algorithm SHA256
```

Compare the resulting digest with the published one. FourTout can also do this:
the **Verify a checksum** tool compares a file against the digest supplied by
its source.

---

## Where is my data?

FourTout stores only preferences, favorites, and recently used tools.

| System | Location |
| --- | --- |
| Linux | `~/.local/share/app.fourtout.desktop/` |
| Windows | `%APPDATA%\app.fourtout.desktop\` |

Processed files are saved only where you request. Settings → Local data lets
you erase all locally stored application data.

---

## Installation problems

See [Troubleshooting](TROUBLESHOOTING.md).
