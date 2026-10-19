//! Capture réelle d'une page locale avec un vrai navigateur Chromium.
//!
//! Le navigateur est celui que `webcapture::browser::detect` trouve (PATH,
//! emplacements Windows, ou `FOURTOUT_BROWSER`). La page est servie par un
//! serveur local : aucun site public n'est contacté.
//!
//! Sans navigateur installé, le test le dit et s'arrête : on ne simule pas un
//! navigateur ici — le protocole est éprouvé séparément contre un faux DevTools.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use fourtout_lib::webcapture::{browser, run, Capture, ImageFormat, ImageOptions, PdfOptions};

const PAGE: &str = "<!doctype html><html><head><meta charset=utf-8><title>Page de test</title>\
<style>body{margin:0;background:#fff}.a{height:2400px;background:linear-gradient(#f00,#00f)}</style></head>\
<body><h1>Bonjour FourTout</h1><div class=a></div><p>fin</p></body></html>";

fn serve() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut stream = stream;
            std::thread::spawn(move || {
                let mut buffer = [0_u8; 4096];
                let _ = stream.read(&mut buffer);
                let body = PAGE.as_bytes();
                let head = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body);
            });
        }
    });
    port
}

#[test]
fn captures_a_local_page_as_pdf_image_and_mhtml() {
    let Some(chosen) = browser::detect().into_iter().next() else {
        eprintln!("aucun navigateur Chromium installé : test ignoré");
        return;
    };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/");
    let dir = std::env::temp_dir().join(format!("fourtout-webcap-it-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let timeout = Duration::from_secs(60);

    let pdf = run(&chosen, &url, &Capture::Pdf(PdfOptions { paper_width: 8.27, paper_height: 11.69, landscape: false, margin_mm: 10.0, background: true }), &dir.join("p.pdf"), false, timeout, &|| false).unwrap();
    let bytes = std::fs::read(dir.join("p.pdf")).unwrap();
    assert!(bytes.starts_with(b"%PDF-"), "{:?}", &bytes[..8]);
    assert_eq!(pdf.http_status, Some(200));

    let image = run(&chosen, &url, &Capture::Image(ImageOptions { format: ImageFormat::Png, quality: 90, viewport_width: 800, viewport_height: 600, full_page: true }), &dir.join("p.png"), false, timeout, &|| false).unwrap();
    let png = std::fs::read(dir.join("p.png")).unwrap();
    assert_eq!(&png[1..4], b"PNG");
    // Pleine page : bien plus haute que la fenêtre de 600 px.
    let height = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
    assert!(height >= 2400, "{height}");
    assert_eq!(image.height, Some(height));

    let viewport = run(&chosen, &url, &Capture::Image(ImageOptions { format: ImageFormat::Jpeg, quality: 80, viewport_width: 800, viewport_height: 600, full_page: false }), &dir.join("v.jpg"), false, timeout, &|| false).unwrap();
    assert_eq!(&std::fs::read(dir.join("v.jpg")).unwrap()[..2], &[0xFF, 0xD8]);
    assert_eq!(viewport.height, Some(600));

    run(&chosen, &url, &Capture::Mhtml, &dir.join("p.mhtml"), false, timeout, &|| false).unwrap();
    let mhtml = std::fs::read_to_string(dir.join("p.mhtml")).unwrap();
    assert!(mhtml.contains("MIME-Version") && mhtml.contains("Bonjour FourTout"));

    // Aucun navigateur ni profil ne reste : la capture suivante démarre à neuf.
    let leftovers: Vec<_> = std::fs::read_dir(std::env::temp_dir())
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(&format!("fourtout-web-{}-", std::process::id())))
        .collect();
    assert!(leftovers.is_empty(), "profils restants : {leftovers:?}");
    let _ = std::fs::remove_dir_all(&dir);
}
