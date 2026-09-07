//! Micro-mesures de débit du vérificateur (exécutées à la demande).
#[cfg(test)]
mod measurements {
    use crate::recovery::verifier::{EncryptionParams, PasswordVerifier};
    use rayon::prelude::*;
    use std::time::Instant;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }
    fn r6() -> EncryptionParams {
        EncryptionParams { revision: 6, key_length: 32,
            o: hex("6fe0476854e031216143979dfc3f152ba1e34c428cb6630a21e5ee3ccb68c83bf0784816aa22735b931f2598137035cf"),
            u: hex("dc6e2f82148c37d10535081e106dc0e2f2acf0d94b4483a2ef484f2b6e0802b406c2681d4d5b1ad575d81f4ada5107c5"),
            p: -3904, id0: hex("5183453c8a931cd8175ea2dbaa9642e8"), encrypt_metadata: true }
    }
    fn r4() -> EncryptionParams {
        EncryptionParams { revision: 4, key_length: 16,
            o: hex("0abf965ec5253fb3dd1361577b6bf5c8957edf62be6129c09ea6653808a9a7b1"),
            u: hex("5d945ae5c176025d0eb16f9b81ee65c400000000000000000000000000000000"),
            p: -3904, id0: hex("50fe383d8226bcf3e1881528dbc415b8"), encrypt_metadata: true }
    }

    #[test]
    #[ignore]
    fn throughput() {
        let cpus = num_cpus::get();
        for (name, p, n) in [("R6/AES-256", r6(), 20_000usize), ("R4/AES-128", r4(), 400_000usize)] {
            let v = PasswordVerifier::new(p.clone());
            let cands: Vec<String> = (0..n).map(|i| format!("candidate{i}")).collect();

            let t = Instant::now();
            for c in &cands { std::hint::black_box(v.verify(c)); }
            let st = t.elapsed().as_secs_f64();

            let t = Instant::now();
            cands.par_iter().for_each(|c| { std::hint::black_box(v.verify(c)); });
            let mt = t.elapsed().as_secs_f64();

            eprintln!("{name}: 1 fil = {:.0}/s | {} fils = {:.0}/s", n as f64/st, cpus, n as f64/mt);
        }
    }
}
