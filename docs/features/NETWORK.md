# Network tools

[English](NETWORK.md) | [Français](../fr/features/NETWORK.md)

[← Documentation](../README.md)

Three tools—`network-ping`, `network-ports`, and `network-lan`—use native code
under `src-tauri/src/network/`, the client in `src/core/network/native.ts`, and
interfaces under `src/tools/impl/network/`. Along with currency conversion,
they are the only non-`local` tools. They open real connections only after an
explicit action and never send data to a remote service.

## Deliberately narrow scope

Hard code limits keep ordinary diagnostics from becoming offensive discovery:

| Limit | Value |
| --- | --- |
| Packets per ping | 20 |
| Ports per run | 256 |
| Discovery addresses | 256 |
| Widest automatic prefix | `/24` |
| Concurrent connections | 16 |
| Timeout | 100 ms to 10 s |

Tests enforce every limit. A `1-65535` request is rejected with guidance; a
`/16` interface is narrowed to the `/24` around the local address. Discovery
shows its range, interface, and target count and waits for a click; no screen
probes on load.

## Ping — `src-tauri/src/network/ping.rs`

FourTout builds ICMP echo packets rather than parsing localized `ping` command
output. Linux and macOS use an unprivileged ICMP `SOCK_DGRAM` socket when the
system permits it; Windows uses `IcmpSendEcho` / `Icmp6SendEcho2`. Datagram
ICMP can rewrite packet IDs, so replies are matched by sequence number.

If ICMP is unavailable, the tool says so and stops. It never substitutes a TCP
connection because “responds to ping” and “port 80 is open” are different
measurements. Likewise, 100% loss does not prove a host is absent; firewalls
often ignore echo requests, and the UI explains that.

## Port checks — `src-tauri/src/network/ports.rs`

Each check opens and immediately closes an ordinary TCP connection. It sends no
payload and reads no banner.

| State | Exact meaning |
| --- | --- |
| `OPEN` | A connection succeeded; something is listening. |
| `CLOSED` | The host refused the connection; nothing is listening. |
| `NO RESPONSE` | The timeout expired; the port may be filtered or the host unreachable. |

The displayed name is a “commonly associated service,” never a detected
service. Any software can listen on any port. Workers check cancellation before
opening each connection, so stopping prevents further probes.

## Local network discovery — `src-tauri/src/network/lan.rs`

Discovery combines, from least to most active:

1. the existing neighbor table (`/proc/net/arp` or `GetIpNetTable`), excluding
   incomplete entries;
2. one short-timeout ICMP echo per address;
3. reverse name lookup when the system can provide one.

Results are called **observed devices**, not “all devices.” Silent devices can
remain invisible. FourTout does not infer manufacturers because that would
require an online OUI database, and none is bundled. The `LanProbe` trait lets
tests exercise limits, source merging, progress, and cancellation without
sending packets on the developer's network.

## Bounded ranges — `src-tauri/src/network/cidr.rs`

`bounded_range(address, prefix)` is the sole authority and never returns more
than 256 addresses. `/16` and `/8` are narrowed to the surrounding `/24`;
`/30`, `/31` (RFC 3021), and `/32` keep their valid host semantics. Tests cover
all 33 prefix lengths. The native command recomputes the range from interface
name, address, and mask, so WebView input never controls probe extent.

## Responsive UI

Long synchronous Tauri commands would block GTK's IPC/event thread. Therefore
`network_lan_discover`, `network_ping`, and `network_check_ports` are async and
delegate blocking work with `spawn_blocking`. Immediate commands such as
cancel, parsing, interface listing, and planning remain synchronous. Progress
events reach React and **Stop** is handled immediately.

Reverse `getnameinfo` has no native timeout, so it runs on a dedicated thread
with a 1.5-second limit. Late lookups yield an unnamed device rather than
blocking discovery. Resolution also happens outside the shared result lock,
allowing all 16 workers to proceed concurrently.

## Data retention and portability

Observed addresses, names, hardware addresses, and probe history are never
stored. Recents may remember that a network tool was opened, not network
topology. No user input reaches a command interpreter; all probes use sockets.

| Capability | Linux | Windows |
| --- | --- | --- |
| IPv4 interfaces | `if-addrs` / `getifaddrs` | `if-addrs` / `GetAdaptersAddresses` |
| ICMP echo | ICMP `SOCK_DGRAM` | `IcmpSendEcho` |
| Neighbor table | `/proc/net/arp` | `GetIpNetTable` |
| TCP | `std::net::TcpStream` | Same |
| Name lookup | `getaddrinfo` / `getnameinfo` | Same |

No interface name or address range is assumed, and `ip` commands are not run.
Ping accepts explicit IPv6 literals; automatic discovery remains IPv4 because
IPv6 neighbor discovery is multicast-based and cannot be enumerated like IPv4.

## Explicit exclusions

These tools do not perform stealth/SYN scans, fragmentation, evasion, banner or
OS fingerprinting, vulnerability discovery, brute force, Internet-wide scans,
WHOIS/DNS enumeration, ARP spoofing, or packet capture. Those are offensive
reconnaissance techniques and intentionally outside a desktop utility's scope.
