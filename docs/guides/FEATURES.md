# All FourTout tools

[English](FEATURES.md) | [Français](../fr/guides/FEATURES.md)

[← Documentation](../README.md)

196 tools across 12 categories. Every tool in this list is **usable**: FourTout
does not register incomplete tools and has no “coming soon” state.

A tool may appear in several categories. It is implemented once but remains
discoverable wherever users expect it; secondary categories appear at the end
of its entry.

Italic notes document real limitations and also appear on the tool page in the
application.

This list is **generated from the registry** with `pnpm docs:features`, so it
cannot advertise a missing tool or omit a newly registered one.

<!-- OUTILS:DÉBUT -->

## Contents

- [PDF](#pdf-26)
- [Images](#images-25)
- [Audio](#audio-18)
- [Video](#video-20)
- [Text & Documents](#text--documents-20)
- [Files & Archives](#files--archives-29)
- [Converters](#converters-1)
- [Developer](#developer-21)
- [Calculators](#calculators-21)
- [Network](#network-3)
- [Diagnostics & Recovery](#diagnostics--recovery-5)
- [Security & Privacy](#security--privacy-7)

---

### PDF (26)

_Merge, split, compress, convert and secure PDFs._

- **Merge PDFs** — Combine several PDFs into a single document, in the order you choose.
- **Split a PDF** — Cut a PDF into several files by page ranges.
- **Extract pages** — Create a new PDF from a selection of pages.
- **Remove pages** — Permanently remove some pages from a PDF.
- **Reorder pages** — Change the page order with drag and drop.
- **Rotate pages** — Turn all or some pages by 90, 180 or 270 degrees.
- **Compress a PDF** — Reduce a PDF's file size while keeping it easy to read.
- **Images to PDF** — Turn a series of images into a paginated PDF document. · also in *Images* and *Converters*
- **PDF to images** — Export each page of a PDF as PNG or JPEG, at the resolution you want. · also in *Images* and *Converters*
- **Document to PDF** — Convert a text, Markdown or HTML file to PDF. · also in *Text & Documents* and *Converters*
- **Add text** — Write text on a PDF to fill in a form or annotate it.
- **Add an image or signature** — Insert an image, a stamp or a signature exactly where you want.
- **Add a watermark** — Stamp a text watermark on all or some pages.
- **Number pages** — Add customizable page numbers in the header or footer.
- **Password-protect** — Encrypt a PDF so it only opens with a password. · also in *Security & Privacy*
- **Unlock a PDF** — Remove the protection from a PDF whose password you know. · also in *Security & Privacy*
  <br>_FourTout doesn't break protections: you need to know the password. For a forgotten password, see “Recover a PDF password”._
- **PDF metadata** — Read and edit a PDF's title, author, subject and keywords. · also in *Security & Privacy*
- **Extract images from a PDF** — Get back every image embedded in a PDF. · also in *Images*
- **Extract text from a PDF** — Get the selectable text of a PDF, page by page. · also in *Text & Documents* and *Converters*
- **Edit PDF text** — Fix text right on the page: double-click a word and replace it. · also in *Text & Documents*
  <br>_Visual editing by replacement: the original text is covered with the sampled background color, then redrawn. Best for horizontal text on a plain background (documents, invoices, reports). Areas on a non-uniform background or rotated text are flagged and left unchanged._
- **OCR a scanned PDF** — Recognize the text in a scanned PDF, page by page, in French or English. · also in *Text & Documents*
  <br>_Local OCR engine (tesseract.js) bundled with the app: no data is sent over the network. For a single image, see “Extract text from an image”._
- **Compare two PDFs** — Highlight the differences between two versions of a document. · also in *Text & Documents*
- **Redact a PDF** — Permanently hide sensitive areas: content is removed, not just covered. · also in *Security & Privacy*
- **Scanned PDF to searchable PDF** — Recognize the text of a scanned PDF and add it as an invisible layer: Ctrl+F, selection and copy work, and the appearance doesn't change. · also in *Text & Documents*
  <br>_Recognition is entirely local. The original pages are neither rasterized nor recompressed: only an invisible text layer is added. Result quality depends on the quality of the scan._
- **Extract tables from a PDF** — Rebuild rows and columns from the position of the text, then export to CSV or an XLSX workbook. · also in *Text & Documents* and *Converters*
  <br>_A PDF doesn't contain tables, only positioned text: FourTout rebuilds rows and columns from those positions. Complex tables — merged cells, text over several lines — may need corrections before export._
- **Scans and photos to PDF** — Combine scanned or photographed pages into a single PDF, with cleanup and page ordering. · also in *Images*
  <br>_Cleanup applies to every page with the same settings; assembly reuses the “Images to PDF” engine._

### Images (25)

_Convert, compress, resize and clean up images._

- **Convert an image** — Go from one format to another: PNG, JPG, WebP. Also reads GIF, BMP, TIFF and SVG. · also in *Converters*
- **Compress an image** — Reduce an image's file size while controlling quality loss.
- **Resize an image** — Change the dimensions in pixels or percent, with or without keeping the ratio.
- **Crop an image** — Crop an image visually, freely or to a ratio (1:1, 4:3, 16:9, 3:2).
- **Rotate and mirror** — Rotate by quarter turns and mirror, with an instant preview.
- **Flip horizontally or vertically** — Flip an image as if in a mirror.
- **Black and white** — Convert to grayscale, or to pure black and white with an adjustable threshold.
- **Adjust an image** — Tune brightness, contrast, saturation and gamma, with a live preview.
- **Blur or pixelate** — Hide information: blur or mosaic, on the whole image or a drawn area. · also in *Security & Privacy*
- **Remove transparency** — Flatten a transparent PNG or WebP onto a solid background (white, black or a color).
- **Remove background** — Automatically cut out the subject of a photo and make the background transparent. · also in *Security & Privacy*
  <br>_The cutout model is installed once from Settings → Models, then works offline: the image is never sent to a server. It recognizes a sharp, well-separated main subject; it gets things wrong on scenes without an obvious subject and on very fine details._
- **Make a color transparent** — Erase a solid color (such as the background) and replace it with transparency.
- **Extract text from an image (OCR)** — Recognize the text in an image, in French or English, 100% locally. · also in *Text & Documents*
- **Text on an image** — Write text on an image — caption, meme, annotation — and place it by hand.
- **Read image metadata** — Show EXIF, GPS, camera and capture date.
- **Remove image metadata** — Erase EXIF and GPS data before sharing a photo. · also in *Security & Privacy*
- **Batch image conversion** — Apply the same conversion to a whole folder of images. · also in *Converters* and *Files & Archives*
- **Image watermark** — Add a logo or text watermark, one image at a time or in batches.
- **Generate a favicon** — Create a multi-size favicon and the .ico file from an image. · also in *Developer*
- **Generate multiple sizes** — Export every useful icon or thumbnail size in one go. · also in *Developer*
- **Analyze and convert a color** — Dominant colors of an image, pixel-precise eyedropper, HEX / RGB / HSL / HSV notations, and WCAG contrast between text and its background. · also in *Developer*
- **Fix document perspective** — Straighten a photo of a page taken at an angle: place the four corners and FourTout turns it back into a rectangle seen head-on. · also in *Text & Documents*
  <br>_The four corners are placed by hand: it's always exact, where automatic detection gets it wrong. Proportions inferred from the corners are approximate — force A4 or Letter for an exact result._
- **Clean up a scan** — Straighten a slightly tilted document, boost contrast, whiten a gray or yellowed background, convert to grayscale or black and white. · also in *Text & Documents*
  <br>_Each setting is optional and shown in a before/after preview. Whitening never touches dark pixels: fine text keeps its density._
- **Compare two images** — See and measure what changes between two images: side by side, overlaid or as a difference, with differing pixels, PSNR and SSIM.
  <br>_Two images of different sizes are never resized without your consent: resampling would create differences that aren't in the files._
- **Create a contact sheet** — Lay out several images in a grid on a single sheet, with each file's name.

### Audio (18)

_Convert, trim, normalize, transcribe and synthesize sound._

- **Record from the microphone** — Capture sound from the microphone and save it locally.
- **Trim audio** — Keep a precise excerpt of an audio file.
- **Merge audio files** — Put several tracks end to end in a single file.
- **Convert audio** — Go from one format to another: MP3, WAV, FLAC, OGG, M4A, OPUS. · also in *Converters*
- **Compress audio** — Reduce an audio file's size by adjusting the bitrate.
- **Change volume** — Raise or lower the overall volume of an audio file.
- **Normalize audio** — Even out the loudness of several files.
- **Change speed** — Speed up or slow down audio, with or without pitch correction.
- **Remove silence** — Automatically detect and cut the gaps in a recording.
- **Extract audio from a video** — Get a video's soundtrack in the format of your choice. · also in *Video* and *Converters*
- **Audio transcription** — Turn speech in an audio or video file into text, locally. · also in *Text & Documents* and *Video*
  <br>_Speech recognition model running on your machine, installed on demand._
- **Generate SRT subtitles** — Create a timestamped subtitle file from audio or video. · also in *Video* and *Text & Documents*
- **Text to speech** — Read text aloud and save it as an audio file, without any online service. · also in *Text & Documents*
- **PDF to audio** — Turn a PDF into an audiobook using local speech synthesis. · also in *PDF* and *Converters*
- **Text file to audio** — Convert a TXT or Markdown file into a narrated audio file. · also in *Text & Documents* and *Converters*
- **Convert audio channels** — Switch a file to mono or stereo, or leave it as is. A multichannel file is never downmixed unless you ask.
  <br>_From mono to stereo, the channel is duplicated: both sides carry the same signal. No spatialization is invented._
- **Edit audio tags** — Read and fix title, artist, album, year, genre, track and comment — without re-encoding the sound.
  <br>_Writing copies the audio stream as is (-c copy): the resulting sound is bit-for-bit identical._
- **Inspect a media file** — Everything an audio or video file declares: container, codecs, resolution, frame rate, bitrates, channels, tags. · also in *Video* and *Files & Archives*

### Video (20)

_Convert, compress, trim and subtitle videos._

- **Convert a video** — Go from one format to another: MP4, MKV, WebM, MOV. · also in *Converters*
  <br>_Only codecs actually available in the installed engine are offered._
- **Compress a video** — Drastically reduce a video's file size by choosing the target quality.
- **Change resolution** — Convert a video to 1080p, 720p, 480p or a custom size.
- **Trim a video** — Keep just an excerpt, without re-encoding whenever possible.
- **Merge videos** — Join several videos end to end into a single file.
- **Crop a video** — Visually select the area to keep, with fixed proportions. · also in *Images*
- **Video to GIF** — Turn a video clip into an optimized animated GIF. · also in *Images* and *Converters*
- **GIF to video** — Convert an animated GIF to MP4 or WebM, which is much lighter. · also in *Images* and *Converters*
- **Extract a frame from a video** — Capture a specific frame or take snapshots at regular intervals. · also in *Images* and *Converters*
- **Change video speed** — Create a time-lapse or slow motion, audio included.
- **Rotate a video** — Fix a video filmed the wrong way round, or mirror it.
- **Remove sound from a video** — Create a silent version of the video, without re-encoding the picture.
- **Replace the audio track** — Replace a video's soundtrack, or add an extra track to it. · also in *Audio*
  <br>_Drop the video and the audio file together._
- **Change video volume** — Turn a video's sound up or down without touching the picture. · also in *Audio*
- **Add a subtitle track** — Attach an SRT or VTT file to the video, which can be turned on in the player. · also in *Text & Documents*
  <br>_Drop the video and the subtitle file together._
- **Burn in subtitles** — Burn subtitles into the picture so they show in every player. · also in *Text & Documents*
  <br>_Drop the video and the subtitle file together._
- **Extract subtitles from a video** — Export existing subtitle tracks as SRT or VTT. · also in *Text & Documents*
  <br>_Only text tracks can be exported; image-based tracks (PGS, DVD) are pictures._
- **Generate subtitles for a video** — Automatically transcribe a video's speech, then export or burn in the subtitles. · also in *Audio* and *Text & Documents*
  <br>_Uses the local transcription model already installed (nothing is sent over the network)._
- **Batch video processing** — Convert, compress, resize, rotate or extract the audio of several videos. · also in *Files & Archives*
- **Change frame rate** — Convert a video to 24, 25, 30 or 60 fps or a custom rate, by duplicating and dropping frames.
  <br>_No in-between frames are computed: frames are duplicated or dropped. The output has a constant frame rate._

### Text & Documents (20)

_Analyze, clean up, compare and transform text._

- **Word and character counter** — Words, characters, sentences, paragraphs and estimated reading time.
- **Change case** — UPPERCASE, lowercase, Title Case, camelCase, snake_case, kebab-case.
- **Clean up text** — Remove extra spaces, blank lines, tabs and invisible characters.
- **Find and replace** — Replace text in bulk, with or without a regular expression.
- **Compare two texts** — See line by line what was added, removed or changed. · also in *Developer*
- **Remove duplicates** — Keep only one occurrence of each line, optionally ignoring case.
- **Sort lines** — Sort lines alphabetically, numerically or randomly.
- **Markdown ↔ HTML / text** — Convert Markdown to HTML or plain text, and back. · also in *Converters* and *Developer*
- **Extract URLs** — Get every web address contained in a text.
- **Extract email addresses** — Pull out every email address in a text.
- **Extract numbers** — Pull every number out of a text and add them up.
- **Lorem Ipsum** — Generate dummy text: words, sentences or paragraphs. · also in *Developer*
- **Normalize Unicode** — Make accents consistent across systems (NFC, NFD, NFKC, NFKD). · also in *Developer*
- **Convert line endings** — Switch from CRLF (Windows) to LF (Unix) and back, with detection first. · also in *Files & Archives* and *Developer*
- **Word (DOCX) to text, Markdown or HTML** — Extract the content of a Word document: headings, paragraphs, lists and tables. · also in *Converters*
  <br>_Complex layout (columns, images, styles) isn't reproduced: FourTout extracts the content and its structure._
- **Word (DOCX) to PDF** — Convert a Word document to PDF: headings, paragraphs, lists and simple tables. · also in *PDF* and *Converters*
  <br>_FourTout keeps the content and its structure — headings, paragraphs, bold, italics, lists, simple tables — but not the Word layout: columns, floating boxes, headers and footers, specific fonts and images may differ or be missing. For a pixel-perfect result, export to PDF from Word or LibreOffice._
- **Compare two documents** — Compare the content of two documents — PDF, Word, text, Markdown or HTML — even in different formats, line by line and word by word. · also in *PDF* and *Files & Archives*
  <br>_The comparison is about the text, not the layout: it tells you what changed in the content, even across two different formats. A scanned PDF must first go through “Scanned PDF to searchable PDF”._
- **Detect a text file's encoding** — Identify a file's encoding, byte order mark and line-ending convention, with the actual level of certainty. · also in *Developer* and *Files & Archives*
  <br>_Apart from a byte order mark, no file declares its encoding: detection remains an educated guess, and FourTout shows its real certainty rather than a misleading verdict._
- **Convert a text file's encoding** — Switch from one encoding to another — UTF-8, UTF-8 with BOM, UTF-16 LE/BE, Windows-1252, Latin-1 — without silently losing a character. · also in *Developer* and *Files & Archives*
  <br>_If the target encoding can't represent some characters, the conversion is refused and those characters are listed. Replacement only happens if you explicitly ask for it._
- **Edit subtitles** — Convert between SRT and WebVTT, shift timestamps, merge two files, check and repair. · also in *Video* and *Converters*
  <br>_Whatever is mechanically safe is fixed (order, numbering, line endings); overlaps are flagged but never shortened automatically._

### Files & Archives (29)

_Compress, extract, compare, rename and organize files._

- **Create an archive** — Compress files or folders into ZIP, 7z, TAR, TAR.GZ or TAR.XZ, keeping the folder structure.
  <br>_The 7z created here isn't encrypted: for a password-protected archive, use “Password-protected archive”, whose AES-256 ZIP opens with 7-Zip, WinRAR, Keka and Windows Explorer._
- **Extract an archive** — Decompress a ZIP, 7z, TAR, TAR.GZ or TAR.XZ archive into the folder of your choice.
  <br>_No file is ever written outside the chosen folder: entries whose path climbs up (“../”), absolute paths and symbolic links are refused and listed. RAR isn't supported._
- **Password-protected archive** — Create or open a password-encrypted archive. · also in *Security & Privacy*
  <br>_WinZip AES-256 encryption: the archive opens with 7-Zip, WinRAR, PeaZip, Keka and Windows Explorer. The legacy “ZipCrypto”, crackable in seconds, is never used. File names, however, stay readable without the password — a limitation of the ZIP format._
- **Compute a hash** — Get the SHA-256, SHA-512, SHA-1 or MD5 of one or more files, whatever their size. · also in *Security & Privacy* and *Developer*
- **Verify a hash** — Compare a file's hash with the one published by its source. · also in *Security & Privacy*
- **Find duplicate files** — Detect duplicates in a folder by content, not by name.
- **Compare two files** — Check whether two files are identical, byte by byte or line by line.
- **Bulk rename** — Rename hundreds of files with a pattern, numbering or a regex.
- **Clean up file names** — Remove accents, spaces and problematic characters from file names.
- **Organize a folder** — Automatically sort files by extension, date or type.
- **Analyze folder space** — See what's really taking up space: biggest files, biggest subfolders, breakdown by type.
  <br>_Only file system metadata is read: file contents are never opened. Unreadable folders are flagged rather than counted as zero, and symbolic links aren't followed (their target would be counted twice)._
- **Secure delete** — Overwrite a file's contents before deleting it, making software recovery very unlikely. · also in *Security & Privacy*
  <br>_Hardened software erasure, not physical destruction: on an SSD, memory card, Btrfs/ZFS/APFS, or when snapshots and backups exist, no software can guarantee every earlier copy is gone._
- **Split a large file** — Cut a large file into numbered pieces, with a verification manifest.
- **Reassemble a file** — Rebuild a file from its .part001 pieces, with hash verification.
- **Generate a folder tree** — Produce a text tree of a folder, ready to paste into a README. · also in *Developer*
- **Inspect a file** — Real type detected from its signature, extension consistency, encoding, dates, hashes and first bytes. · also in *Security & Privacy*
  <br>_The type shown comes from the first bytes, not the extension: a “.jpg” that contains a PNG is reported as such. Nothing is renamed automatically — fixing it stays an action you ask for._
- **Compare two folders** — See what's identical, changed, or present on only one side between two folder trees.
  <br>_Quick mode compares type and size without reading anything: two files of the same size are called “probably identical”. Only reliable mode confirms equality by content — and it only reads files of the same size, since a different size is enough to conclude._
- **Sync folders** — Update a destination from a source, with a detailed plan before anything is written.
  <br>_One-way sync: the source is the reference and the destination follows it. Nothing is written until you've read the plan. Mirror mode deletes from the destination whatever no longer exists in the source, and asks for a separate confirmation._
- **Search in files** — Find files by name, type, size or date — or by the text they contain. · also in *Text & Documents*
  <br>_On-demand search: FourTout doesn't index anything in the background and keeps nothing between searches. Content search only opens what genuinely looks like text — a binary is never interpreted as text._
- **Preview a file** — Open any file without its app: text, image, PDF, audio, video, archive or raw bytes.
  <br>_The preview is chosen from the actual content, not the extension. Large text files are only partly loaded, and the preview says so._
- **Hex editor** — Read and fix a file's bytes, window by window, without ever loading it whole. · also in *Developer*
  <br>_A deliberately limited editor: no binary templates, no scripting, no inserting or deleting bytes — only in-place fixes that never change the file size. By default, the result is saved to a new file._
- **Back up a folder** — Copy a folder with a hash manifest, so you can verify and restore it later. · also in *Security & Privacy*
  <br>_Transparent format: a “donnees” folder that mirrors your folder structure, and a readable “manifeste.json”. No proprietary container — your files stay accessible even without FourTout. This isn't a versioned backup: each backup is a full, dated copy._
- **Restore a backup** — Verify a FourTout backup, then put it back without overwriting anything you didn't choose. · also in *Security & Privacy*
  <br>_Integrity is checked before anything is written: a damaged file in the backup is named, not silently restored. Restoring never deletes anything in the destination._
- **Create a checksum manifest** — Produce a .sha256 file listing the hash of every file in a folder. · also in *Security & Privacy* and *Developer*
  <br>_The text format produced is sha256sum's: it can be checked with system tools on any machine. MD5 and SHA-1 are still offered to verify old hashes, but are flagged as unsuitable for security use._
- **Verify a checksum manifest** — Compare a folder with a checksum file: intact, modified, missing or unreadable, file by file. · also in *Security & Privacy*
  <br>_A manifest is data, not an instruction: an entry that would climb out of the verified folder (“../”, absolute path) is refused and listed, never followed._
- **Compress a file (GZ, XZ)** — Shrink a single file into .gz or .xz — without making it an archive. · also in *Converters*
  <br>_“.gz” and “.xz” hold a single file, with no folder name or structure. To compress several files and keep their organization, use “Create an archive” with its TAR.GZ or TAR.XZ format._
- **Decompress a file (GZ, XZ)** — Get back the original file from a .gz or .xz. · also in *Converters*
  <br>_A “.tar.gz” contains a folder tree: use “Extract an archive” instead, which will restore it. Here, a .tar.gz would simply give back the .tar._
- **Inspect an archive** — List an archive's contents without extracting it: paths, sizes, compression ratios, suspicious entries.
  <br>_Nothing is decompressed: only the archive's table of contents is read. Entries whose path would escape the extraction folder are flagged before you even consider extracting._
- **Test an archive** — Check that an archive is intact by fully decompressing it, without writing anything to disk. · also in *Security & Privacy*
  <br>_The content is actually decompressed and its checksums verified — listing an archive would prove nothing, since only its header would be read. Nothing is written: the bytes are counted, then discarded._

### Converters (1)

_Go from one format to another, whatever the file type._

- **Universal converter** — Drop a file and FourTout suggests the possible conversions to compatible formats.
  <br>_Suggested conversions are derived from the inputs and outputs declared by the tools in the registry: no separate table to maintain, and never a conversion offered without a tool behind it._

### Developer (21)

_Format, encode, generate and inspect technical formats._

- **JSON — format and validate** — Indent, minify and validate JSON, with a precise error message.
- **XML — format** — Indent and validate an XML document.
- **YAML — format and convert** — Format YAML and convert it to or from JSON. · also in *Converters*
- **SQL — format** — Make a compact or generated SQL query readable.
- **Base64 — encode and decode** — Convert text to Base64 and back, including base64url.
- **URL — encode and decode** — Encode or decode a URL and its parameters (percent-encoding). · also in *Text & Documents*
- **JWT — decode** — Read a JWT's header and payload, without sending it anywhere. · also in *Security & Privacy*
  <br>_The token is decoded locally: it never leaves your machine._
- **Generate UUIDs** — Create unique v4 or v7 identifiers, one at a time or in batches.
- **Regular expression tester** — Test a regex live and see the matches and groups.
- **Unix timestamp** — Convert a timestamp to a readable date and back, with time zones. · also in *Calculators*
- **Hash a text** — Compute the MD5, SHA-1, SHA-256 or SHA-512 of a string. · also in *Security & Privacy*
- **Generate a QR code** — Create a QR code for a URL, text, contact or Wi-Fi network. · also in *Images*
- **Read a QR code** — Decode a QR code from an image or screenshot. · also in *Images*
- **Convert hex, decimal, binary** — Switch between bases: binary, octal, decimal, hexadecimal. · also in *Calculators* and *Converters*
- **Code diff** — Compare two blocks of code with additions and deletions highlighted.
- **Minify HTML, CSS, JS** — Reduce code size by removing whitespace and comments.
- **Format HTML, CSS, JS** — Re-indent minified or badly formatted code to make it readable.
- **Cron helper** — Build a cron expression and explain it in plain language.
- **TOML — format and validate** — Check a TOML file and rewrite it in a canonical form.
  <br>_Reformatting rebuilds the document from its data: comments and the original ordering are lost. Validation, on the other hand, changes nothing._
- **Base32 — encode and decode** — Convert text to Base32 and back, per RFC 4648.
- **SQLite database — explore** — Open a SQLite database read-only: schema, data, queries, CSV export. · also in *Files & Archives*
  <br>_Strictly read-only explorer: the database is opened read-only and no query can modify it._

### Calculators (21)

_Units, percentages, dates, durations and everyday math._

- **Converter — length** — Meters, kilometers, miles, feet, inches, nautical miles. · also in *Converters*
- **Converter — weight and mass** — Grams, kilograms, tonnes, pounds, ounces. · also in *Converters*
- **Converter — temperature** — Celsius, Fahrenheit, Kelvin. · also in *Converters*
- **Converter — volume** — Liters, milliliters, gallons, pints, cups, spoons. · also in *Converters*
- **Converter — area** — Square meters, hectares, acres, square feet. · also in *Converters*
- **Converter — speed** — km/h, m/s, mph, knots. · also in *Converters*
- **Converter — pressure** — Pascals, bar, PSI, atmospheres, mmHg. · also in *Converters*
- **Converter — energy** — Joules, calories, kWh, BTU. · also in *Converters*
- **Converter — power** — Watts, kilowatts, horsepower. · also in *Converters*
- **Converter — digital storage** — Bytes, KB, MB, GB, TB, and their binary equivalents (KiB, MiB). · also in *Converters*
- **Percentage calculations** — Percentage of a number, change, discount, VAT, share of a total.
- **Rule of three** — Solve a proportion: if A is B, what is C?
- **Date calculations** — Number of days between two dates; add or subtract a duration.
- **Duration calculations** — Add and subtract hours, minutes and seconds.
- **Calculate an age** — Exact age in years, months and days from a date of birth.
- **Scientific calculator** — Advanced operations: powers, roots, trigonometry, logarithms.
- **Currency converter** — Convert amounts between currencies with recent rates. · also in *Converters*
  <br>_The only FourTout tool that needs the Internet, solely to fetch today's rates. The last known rates are reused offline._
- **Convert between time zones** — Convert one local time to another, daylight saving time included.
  <br>_Offsets come from the system's time zone database, for the requested date: clock changes are respected, and ambiguous or nonexistent times are flagged._
- **Calculate bandwidth** — Work out an average rate from an amount of data and a duration.
- **Calculate transfer time** — Estimate how long a transfer takes from a size and a rate.
  <br>_Theoretical calculation: size ÷ rate. It ignores protocol overhead, latency and congestion — a real transfer always takes longer._
- **Calculate interest** — Simple or compound interest, with optional regular deposits.
  <br>_A math tool, not financial advice: taxes, inflation and fees aren't taken into account._

### Network (3)

_Diagnose a connection, test ports, see what's plugged into your home network._

- **Ping** — Check whether a host responds, and how fast.
  <br>_Sends real ICMP packets, four by default. If the system refuses ICMP sockets, the tool says so rather than measuring something else._
- **Test ports** — See which TCP ports on a host accept a connection.
  <br>_One host, at most 256 ports per run, using ordinary TCP connections. This isn't a scanner: no stealth, no service detection, no vulnerability search._
- **Discover local network devices** — List the machines that show up on your subnet.
  <br>_Limited to the directly connected subnet and to 256 addresses. The exact range is shown before anything is sent, and nothing goes out without confirmation._

### Diagnostics & Recovery (5)

_Understand what's broken in a damaged file, and rescue what can be saved._

- **Diagnose a file** — Understand what a file really is, and what it's missing. · also in *Files & Archives*
  <br>_The original file is never modified. FourTout analyzes the internal structure of ZIP, PDF, PNG and JPEG files, and says so plainly for other formats._
- **Damaged ZIP archive** — Diagnose an unreadable archive and recover what it still contains. · also in *Files & Archives*
  <br>_Recovers by scanning local headers, even without a central directory. Entries whose data is truncated are reported as lost — they're never reconstructed. The original archive isn't touched._
- **Damaged PDF** — Diagnose an unreadable PDF and repair it when the fix can be proven. · also in *PDF*
  <br>_Every file produced is reopened by the PDF engine and its pages counted: if the engine rejects it, the repair is reported as failed and the file deleted. Rewriting invalidates any digital signature._
- **Damaged image** — Diagnose a damaged PNG or JPEG and save the readable pixels. · also in *Images*
  <br>_A wrong checksum is never recomputed, and the missing rows of a truncated image are never invented. Visual recovery re-encodes the decoded pixels: it saves the picture, not the file._
- **Inspect disks and partitions** — See the system's disks, partitions, volumes and health indicators. · also in *Files & Archives*
  <br>_Read-only, no exceptions: FourTout can't partition, format, mount, clone or erase a disk. Detailed health indicators depend on `smartctl`, which FourTout doesn't bundle._

### Security & Privacy (7)

_Passwords, encryption, hashes and data erasure._

- **Recover a PDF password** — Try likely passwords to reopen a PDF whose password you've forgotten. · also in *PDF*
  <br>_Local recovery using a dictionary and rules, on a document you're authorized to open. It isn't an exhaustive search: a password that isn't in the word list won't be found._
- **Compute an HMAC** — Sign a text or file with a secret key, using HMAC-SHA-256 or SHA-512. · also in *Developer* and *Files & Archives*
  <br>_The key is never saved, logged or added to recents: it's used for the calculation, then discarded. It's cleared from the screen as soon as you leave the tool._
- **Generate a password** — Create strong passwords or memorable passphrases. · also in *Developer*
- **Test password strength** — Estimate how long it would take to crack a password, offline.
  <br>_The analysis is entirely local: the password you type is never transmitted._
- **Encrypt files** — Protect files with a password using modern encryption.
- **Decrypt files** — Get back the content of a file encrypted with FourTout.
- **Remove a file's metadata** — Clean out author, dates, device and location before sharing a document. · also in *Files & Archives*

<!-- OUTILS:FIN -->

## A note about network access

Only one listed tool requires the **Internet**: **Currency converter**, which
retrieves European Central Bank reference rates.

Three others open real connections, but **only on your network**: **Ping**,
**Check ports**, and **Discover local network devices**. They contact no remote
service and probe only an explicit host or the directly connected subnet,
bounded to 256 addresses. See
[NETWORK.md](../features/NETWORK.md).

Every other tool works offline.

Model-backed tools—**Text to speech**, **Audio transcription**, **Generate
subtitles**, **PDF to audio**, and **Remove background**—download their model
once on request and then work offline. See
[MODELS.md](../technical/MODELS.md).
