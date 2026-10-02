# Calculators

[English](CALCULATORS.md) | [Français](../fr/features/CALCULATORS.md)

[← Documentation](../README.md)

The category contains ten unit converters, eight focused calculators, a
scientific calculator, a time-zone converter, and a currency converter. Core
code lives under `src/core/units/`, `src/core/calc/`, and
`src/core/currency/`; interfaces are under `src/tools/impl/calculators/`.

## Unit engine — `src/core/units/index.ts`

One engine powers all ten converters. Each dimension declares exact factors to
a reference unit, and the catalog generates tools from shared descriptors.

| Unit | Exact definition |
| --- | --- |
| inch | 25.4 mm |
| foot | 0.3048 m |
| mile | 1.609344 km |
| nautical mile | 1,852 m |
| avoirdupois pound | 0.45359237 kg |
| ounce | 28.349523125 g |
| US gallon | 3.785411784 L |
| imperial gallon | 4.54609 L |
| acre | 4,046.8564224 m² |
| bar / atmosphere | 100,000 Pa / 101,325 Pa |
| kWh | 3.6 MJ |

Temperature supports offsets as well as factors. US and imperial gallons,
mechanical horsepower (745.7 W) and metric horsepower (735.5 W), and decimal
KB/MB/GB versus binary KiB/MiB/GiB remain distinct and clearly named.

Tests guarantee exact round trips, identity conversions, errors for unknown
units, and clean display formatting. Inputs accept decimal commas and grouped
spaces. Each tool also displays the input converted to every unit in its
dimension.

## Scientific calculator — `src/core/calc/expression.ts`

The calculator never uses `eval` or `new Function`. A dedicated lexer and
recursive-descent parser enforce operator precedence, right-associative powers,
and correct unary signs. JavaScript-shaped input such as `globalThis` or
`1;alert(1)` is syntax, not executable code, and is rejected.

It supports degrees or radians, logarithms, roots, absolute value, bounded
factorial, and typed symbols such as `×`, `÷`, `−`, `√`, and `π`. Errors include
the failing position when possible and never return a misleading `NaN`.

## Dates, durations, and age — `src/core/calc/datetime.ts`

Calendar arithmetic does not treat a month as 30 days. Adding a month or year
clamps to the target month's final day, so January 31 + one month becomes
February 28 or 29. Input dates use local time, and day differences remain
correct across daylight-saving transitions.

Age is returned in exact years, months, and days plus total days. A February 29
birthday falls on March 1 in non-leap years. Duration input accepts `1h30`,
`90min`, `01:30:00`, and `1:30`; totals may exceed 24 hours.

## Percentages and proportions — `src/core/calc/arithmetic.ts`

The tools cover percentage of a value, change, discount, VAT, share of a total,
and the rule of three. Every result shows its formula. Negative starting values
keep their sign semantics, and division by zero is rejected rather than shown
as infinity.

## Time zones — `src/core/calc/timezone.ts`

A time zone is not a fixed UTC offset. The engine queries the system IANA data
through `Intl.DateTimeFormat` for the requested date. During a spring gap, an
impossible local time is reported with the nearest real instant. During a fall
overlap, both valid instants and offsets are displayed for selection.

The UI shows source and destination time, offsets, local abbreviations, and the
UTC instant. Zone search ignores case and accents. Results depend on the host's
IANA database; FourTout does not bundle a separate copy.

## Bandwidth and transfer time — `src/core/calc/bandwidth.ts`

The tools explicitly distinguish bits from bytes and decimal SI prefixes from
binary IEC prefixes. `Mbit/s` and `MB/s` are never conflated; ×1000 and ×1024
results appear side by side. Calculations use double-precision bits, whose exact
integer range comfortably covers the intended file sizes.

Transfer time is strictly size ÷ throughput. It excludes TCP/TLS/HTTP overhead,
latency, congestion, and disk speed, so real transfers are usually 5–20%
longer; that caveat appears with every result. Zero or negative inputs are
rejected.

## Interest — `src/core/calc/interest.ts`

Simple interest uses `A = P(1 + r·t)`; compound interest uses
`A = P(1 + r/n)^(n·t)` with yearly through daily (exact/365) compounding.
Rounding happens only for display, never at each period. Regular end-of-period
contributions use the annuity future-value formula, with a separate zero-rate
case to avoid division by zero.

An annual table makes results auditable and is capped at 100 displayed rows,
without limiting the calculation itself. This is a mathematical tool, not
financial advice: it excludes tax, inflation, fees, and changing rates.

## Currency converter — `src/core/currency/`, `src-tauri/src/rates.rs`

This is FourTout's only tool requiring Internet access and is marked accordingly.
Rust fetches the European Central Bank's daily reference feed so the WebView CSP
can keep `connect-src 'self'`. The request is a parameter-free GET: amounts,
selected currencies, and history stay local.

| Situation | Behavior |
| --- | --- |
| Online | Uses the current feed and displays its publication date. |
| Offline with cache | Uses the last known feed and displays its date. |
| Offline without cache | Shows an explicit error and no number. |
| Missing currency | Returns an error, never an estimate. |

The minimal parser does not resolve DTDs, entities, or external resources;
malformed rates are ignored. Cache freshness is six hours because the ECB
normally publishes once per business day. An integration test checks the real
feed and skips cleanly when the machine is offline.
