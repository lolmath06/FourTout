# Disks, partitions, and health

[English](STORAGE.md) | [Français](../fr/features/STORAGE.md)

[← Documentation](../README.md)

The `disk-inspect` tool is implemented by `src-tauri/src/disks/`, exposed by
`src/core/disks/native.ts`, and displayed by
`src/tools/impl/diagnostics/DiskInspectTool.tsx`.

## Read-only, without exception

This module **reads**. It never writes and has no code path capable of opening a
block device for writing. FourTout does not partition, format, repair file
systems, run `fsck` or `chkdsk /f`, image or clone disks, wipe devices, issue
TRIM, edit GPT/MBR tables, mount volumes, or write to `/dev/sdX` or
`\\.\PhysicalDriveN`.

There is deliberately no vague “Repair disk,” “Optimize,” or “Fix sectors”
button. A block-device action belongs here only if its precise effect can be
stated—and this module permits no modifying action at all.

The structural test
`nothing_in_the_storage_module_can_open_a_device_for_writing` scans every
module source and fails if writing APIs or commands such as `OpenOptions`,
`File::create`, `fs::write`, `mkfs`, `fsck`, `chkdsk`, `sgdisk`, `parted`,
`mount(`, `umount`, or `dd if=` appear.

## Displayed information

Only values actually reported by the system are shown. Missing fields say “not
reported,” never a dash that could be mistaken for zero.

- **Physical disk:** system name and path, model, manufacturer, capacity,
  SATA/NVMe/USB/card/virtual connection, removable and read-only flags,
  rotational or flash media, serial number when unprivileged access exposes it,
  partition scheme, and whether it hosts the system.
- **Partition:** name, number, size, start offset, GPT type GUID or MBR type,
  unique identifier, and boot flag.
- **Volume:** file system, label, identifier, mount point, capacity, used and
  available space, and read-only mount status.

Mounted volumes not associated with a listed partition—disk images, network
file systems, `tmpfs`, and mapped drives—appear separately rather than being
attached to an arbitrary disk.

## Linux provider — `src-tauri/src/disks/linux.rs`

Everything comes from unprivileged, read-only kernel interfaces, with **no
external command**:

| Information | Source |
| --- | --- |
| Disks, capacity, removable/read-only/rotational flags | `/sys/block/<name>/` |
| Model, manufacturer, serial | `/sys/block/<name>/device/` |
| Connection type | `/sys/block/<name>` symlink target |
| Partitions, size, start | `/sys/block/<name>/<partition>/` |
| Partition type and GUID | `partition_type_uuid`, `partition_uuid` |
| Mounts, file system, `ro` option | `/proc/self/mountinfo` |
| Volume ID and label | `/dev/disk/by-uuid`, `/dev/disk/by-label` links |
| Used and available space | `statvfs` |

The `/sys` logical sector is defined as 512 bytes regardless of physical sector
size. Escaped mount spaces such as `\040` are decoded. Available space uses
`f_bavail`, the amount ordinary users can actually use. `loop`, `ram`, and
`zram` devices are excluded.

Access goes through the `SysSource` trait, allowing parsers to run against
fixed synthetic captures—such as GPT NVMe and read-only MBR USB—instead of the
unknown hardware of the test machine.

## Windows provider — `src-tauri/src/disks/windows.rs`

Two constant PowerShell scripts call `Get-Disk`, `Get-Partition`, `Get-Volume`,
and `Get-StorageReliabilityCounter` with `-NoProfile -NonInteractive`, producing
compact JSON. **No user input is ever interpolated.** Tests enforce the absence
of formatting markers, `Invoke-Expression`, `iex`, and modifying verbs.

A native IOCTL implementation would require handles to physical drives and
administrator privileges for useful data, which this feature intentionally
does not request. The parser handles PowerShell's inconsistent drive letters
(string or numeric code point) and its single-result object instead of array.
Parsing compiles and is tested on every platform; only PowerShell execution and
the public entry point are Windows-gated.

## Health — `src-tauri/src/disks/smart.rs`

Health data is opportunistic and never invented. The UI shows what the device
reported and explicitly marks the rest unavailable.

| Platform | Provider |
| --- | --- |
| Linux | `smartctl --json=c -i -H -A <device>`, only when `smartmontools` is already installed |
| Windows | `Get-PhysicalDisk` and `Get-StorageReliabilityCounter` |

FourTout never starts SMART self-tests, bundles or installs GPL-licensed
`smartmontools`, contacts a manufacturer database, or requests privilege
elevation. A six-second timeout kills a stuck `smartctl`. Device paths must
start with `/dev/`, contain only valid device-node characters, and contain no
`..`; arguments are separated rather than shell-concatenated.

The display does not reduce health to a colored dot. “Reported health: Healthy
· 39 °C · detailed SMART unavailable” distinguishes a healthy report from a
silent device.

## Privacy

Disk serials and file-system identifiers exist only in the current view. They
are not stored in recents, settings, logs, or `CONTRAT.json`. Errors include at
most a base name, never the machine's storage topology.

## Tests

Automated tests separate provider, parser, and normalization and use synthetic
captures for GPT NVMe, MBR USB, SATA and NVMe health attributes, silent disks,
and disks absent from counters. One test inventories the real machine without
assuming a name, capacity, or serial; it checks only structural consistency,
that free space does not exceed capacity, and that a root volume exists.

## What belongs in PROMĒTHEÚS Rescue

Disk imaging and restoration, cloning, partition recovery, GPT/MBR rebuilding,
boot media, rescue environments, destructive file-system repair, raw writes,
and bare-metal backup require a different environment and risk model. They are
intentionally outside FourTout's scope.
