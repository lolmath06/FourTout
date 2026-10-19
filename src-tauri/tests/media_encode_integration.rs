//! Les constructeurs d'arguments natifs, éprouvés contre le FFmpeg réel.
//!
//! Un tableau d'arguments plausible ne prouve pas qu'FFmpeg l'accepte : ces
//! tests produisent de vrais fichiers et relisent leur contenu avec ffprobe.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use fourtout_lib::exec::find_in_path;
use fourtout_lib::media::budget::{self, Source};
use fourtout_lib::media::encode::{self, AnimationSettings, Container};

fn tools() -> Option<(PathBuf, PathBuf)> {
    let ffmpeg = encode::locate(Path::new("ffmpeg"), "ffmpeg");
    let ffprobe = find_in_path("ffprobe");
    match (ffmpeg, ffprobe) {
        (Some(a), Some(b)) => Some((a, b)),
        _ => {
            eprintln!("FFmpeg absent : test ignoré");
            None
        }
    }
}

fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fourtout-enc-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Un clip de test : mire animée + sinus, de `seconds` secondes.
fn make_clip(ffmpeg: &Path, out: &Path, seconds: u32) {
    let encoder = encode::pick_video_encoder(ffmpeg, Container::Mp4).expect("un encodeur H.264 fonctionnel");
    let status = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(["-f", "lavfi", "-i"])
        .arg(format!("testsrc2=size=640x360:rate=25:duration={seconds}"))
        .args(["-f", "lavfi", "-i"])
        .arg(format!("sine=frequency=440:duration={seconds}"))
        .args(["-c:v", encoder, "-b:v", "3000k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest"])
        .arg(out)
        .status()
        .unwrap();
    assert!(status.success());
}

fn run(ffmpeg: &Path, args: &[String], total_ms: u64) -> Result<(), String> {
    encode::run(ffmpeg, args, total_ms, &|| false, &mut |_| {}).map_err(|e| e.message)
}

#[test]
fn compresses_under_the_requested_size_and_never_upscales() {
    let Some((ffmpeg, ffprobe)) = tools() else { return };
    let work = workspace("compress");
    let source = work.join("source.mp4");
    make_clip(&ffmpeg, &source, 12);
    let source_size = fs::metadata(&source).unwrap().len();

    let probed = encode::probe_streams(&ffprobe, &source).unwrap();
    assert!(probed.has_video && probed.has_audio);
    assert_eq!((probed.width, probed.height), (Some(640), Some(360)));

    let target = source_size / 3;
    let video = encode::pick_video_encoder(&ffmpeg, Container::Mp4).unwrap();
    let audio = encode::pick_audio_encoder(&ffmpeg, Container::Mp4);
    let mut plan = budget::plan(
        &Source {
            duration_secs: probed.duration_secs,
            has_audio: true,
            video_kbps: probed.video_kbps,
            audio_kbps: probed.audio_kbps,
            width: probed.width,
            height: probed.height,
            fps: probed.fps,
        },
        target,
    );
    assert!(plan.feasible, "{plan:?}");

    let output = work.join("small.mp4");
    let mut attempt = 0;
    loop {
        run(&ffmpeg, &encode::compress_args(&source, &output, &plan, video, audio, Container::Mp4), 12_000).unwrap();
        let produced = fs::metadata(&output).unwrap().len();
        attempt += 1;
        match budget::retry(&plan, produced, target, attempt) {
            Some(next) => plan = next,
            None => break,
        }
    }
    let produced = fs::metadata(&output).unwrap().len();
    assert!(produced <= target, "{produced} > {target} après {attempt} essai(s)");
    assert!(produced > target / 4, "la cible est approchée, pas écrasée : {produced}");

    let result = encode::probe_streams(&ffprobe, &output).unwrap();
    assert!(result.has_audio, "la piste audio est conservée");
    assert!(result.height.unwrap() <= 360, "jamais agrandi");
    assert!((result.duration_secs - 12.0).abs() < 0.5);
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn produces_a_real_gif_and_an_animated_webp_within_the_requested_window() {
    let Some((ffmpeg, ffprobe)) = tools() else { return };
    let work = workspace("anim");
    let source = work.join("source.mp4");
    make_clip(&ffmpeg, &source, 8);
    let settings = AnimationSettings { start: 2.0, duration: 3.0, fps: 10, width: 320, quality: 60, colors: 128 };

    let gif = work.join("clip.gif");
    run(&ffmpeg, &encode::gif_args(&source, &gif, &settings), 3000).unwrap();
    let bytes = fs::read(&gif).unwrap();
    assert!(bytes.starts_with(b"GIF89a"));
    let probed = encode::probe_streams(&ffprobe, &gif).unwrap();
    assert_eq!(probed.width, Some(320), "réduit à la largeur demandée");
    assert!((probed.duration_secs - 3.0).abs() < 0.3, "{}", probed.duration_secs);

    // Une largeur demandée supérieure à la source ne l'agrandit pas.
    let wide = AnimationSettings { width: 1920, ..settings.clone() };
    let big = work.join("wide.gif");
    run(&ffmpeg, &encode::gif_args(&source, &big, &wide), 3000).unwrap();
    assert_eq!(encode::probe_streams(&ffprobe, &big).unwrap().width, Some(640));

    // WebP animé : l'encodeur est choisi dans ceux qui existent.
    let encoders = encode::list_encoders(&ffmpeg);
    let webp_encoder = ["libwebp_anim", "libwebp"].into_iter().find(|e| encoders.iter().any(|x| x == e));
    if let Some(encoder) = webp_encoder {
        let webp = work.join("clip.webp");
        run(&ffmpeg, &encode::webp_args(&source, &webp, &settings, encoder), 3000).unwrap();
        let bytes = fs::read(&webp).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WEBP");
        // Le fichier produit est reconnu comme animé par la détection de FourTout.
        let signature = fourtout_lib::files::magic::identify(&bytes[..bytes.len().min(4096)]);
        assert_eq!(signature.id, "webp");
        assert!(signature.animated, "le WebP produit doit porter son animation");
    }
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn trims_by_copy_and_by_reencoding() {
    let Some((ffmpeg, ffprobe)) = tools() else { return };
    let work = workspace("trim");
    let source = work.join("source.mp4");
    make_clip(&ffmpeg, &source, 10);
    let encoder = encode::pick_video_encoder(&ffmpeg, Container::Mp4).unwrap();

    let exact = work.join("exact.mp4");
    run(&ffmpeg, &encode::trim_args(&source, &exact, 3.0, 4.0, Some((encoder, Some("aac")))), 4000).unwrap();
    let duration = encode::duration_secs(&ffprobe, &exact).unwrap();
    assert!((duration - 4.0).abs() < 0.2, "{duration}");

    let fast = work.join("fast.mp4");
    run(&ffmpeg, &encode::trim_args(&source, &fast, 3.0, 4.0, None), 4000).unwrap();
    assert!(encode::duration_secs(&ffprobe, &fast).unwrap() > 3.0);
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn cancellation_stops_ffmpeg_and_reports_it() {
    let Some((ffmpeg, _)) = tools() else { return };
    let work = workspace("cancel");
    let output = work.join("never.mp4");
    // Une source qui prendrait longtemps : encodage d'une heure de mire.
    let args: Vec<String> = ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3600", "-c:v", "mpeg4", "-b:v", "5000k"]
        .iter()
        .map(|s| s.to_string())
        .chain([output.to_string_lossy().to_string()])
        .collect();
    let flag = Arc::new(AtomicBool::new(false));
    let remote = flag.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        remote.store(true, Ordering::SeqCst);
    });
    let started = std::time::Instant::now();
    let error = encode::run(&ffmpeg, &args, 3_600_000, &|| flag.load(Ordering::SeqCst), &mut |_| {}).unwrap_err();
    assert!(error.is_cancelled(), "{error}");
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
    let _ = fs::remove_dir_all(&work);
}

#[test]
fn a_failing_ffmpeg_reports_why() {
    let Some((ffmpeg, _)) = tools() else { return };
    let work = workspace("fail");
    let args: Vec<String> = vec!["-i".into(), work.join("absent.mp4").to_string_lossy().to_string(), work.join("o.mp4").to_string_lossy().to_string()];
    let error = encode::run(&ffmpeg, &args, 0, &|| false, &mut |_| {}).unwrap_err();
    assert!(error.message.contains("échoué"), "{error}");
    let _ = fs::remove_dir_all(&work);
}
