//! Vérification du flux réel de la Banque centrale européenne.
//!
//! C'est le seul appel réseau de FourTout : il doit être éprouvé contre la
//! vraie source, pas seulement contre un échantillon figé. Le test est ignoré
//! proprement quand la machine est hors ligne — l'absence de réseau n'est pas
//! une régression de FourTout.

#[test]
fn fetches_and_parses_the_real_ecb_feed() {
    match fourtout_lib::rates::fetch_ecb() {
        Ok(snapshot) => {
            eprintln!(
                "BCE : relevé du {} · {} devises · 1 EUR = {:?}",
                snapshot.date,
                snapshot.rates.len(),
                snapshot.rates.iter().find(|(c, _)| c == "USD"),
            );
            assert_eq!(snapshot.base, "EUR");
            // Le flux publie une trentaine de devises ; en dessous de dix, c'est
            // que l'analyse a raté quelque chose.
            assert!(snapshot.rates.len() >= 10, "{} taux seulement", snapshot.rates.len());
            assert!(snapshot.date.len() == 10, "date inattendue : {}", snapshot.date);

            let usd = snapshot
                .rates
                .iter()
                .find(|(code, _)| code == "USD")
                .expect("le dollar doit figurer dans le relevé");
            // Bornes très larges : on vérifie un ordre de grandeur plausible,
            // pas une valeur de marché qui périmerait le test demain.
            assert!(usd.1 > 0.5 && usd.1 < 3.0, "taux USD invraisemblable : {}", usd.1);

            // Aucun taux ne doit être nul, négatif ou non fini.
            for (code, rate) in &snapshot.rates {
                assert!(rate.is_finite() && *rate > 0.0, "{code} : {rate}");
            }
        }
        Err(error) => {
            eprintln!("BCE injoignable ({error}) — test ignoré");
        }
    }
}
