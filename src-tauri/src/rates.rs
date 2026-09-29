//! Taux de change de référence de la Banque centrale européenne.
//!
//! C'est la **seule** fonctionnalité de FourTout qui a besoin d'Internet, et
//! elle passe volontairement par la couche native plutôt que par la WebView :
//!
//!  - la politique de sécurité de contenu de l'application reste fermée
//!    (`connect-src 'self'`), donc aucune page ne peut initier de requête
//!    sortante, même si un outil venait à afficher du contenu tiers ;
//!  - il n'y a pas de question de CORS ni de préflight ;
//!  - l'appel est visible dans un seul fichier, ce qui rend la promesse
//!    « FourTout n'envoie rien » vérifiable en un coup d'œil.
//!
//! La source est le flux de référence quotidien de la BCE. Aucune donnée n'est
//! envoyée : c'est une requête GET sans paramètre, sans en-tête d'identité, et
//! le montant à convertir n'est jamais transmis — la conversion se fait
//! localement à partir des taux.

use std::time::Duration;

use serde::Serialize;

/// Flux quotidien officiel, publié chaque jour ouvré vers 16 h CET.
const ECB_DAILY_URL: &str = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/// Au-delà, on considère la BCE injoignable plutôt que de figer l'interface.
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateSnapshot {
    /// Date de publication annoncée par la BCE, au format `AAAA-MM-JJ`.
    pub date: String,
    /// Devise de référence : toujours l'euro pour ce flux.
    pub base: String,
    /// Combien d'unités de chaque devise vaut **un** euro.
    pub rates: Vec<(String, f64)>,
    pub source: String,
    pub source_url: String,
}

/// Commande exposée au frontend. Le cache et l'affichage vivent côté interface :
/// la couche native se contente de rapporter ce que la BCE a publié.
#[tauri::command]
pub fn currency_rates() -> Result<RateSnapshot, String> {
    fetch_ecb()
}

/// Télécharge et analyse le flux quotidien.
///
/// L'analyse est volontairement minimale et ne touche jamais au `<!DOCTYPE>` :
/// on ne résout aucune entité, aucune DTD, aucune ressource externe.
pub fn fetch_ecb() -> Result<RateSnapshot, String> {
    let response = ureq::builder()
        .timeout_connect(TIMEOUT)
        .timeout_read(TIMEOUT)
        .build()
        .get(ECB_DAILY_URL)
        .call()
        .map_err(|error| match error {
            ureq::Error::Status(code, _) => {
                format!("La Banque centrale européenne a répondu avec le code {code}.")
            }
            ureq::Error::Transport(transport) => {
                format!("Serveur injoignable : {transport}")
            }
        })?;

    let body = response
        .into_string()
        .map_err(|e| format!("Réponse illisible : {e}"))?;
    parse_ecb(&body)
}

/// Extrait la date et les taux d'un flux `eurofxref-daily`.
pub fn parse_ecb(body: &str) -> Result<RateSnapshot, String> {
    let date = find_attribute(body, "time")
        .ok_or_else(|| "Réponse inattendue : aucune date de publication trouvée.".to_string())?;

    let mut rates: Vec<(String, f64)> = Vec::new();
    let mut cursor = 0usize;
    while let Some(offset) = body[cursor..].find("currency=") {
        let start = cursor + offset;
        let currency = match read_quoted(&body[start..]) {
            Some(value) => value,
            None => break,
        };
        let rest = &body[start..];
        let rate = rest
            .find("rate=")
            .and_then(|index| read_quoted(&rest[index..]))
            .and_then(|value| value.parse::<f64>().ok());
        if let Some(rate) = rate {
            if rate > 0.0 && rate.is_finite() {
                rates.push((currency.to_uppercase(), rate));
            }
        }
        cursor = start + "currency=".len();
    }

    if rates.is_empty() {
        return Err("Réponse inattendue : aucun taux exploitable dans le flux.".into());
    }
    // L'euro n'est pas listé dans son propre flux : on l'ajoute pour que la
    // table soit complète et que l'interface n'ait pas de cas particulier.
    rates.push(("EUR".to_string(), 1.0));
    rates.sort_by(|a, b| a.0.cmp(&b.0));

    Ok(RateSnapshot {
        date,
        base: "EUR".to_string(),
        rates,
        source: "Banque centrale européenne — taux de référence quotidiens".to_string(),
        source_url: ECB_DAILY_URL.to_string(),
    })
}

/// Valeur d'un attribut `nom='valeur'` ou `nom="valeur"`, à partir de `nom=`.
fn read_quoted(fragment: &str) -> Option<String> {
    let equals = fragment.find('=')?;
    let rest = &fragment[equals + 1..];
    let quote = rest.chars().next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    let end = rest[1..].find(quote)?;
    Some(rest[1..1 + end].to_string())
}

fn find_attribute(body: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=");
    let index = body.find(&needle)?;
    read_quoted(&body[index..])
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
  <Cube>
    <Cube time='2026-09-04'>
      <Cube currency='USD' rate='1.1622'/>
      <Cube currency='JPY' rate='181.59'/>
      <Cube currency='GBP' rate='0.85898'/>
    </Cube>
  </Cube>
</gesmes:Envelope>"#;

    #[test]
    fn parses_the_official_feed() {
        let snapshot = parse_ecb(SAMPLE).unwrap();
        assert_eq!(snapshot.date, "2026-09-04");
        assert_eq!(snapshot.base, "EUR");
        // Trois devises du flux, plus l'euro ajouté.
        assert_eq!(snapshot.rates.len(), 4);
        let usd = snapshot.rates.iter().find(|(code, _)| code == "USD").unwrap();
        assert!((usd.1 - 1.1622).abs() < 1e-9);
        assert!(snapshot.rates.iter().any(|(code, rate)| code == "EUR" && *rate == 1.0));
    }

    #[test]
    fn refuses_a_response_without_rates() {
        assert!(parse_ecb("<html>maintenance</html>").is_err());
        assert!(parse_ecb("<Cube time='2026-01-01'></Cube>").is_err());
    }

    #[test]
    fn ignores_a_malformed_rate_instead_of_inventing_one() {
        let broken = "<Cube time='2026-01-01'><Cube currency='USD' rate='abc'/>\
                      <Cube currency='CHF' rate='0.94'/></Cube>";
        let snapshot = parse_ecb(broken).unwrap();
        assert!(snapshot.rates.iter().all(|(code, _)| code != "USD"));
        assert!(snapshot.rates.iter().any(|(code, _)| code == "CHF"));
    }
}
