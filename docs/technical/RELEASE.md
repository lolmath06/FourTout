# Releasing a version

[English](RELEASE.md) | [Français](../fr/technical/RELEASE.md)

[← Documentation](../README.md)

Follow this checklist in order. Decisions are made in steps 0 and 5, not while
the release is already in progress.

## 0. One-time decisions

Resolve these points **before the first public release**:

- [x] **License:** proprietary; see [`LICENSE`](../../LICENSE). Copyright ©
  2026 Matheo Dolmen, all rights reserved.
- [x] **Icon:** FourTout branding is in place. The source is
  `docs/assets/branding/fourtout-logo.png`; regenerate the icon set with
  `pnpm tauri icon docs/assets/branding/fourtout-icon-1024.png`.
- [ ] **Windows signing:** without a code-signing certificate, SmartScreen
  warns on first launch. If a certificate is acquired, store the Base64 `.pfx`
  in `WINDOWS_CERTIFICATE` and its password in
  `WINDOWS_CERTIFICATE_PASSWORD` in GitHub repository secrets. The workflow is
  ready to use them. **Never commit a key.**

## 1. Confirm a clean repository

```bash
git status
git log --oneline -10
```

## 2. Make everything green

```bash
pnpm install --frozen-lockfile
pnpm test:assets
pnpm verify

cd src-tauri
cargo check --all-targets
cargo test
cd ..
```

Record the exact test counts for the release notes.

## 3. Build and install the Linux packages

```bash
pnpm tauri build --bundles rpm,appimage
RPM=src-tauri/target/release/bundle/rpm/FourTout-*.x86_64.rpm
rpm -qip $RPM && rpm -qlp $RPM && rpm -K --nosignature $RPM
```

- [ ] Install the RPM on a test machine with `sudo dnf install ./FourTout-*.rpm`.
- [ ] Confirm that the FourTout icon is shown, not a generic icon.
- [ ] Confirm the Applications-menu entry and launch it from there.
- [ ] Exercise two or three tools: one PDF, one calculator, one developer tool.
- [ ] Uninstall cleanly with `sudo dnf remove four-tout`.
- [ ] Launch the AppImage directly.

## 4. Build and install the Windows package

On Windows, or through the release workflow:

```powershell
pnpm install
pnpm tauri build --bundles nsis
```

Then follow the [Windows installation checklist](../guides/INSTALLATION.md#verifying-a-windows-installation):
current-user installation, Start menu, icon, three dependency-free tools, a
video tool, a model-based tool, zoom persistence, and uninstallation.

## 5. Choose the version

These files must contain the **same** version:

- `package.json` → `version`;
- `src-tauri/tauri.conf.json` → `version`;
- `src-tauri/Cargo.toml` → `[package] version`.

```bash
grep -m1 '"version"' package.json src-tauri/tauri.conf.json
grep -m1 '^version' src-tauri/Cargo.toml
```

After changing it, refresh `Cargo.lock` with:

```bash
cd src-tauri && cargo check && cd ..
```

## 6. Update the changelog

Add the version section to [`CHANGELOG.md`](../../CHANGELOG.md), describing
what users gain rather than listing commits.

```bash
git add -A && git commit -m "Version X.Y.Z"
```

## 7. Tag and push

```bash
git tag -a vX.Y.Z -m "FourTout X.Y.Z"
git push origin main
git push origin vX.Y.Z
```

## 8. Let the workflow run

Pushing a `v*` tag triggers `.github/workflows/release.yml`. Ubuntu and Windows
runners build their packages, calculate SHA-256 digests, and create a **draft**
release.

Artifact collection **fails loudly** if an expected format is missing. A
release silently lacking an RPM or Windows installer would be worse than no
release at all. The portable Windows step discovers the executable instead of
assuming a name that may change with Tauri versions.

- [ ] Both platform jobs pass.
- [ ] The draft includes:
  `FourTout-<version>-Fedora-x86_64.rpm`,
  `FourTout-<version>-Linux-amd64.deb`,
  `FourTout-<version>-Linux-x86_64.AppImage`,
  `FourTout-<version>-Windows-x64-Setup.exe`,
  `FourTout-<version>-Windows-x64.msi`,
  `FourTout-<version>-Windows-x64-Portable.zip`, and `SHA256SUMS.txt`.

## 9. Verify published artifacts

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

- [ ] Download and install the published RPM on a clean machine.
- [ ] Download and install the Windows installer on a clean machine.
- [ ] Launch both and open a tool.

## 10. Publish

- [ ] Write release notes covering features, fixes, and known limitations.
- [ ] Mention that Windows installers are unsigned while that remains true.
- [ ] Remove draft status.

## After publishing

- [ ] Check the links in `README.md` from GitHub.
- [ ] Open issues for deferred work.

## If a published release has a problem

Return the release to draft instead of deleting its tag. Existing links then
stop serving the defective binary while history remains readable. Fix the
problem and publish a patch release `X.Y.Z+1`.
