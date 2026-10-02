# Building packages

[English](BUILD.md) | [Français](../fr/technical/BUILD.md)

[← Documentation](../README.md)

## Contents

- [Principle](#principle)
- [Checks before building](#checks-before-building)
- [Building](#building)
- [Output locations](#output-locations)
- [Inspecting a Linux package without installing it](#inspecting-a-linux-package-without-installing-it)
- [Declared dependencies](#declared-dependencies)
- [Windows](#windows)
- [Reproducibility](#reproducibility)

Building FourTout produces an executable and installers. This page documents
what is produced on each platform and which checks remain manual.

## Principle

Tauri builds **for the platform on which it runs**. There is no simple Linux
to Windows cross-build because the WebView, system libraries, and packager are
different.

| Build machine | Packages |
| --- | --- |
| Fedora / Linux x86-64 | `.rpm`, `.deb`, `.AppImage` |
| Windows x86-64 | `.exe` (NSIS), `.msi` |

The release workflow therefore uses two runners. See [Release](RELEASE.md).

## Checks before building

```bash
pnpm verify
cd src-tauri && cargo test && cd ..
```

## Building

### All packages for the current platform

```bash
pnpm app:build
```

`src-tauri/tauri.conf.json` declares `deb`, `rpm`, `appimage`, `nsis`, and
`msi`. Tauri silently ignores targets for other platforms.

### Specific targets

```bash
pnpm tauri build --bundles rpm
pnpm tauri build --bundles rpm,appimage
pnpm tauri build --bundles nsis          # on Windows
```

### Executable only, without packaging

```bash
pnpm tauri build --no-bundle
```

This verifies the release-profile build without waiting for packaging. It
takes roughly 75 seconds on a development machine, compared with several
minutes for an AppImage.

## Output locations

```text
src-tauri/target/release/
  fourtout                                        executable
  bundle/
    rpm/FourTout-1.0.0-1.x86_64.rpm
    deb/FourTout_1.0.0_amd64.deb
    appimage/FourTout_1.0.0_amd64.AppImage
    nsis/FourTout_1.0.0_x64-setup.exe             (Windows)
    msi/FourTout_1.0.0_x64_en-US.msi              (Windows)
```

## Inspecting a Linux package without installing it

This is useful in CI and on machines that must not be modified.

```bash
RPM=src-tauri/target/release/bundle/rpm/FourTout-1.0.0-1.x86_64.rpm

rpm -qip "$RPM"                 # name, version, description
rpm -qlp "$RPM"                 # contents
rpm -qRp "$RPM"                 # strict dependencies
rpm -q --recommends -p "$RPM"   # recommended dependencies
rpm -K --nosignature "$RPM"     # payload integrity

# Extract and inspect without installing
mkdir /tmp/ft && cd /tmp/ft
rpm2cpio "$RPM" | cpio -idm
desktop-file-validate usr/share/applications/FourTout.desktop
file usr/share/icons/hicolor/*/apps/fourtout.png
```

The package must contain:

```text
/usr/bin/fourtout
/usr/lib/FourTout/resources/wordlists/seeds.txt.gz
/usr/lib/FourTout/resources/wordlists/seeds.meta
/usr/share/applications/FourTout.desktop
/usr/share/icons/hicolor/{32x32,128x128,256x256@2}/apps/fourtout.png
```

Test the AppImage directly:

```bash
chmod +x src-tauri/target/release/bundle/appimage/FourTout_1.0.0_amd64.AppImage
./src-tauri/target/release/bundle/appimage/FourTout_1.0.0_amd64.AppImage
```

## Declared dependencies

| Type | Packages | Reason |
| --- | --- | --- |
| **Required** | `libwebkit2gtk-4.1`, `libgtk-3` | The app cannot start without them; every desktop installation provides them. |
| **Recommended** | `ffmpeg-free` (RPM), `ffmpeg` (DEB) | Needed by 34 audio/video tools but not the other 117. `dnf` and `apt` install it by default, while its absence does not block FourTout installation. |

FFmpeg is **not bundled**. FourTout first searches application resources under
`resources/ffmpeg/`, then the system `PATH`. This avoids redistributing FFmpeg
and assuming its licensing obligations; see
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

To make a **self-contained** package, place the binaries under
`src-tauri/resources/ffmpeg/` and add them to `bundle.resources`.
`resolve_binary` will find them before `PATH`. You then become the distributor
of FFmpeg and must meet the applicable LGPL or GPL obligations.

## Windows

### Build outputs

- **NSIS (`.exe`)** is the recommended installer. With
  `installMode: currentUser`, it requires **no administrator rights**, installs
  in the user's directory, and creates a Start-menu entry. The installer's
  language picker is disabled; English and French are included.
- **MSI** supports Group Policy deployments.
- A **portable ZIP** is assembled by the release workflow from `FourTout.exe`
  and its resources. It is created only when the executable actually exists;
  the workflow never emits an empty archive merely to add an artifact. Models
  installed on demand still go to `%APPDATA%`.

### Signing

The installers are currently **unsigned**, so SmartScreen warns on first
launch, as stated in [Installation](../guides/INSTALLATION.md).

Adding signing requires no code change. The workflow already accepts these
GitHub secrets:

| Secret | Contents |
| --- | --- |
| `WINDOWS_CERTIFICATE` | Base64-encoded `.pfx` certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Certificate password |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater signing key, if updates are enabled later |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password |

When `WINDOWS_CERTIFICATE` is absent, signing is skipped and the documented
unsigned installer is produced. **No key is generated or committed here.**

## Reproducibility

Both `pnpm-lock.yaml` and `src-tauri/Cargo.lock` are committed, so a clean clone
uses the same dependency versions. The build does not depend on an absolute
path, a manually installed model, or an untracked file. Build-time pdf.js and
Tesseract resources are copied from `node_modules` by `pre*` scripts and are
therefore locked as well.

```bash
git archive HEAD | (mkdir -p /tmp/ft-clean && tar -x -C /tmp/ft-clean)
cd /tmp/ft-clean
pnpm install --frozen-lockfile
pnpm verify
```
