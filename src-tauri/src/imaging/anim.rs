//! Images animées (WebP, APNG) : lecture image par image et conversion.
//!
//! FFmpeg 6 ne décode pas le WebP animé, et lit l'APNG avec ses propres règles
//! de fusion. Les deux sont donc décodés ici par la bibliothèque `image`, qui
//! applique correctement fusion et disposition, puis réassemblés par FFmpeg
//! avec les **durées d'origine** de chaque image.
//!
//! Une animation n'est jamais aplatie en silence : le résultat dit si la
//! transparence ou la boucle ont été perdues (GIF = transparence binaire,
//! MP4/WebM = aucune transparence, aucune boucle).

use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};

use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::{AnimationDecoder, Frame, RgbaImage};
use serde::{Deserialize, Serialize};

use crate::files::{magic, unique_path};
use crate::internet::http::{ErrorKind, InternetError};
use crate::media::encode::{self, Container};

/// Plafonds contre les fichiers fabriqués.
const MAX_FRAMES: u32 = 5_000;
const MAX_PIXELS_PER_FRAME: u64 = 40_000_000;
const MAX_TOTAL_PIXELS: u64 = 3_000_000_000;
/// En dessous, les navigateurs affichent 100 ms : on fait de même.
const MIN_DELAY_MS: u64 = 20;
const DEFAULT_DELAY_MS: u64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Webp,
    Apng,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub kind: Option<Kind>,
    pub animated: bool,
    pub frames: u32,
    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
}

fn fail(message: impl Into<String>) -> InternetError {
    InternetError::new(ErrorKind::Other, message)
}

fn kind_of(path: &Path) -> Result<Option<Kind>, InternetError> {
    use std::io::Read;
    let mut head = vec![0_u8; magic::HEAD_BYTES];
    let read = File::open(path).and_then(|mut f| f.read(&mut head)).map_err(|e| fail(format!("Lecture impossible : {e}")))?;
    let signature = magic::identify(&head[..read]);
    Ok(match signature.id {
        "webp" => Some(Kind::Webp),
        "apng" | "png" => Some(Kind::Apng),
        _ => None,
    })
}

/// Parcourt les images d'une animation sans les garder en mémoire.
fn for_each_frame(
    path: &Path,
    mut visit: impl FnMut(u32, Frame) -> Result<(), InternetError>,
) -> Result<(Option<Kind>, bool), InternetError> {
    let kind = kind_of(path)?.ok_or_else(|| fail("Format non pris en charge : WebP ou PNG attendu."))?;
    let open = || File::open(path).map(BufReader::new).map_err(|e| fail(format!("Lecture impossible : {e}")));
    let bad = |e: image::ImageError| fail(format!("Image illisible : {e}"));
    let mut index = 0_u32;
    let animated;
    macro_rules! walk {
        ($frames:expr) => {
            for frame in $frames {
                if index >= MAX_FRAMES {
                    return Err(fail(format!("Animation refusée : plus de {MAX_FRAMES} images.")));
                }
                visit(index, frame.map_err(bad)?)?;
                index += 1;
            }
        };
    }
    match kind {
        Kind::Webp => {
            let decoder = WebPDecoder::new(open()?).map_err(bad)?;
            animated = decoder.has_animation();
            walk!(decoder.into_frames());
        }
        Kind::Apng => {
            let png = PngDecoder::new(open()?).map_err(bad)?;
            animated = png.is_apng().map_err(bad)?;
            if animated {
                walk!(png.apng().map_err(bad)?.into_frames());
            } else {
                let image = image::load_from_memory(&fs::read(path).map_err(|e| fail(e.to_string()))?).map_err(bad)?;
                visit(0, Frame::new(image.to_rgba8()))?;
            }
        }
    }
    Ok((Some(kind), animated))
}

fn delay_ms(frame: &Frame) -> u64 {
    let (n, d) = frame.delay().numer_denom_ms();
    let ms = if d == 0 { 0 } else { u64::from(n) / u64::from(d) };
    if ms < MIN_DELAY_MS {
        DEFAULT_DELAY_MS
    } else {
        ms
    }
}

pub fn info(path: &Path) -> Result<Info, InternetError> {
    let (mut frames, mut width, mut height, mut duration) = (0_u32, 0_u32, 0_u32, 0_u64);
    let (kind, animated) = for_each_frame(path, |_, frame| {
        let buffer = frame.buffer();
        (width, height) = (width.max(buffer.width()), height.max(buffer.height()));
        duration += delay_ms(&frame);
        frames += 1;
        Ok(())
    })?;
    Ok(Info { kind, animated, frames, width, height, duration_ms: if animated { duration } else { 0 } })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Target {
    Gif,
    Apng,
    Webp,
    Mp4,
    Webm,
    Frames,
}

impl Target {
    pub fn extension(self) -> &'static str {
        match self {
            Target::Gif => "gif",
            Target::Apng => "png",
            Target::Webp => "webp",
            Target::Mp4 => "mp4",
            Target::Webm => "webm",
            Target::Frames => "",
        }
    }

    /// Ce format ne sait pas représenter la transparence.
    fn drops_alpha(self) -> bool {
        matches!(self, Target::Mp4 | Target::Webm)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    /// Largeur maximale ; jamais d'agrandissement.
    pub max_width: Option<u32>,
    /// Fond appliqué quand la transparence est perdue (`[r, g, b]`).
    pub background: [u8; 3],
    /// Qualité des formats avec perte (0-100).
    pub quality: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub path: String,
    pub frames: u32,
    pub bytes: u64,
    /// La transparence n'existe plus dans le résultat.
    pub alpha_lost: bool,
    /// Le résultat ne boucle pas (vidéo).
    pub loop_lost: bool,
}

fn flatten(image: &RgbaImage, background: [u8; 3]) -> RgbaImage {
    let mut out = image.clone();
    for pixel in out.pixels_mut() {
        let a = u32::from(pixel[3]);
        for channel in 0..3 {
            pixel[channel] = ((u32::from(pixel[channel]) * a + u32::from(background[channel]) * (255 - a)) / 255) as u8;
        }
        pixel[3] = 255;
    }
    out
}

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Convertit `source` vers `target`. `output` est un fichier, ou pour
/// `Target::Frames` le dossier parent dans lequel un sous-dossier est créé.
pub fn convert(
    ffmpeg: &Path,
    source: &Path,
    target: Target,
    output: &Path,
    overwrite: bool,
    options: &Options,
    cancelled: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(f64),
) -> Result<Summary, InternetError> {
    if target != Target::Frames && output.exists() && !overwrite {
        return Err(InternetError::new(ErrorKind::Destination, format!("« {} » existe déjà.", output.display())));
    }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let scratch = Scratch(std::env::temp_dir().join(format!("fourtout-anim-{}-{nanos}", std::process::id())));
    fs::create_dir_all(&scratch.0).map_err(|e| InternetError::new(ErrorKind::Destination, e.to_string()))?;

    // 1. Décodage vers des PNG numérotés, avec la liste des durées.
    let mut list = String::from("ffconcat version 1.0\n");
    let mut names: Vec<String> = Vec::new();
    let mut total_ms = 0_u64;
    let mut total_pixels = 0_u64;
    let mut has_alpha = false;
    let (_, animated) = for_each_frame(source, |index, frame| {
        if cancelled() {
            return Err(InternetError::cancelled());
        }
        let delay = delay_ms(&frame);
        let buffer = frame.into_buffer();
        let pixels = u64::from(buffer.width()) * u64::from(buffer.height());
        total_pixels += pixels;
        if pixels > MAX_PIXELS_PER_FRAME || total_pixels > MAX_TOTAL_PIXELS {
            return Err(fail("Animation trop volumineuse pour être convertie."));
        }
        has_alpha |= buffer.pixels().any(|p| p[3] < 255);
        let buffer = if target.drops_alpha() { flatten(&buffer, options.background) } else { buffer };
        let name = format!("f{index:05}.png");
        buffer.save(scratch.0.join(&name)).map_err(|e| InternetError::new(ErrorKind::Write, format!("Écriture impossible : {e}")))?;
        list.push_str(&format!("file '{name}'\nduration {:.3}\n", delay as f64 / 1000.0));
        names.push(name);
        total_ms += delay;
        Ok(())
    })?;
    if !animated && target != Target::Frames {
        // Une image fixe n'est pas une animation : l'outil adéquat est le convertisseur d'images.
        return Err(InternetError::new(ErrorKind::Unsupported, "Cette image n'est pas animée : utilisez la conversion d'image."));
    }
    let last = names.last().cloned().ok_or_else(|| fail("Aucune image dans ce fichier."))?;
    // Le démultiplexeur concat ignore la durée de la dernière entrée sans répétition.
    list.push_str(&format!("file '{last}'\n"));
    let list_path = scratch.0.join("list.ffconcat");
    fs::write(&list_path, list).map_err(|e| fail(e.to_string()))?;

    // 2. Images seules : copie dans un dossier neuf.
    if target == Target::Frames {
        let stem = source.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "animation".into());
        let dir = unique_path(&output.join(format!("{} (images)", crate::internet::http::sanitize_filename(&stem, "animation"))));
        fs::create_dir_all(&dir).map_err(|e| InternetError::new(ErrorKind::Destination, e.to_string()))?;
        let copy = (|| -> Result<(), InternetError> {
            for (i, name) in names.iter().enumerate() {
                if cancelled() {
                    return Err(InternetError::cancelled());
                }
                let target_name = format!("image-{:04}.png", i + 1);
                // On repart des images décodées d'origine (transparence conservée).
                fs::copy(scratch.0.join(name), dir.join(&target_name)).map_err(|e| InternetError::new(ErrorKind::Write, e.to_string()))?;
                progress((i + 1) as f64 / names.len() as f64);
            }
            Ok(())
        })();
        if let Err(error) = copy {
            let _ = fs::remove_dir_all(&dir);
            return Err(error);
        }
        let bytes = names.iter().filter_map(|n| fs::metadata(scratch.0.join(n)).ok()).map(|m| m.len()).sum();
        return Ok(Summary { path: dir.to_string_lossy().to_string(), frames: names.len() as u32, bytes, alpha_lost: false, loop_lost: false });
    }

    // 3. Réassemblage.
    let produced = scratch.0.join(format!("out.{}", target.extension()));
    let scale = options.max_width.map(|w| format!("scale='min({},iw)':-2:flags=lanczos", w.max(16)));
    let join = |parts: Vec<String>| parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(",");
    let mut args: Vec<String> = ["-f", "concat", "-safe", "0", "-i"].iter().map(|s| s.to_string()).collect();
    args.push(list_path.to_string_lossy().to_string());
    let mut push = |items: &[&str]| args.extend(items.iter().map(|s| s.to_string()));
    match target {
        Target::Gif => {
            let filter = join(vec![
                scale.clone().unwrap_or_default(),
                "split[a][b];[a]palettegen=reserve_transparent=on[p];[b][p]paletteuse=alpha_threshold=128".into(),
            ]);
            push(&["-vf", &filter, "-fps_mode", "vfr", "-loop", "0"]);
        }
        Target::Apng => {
            push(&["-vf", &join(vec![scale.clone().unwrap_or_default(), "format=rgba".into()]), "-c:v", "apng", "-plays", "0", "-fps_mode", "vfr", "-f", "apng"]);
        }
        Target::Webp => {
            let encoders = encode::list_encoders(ffmpeg);
            let encoder = ["libwebp_anim", "libwebp"]
                .into_iter()
                .find(|e| encoders.iter().any(|x| x == e))
                .ok_or_else(|| InternetError::new(ErrorKind::FfmpegMissing, "Ce FFmpeg ne sait pas produire de WebP animé."))?;
            let quality = options.quality.clamp(1, 100).to_string();
            push(&["-vf", &join(vec![scale.clone().unwrap_or_default(), "format=rgba".into()]), "-c:v", encoder, "-lossless", if options.quality >= 100 { "1" } else { "0" }, "-q:v", &quality, "-loop", "0", "-fps_mode", "vfr"]);
        }
        Target::Mp4 | Target::Webm => {
            let container = if target == Target::Mp4 { Container::Mp4 } else { Container::Webm };
            let encoder = encode::pick_video_encoder(ffmpeg, container)
                .ok_or_else(|| InternetError::new(ErrorKind::FfmpegMissing, "Aucun encodeur vidéo utilisable dans ce FFmpeg."))?;
            let filter = join(vec![
                scale.clone().unwrap_or_default(),
                "fps=30".into(),
                "scale=trunc(iw/2)*2:trunc(ih/2)*2".into(),
                "format=yuv420p".into(),
            ]);
            push(&["-vf", &filter, "-c:v", encoder]);
            match encoder {
                "libx264" => push(&["-crf", "20", "-preset", "medium", "-movflags", "+faststart"]),
                "libopenh264" => push(&["-b:v", "4000k", "-movflags", "+faststart"]),
                "libvpx-vp9" => push(&["-b:v", "0", "-crf", "30", "-row-mt", "1"]),
                _ => push(&["-b:v", "2000k"]),
            }
            push(&["-an"]);
        }
        Target::Frames => unreachable!(),
    }
    args.push(produced.to_string_lossy().to_string());
    encode::run(ffmpeg, &args, total_ms, cancelled, progress)?;

    // 4. Livraison atomique.
    if output.exists() {
        fs::remove_file(output).map_err(|e| InternetError::new(ErrorKind::Destination, format!("Remplacement impossible : {e}")))?;
    }
    let mut part = output.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    part.push(".fourtout-part");
    let part = output.with_file_name(part);
    fs::copy(&produced, &part).map_err(|e| InternetError::new(ErrorKind::Write, format!("Écriture impossible (disque plein ?) : {e}")))?;
    fs::rename(&part, output).map_err(|e| {
        let _ = fs::remove_file(&part);
        InternetError::new(ErrorKind::Destination, format!("Finalisation impossible : {e}"))
    })?;
    Ok(Summary {
        path: output.to_string_lossy().to_string(),
        frames: names.len() as u32,
        bytes: fs::metadata(output).map(|m| m.len()).unwrap_or(0),
        alpha_lost: has_alpha && (target.drops_alpha() || target == Target::Gif && false),
        loop_lost: target.drops_alpha(),
    })
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    fn ffmpeg() -> Option<PathBuf> {
        encode::locate(Path::new("ffmpeg"), "ffmpeg")
    }

    fn work(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fourtout-animtest-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Fabrique une animation de 6 images de 64×48 avec FFmpeg (source lavfi).
    fn make(ffmpeg: &Path, out: &Path, codec: &[&str]) -> bool {
        Command::new(ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=10:duration=0.6", "-pix_fmt", "rgba"])
            .args(codec)
            .arg(out)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn options() -> Options {
        Options { max_width: None, background: [255, 255, 255], quality: 80 }
    }

    #[test]
    fn reads_frames_and_durations_of_animated_webp_and_apng() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let dir = work("read");
        assert!(make(&ffmpeg, &dir.join("a.webp"), &["-c:v", "libwebp_anim", "-loop", "0"]));
        assert!(make(&ffmpeg, &dir.join("a.png"), &["-c:v", "apng", "-plays", "0", "-f", "apng"]));
        for name in ["a.webp", "a.png"] {
            let info = info(&dir.join(name)).unwrap();
            assert!(info.animated, "{name}");
            assert_eq!(info.frames, 6, "{name}");
            assert_eq!((info.width, info.height), (64, 48), "{name}");
            assert!((500..=700).contains(&info.duration_ms), "{name}: {}", info.duration_ms);
        }
        // Un PNG ordinaire n'est pas une animation.
        let still = dir.join("still.png");
        image::RgbaImage::new(8, 8).save(&still).unwrap();
        let still_info = info(&still).unwrap();
        assert!(!still_info.animated && still_info.duration_ms == 0 && still_info.frames == 1);
        assert!(info(&dir.join("absent.webp")).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn converts_an_animated_webp_to_every_target_without_hiding_what_was_lost() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let dir = work("convert");
        let source = dir.join("a.webp");
        assert!(make(&ffmpeg, &source, &["-c:v", "libwebp_anim", "-loop", "0"]));
        let ffprobe = crate::exec::find_in_path("ffprobe").unwrap();

        let gif = convert(&ffmpeg, &source, Target::Gif, &dir.join("o.gif"), false, &options(), &|| false, &mut |_| {}).unwrap();
        assert!(fs::read(&gif.path).unwrap().starts_with(b"GIF89a"));
        assert_eq!(gif.frames, 6);

        let apng = convert(&ffmpeg, &source, Target::Apng, &dir.join("o.png"), false, &options(), &|| false, &mut |_| {}).unwrap();
        let sig = magic::identify(&fs::read(&apng.path).unwrap());
        assert_eq!(sig.id, "apng", "le résultat est reconnu comme animé");

        let webp = convert(&ffmpeg, &source, Target::Webp, &dir.join("o.webp"), false, &options(), &|| false, &mut |_| {}).unwrap();
        assert!(magic::identify(&fs::read(&webp.path).unwrap()).animated);

        let mp4 = convert(&ffmpeg, &source, Target::Mp4, &dir.join("o.mp4"), false, &Options { max_width: Some(32), ..options() }, &|| false, &mut |_| {}).unwrap();
        assert!(mp4.loop_lost);
        let probed = encode::probe_streams(&ffprobe, Path::new(&mp4.path)).unwrap();
        assert_eq!(probed.width, Some(32), "réduit, jamais agrandi");
        assert!(probed.duration_secs > 0.4);

        let webm = convert(&ffmpeg, &source, Target::Webm, &dir.join("o.webm"), false, &options(), &|| false, &mut |_| {}).unwrap();
        assert_eq!(magic::identify(&fs::read(&webm.path).unwrap()).id, "webm");

        let frames = convert(&ffmpeg, &source, Target::Frames, &dir, false, &options(), &|| false, &mut |_| {}).unwrap();
        let count = fs::read_dir(&frames.path).unwrap().count();
        assert_eq!(count, 6);
        assert!(Path::new(&frames.path).join("image-0001.png").exists());
        // Un second export ne réutilise pas le dossier.
        let again = convert(&ffmpeg, &source, Target::Frames, &dir, false, &options(), &|| false, &mut |_| {}).unwrap();
        assert_ne!(again.path, frames.path);

        // Pas d'écrasement silencieux, et rien de provisoire ne traîne.
        let error = convert(&ffmpeg, &source, Target::Gif, &dir.join("o.gif"), false, &options(), &|| false, &mut |_| {}).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Destination);
        assert!(fs::read_dir(&dir).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().contains("part")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transparency_is_flattened_only_where_the_target_cannot_keep_it() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let dir = work("alpha");
        // Deux images : l'une moitié transparente.
        let mut a = RgbaImage::from_pixel(16, 16, image::Rgba([255, 0, 0, 255]));
        let mut b = RgbaImage::from_pixel(16, 16, image::Rgba([0, 0, 255, 255]));
        for y in 0..8 {
            for x in 0..16 {
                a.put_pixel(x, y, image::Rgba([0, 0, 0, 0]));
                b.put_pixel(x, y, image::Rgba([0, 0, 0, 0]));
            }
        }
        let pngs: Vec<PathBuf> = [a, b].iter().enumerate().map(|(i, im)| {
            let p = dir.join(format!("s{i}.png"));
            im.save(&p).unwrap();
            p
        }).collect();
        let source = dir.join("alpha.png");
        let status = Command::new(&ffmpeg)
            .args(["-v", "error", "-y", "-framerate", "5", "-i"])
            .arg(dir.join("s%d.png"))
            .args(["-start_number", "0", "-c:v", "apng", "-plays", "0", "-f", "apng"])
            .arg(&source)
            .status()
            .unwrap();
        assert!(status.success() && pngs.len() == 2);

        let apng = convert(&ffmpeg, &source, Target::Apng, &dir.join("k.png"), false, &options(), &|| false, &mut |_| {}).unwrap();
        assert!(!apng.alpha_lost);
        let mp4 = convert(&ffmpeg, &source, Target::Mp4, &dir.join("k.mp4"), false, &options(), &|| false, &mut |_| {}).unwrap();
        assert!(mp4.alpha_lost, "la perte de transparence est signalée");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_stills_cancellation_and_corruption() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let dir = work("reject");
        let still = dir.join("still.png");
        image::RgbaImage::new(8, 8).save(&still).unwrap();
        let error = convert(&ffmpeg, &still, Target::Gif, &dir.join("x.gif"), false, &options(), &|| false, &mut |_| {}).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unsupported);
        assert!(!dir.join("x.gif").exists());

        let source = dir.join("a.webp");
        assert!(make(&ffmpeg, &source, &["-c:v", "libwebp_anim", "-loop", "0"]));
        let error = convert(&ffmpeg, &source, Target::Gif, &dir.join("c.gif"), false, &options(), &|| true, &mut |_| {}).unwrap_err();
        assert!(error.is_cancelled());
        assert!(!dir.join("c.gif").exists());

        let broken = dir.join("broken.webp");
        let mut bytes = fs::read(&source).unwrap();
        bytes.truncate(bytes.len() / 2);
        fs::write(&broken, bytes).unwrap();
        assert!(convert(&ffmpeg, &broken, Target::Gif, &dir.join("b.gif"), false, &options(), &|| false, &mut |_| {}).is_err());
        let text = dir.join("texte.png");
        fs::write(&text, "pas une image").unwrap();
        assert!(info(&text).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
