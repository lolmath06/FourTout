//! Arithmétique d'adresses IPv4 et **bornage** des plages à sonder.
//!
//! Ce module existe surtout pour dire non. Une interface en `/16` décrit
//! 65 534 adresses ; une interface en `/8`, seize millions. Parcourir cela
//! « parce que l'utilisateur a cliqué » serait un scan de masse, lent, inutile
//! et indésirable sur un réseau d'entreprise.
//!
//! La règle est donc posée ici, une fois : **256 adresses au maximum**, et si
//! le masque de l'interface est plus large qu'un `/24`, on se rabat sur le
//! `/24` qui contient l'adresse locale — le voisinage immédiat, celui qui
//! intéresse réellement quelqu'un qui cherche son imprimante.

use std::net::Ipv4Addr;

use serde::Serialize;

/// Plafond absolu d'adresses examinées en une fois.
pub const MAX_TARGETS: usize = 256;

/// Préfixe minimal exploré automatiquement. Plus large, on restreint.
pub const NARROWEST_AUTOMATIC_PREFIX: u8 = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ipv4Network {
    pub address: Ipv4Addr,
    pub prefix: u8,
}

impl Ipv4Network {
    pub fn new(address: Ipv4Addr, prefix: u8) -> Result<Self, String> {
        if prefix > 32 {
            return Err(format!("Préfixe IPv4 invalide : /{prefix} (maximum /32)."));
        }
        Ok(Self { address, prefix })
    }

    fn mask(self) -> u32 {
        if self.prefix == 0 {
            0
        } else {
            u32::MAX << (32 - self.prefix)
        }
    }

    /// Adresse de réseau (tous les bits d'hôte à zéro).
    pub fn network_address(self) -> Ipv4Addr {
        Ipv4Addr::from(u32::from(self.address) & self.mask())
    }

    /// Adresse de diffusion (tous les bits d'hôte à un).
    pub fn broadcast_address(self) -> Ipv4Addr {
        Ipv4Addr::from(u32::from(self.address) | !self.mask())
    }

    /// Nombre total d'adresses du bloc, adresses réservées comprises.
    pub fn total_addresses(self) -> u64 {
        1u64 << (32 - self.prefix)
    }

    /// Adresses **utilisables** du bloc, dans l'ordre.
    ///
    /// Un `/31` (RFC 3021) et un `/32` n'ont ni adresse de réseau ni adresse de
    /// diffusion : leurs deux — ou leur unique — adresses sont utilisables.
    pub fn usable_range(self) -> (Ipv4Addr, Ipv4Addr) {
        let first = u32::from(self.network_address());
        let last = u32::from(self.broadcast_address());
        if self.prefix >= 31 {
            (Ipv4Addr::from(first), Ipv4Addr::from(last))
        } else {
            (Ipv4Addr::from(first + 1), Ipv4Addr::from(last - 1))
        }
    }

    pub fn usable_count(self) -> u64 {
        let (first, last) = self.usable_range();
        u64::from(u32::from(last) - u32::from(first)) + 1
    }

    pub fn contains(self, candidate: Ipv4Addr) -> bool {
        u32::from(candidate) & self.mask() == u32::from(self.network_address())
    }
}

impl std::fmt::Display for Ipv4Network {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}/{}", self.network_address(), self.prefix)
    }
}

/// Convertit un masque pointé (`255.255.255.0`) en longueur de préfixe.
pub fn prefix_from_mask(mask: Ipv4Addr) -> Result<u8, String> {
    let bits = u32::from(mask);
    let ones = bits.leading_ones();
    // Un masque valide n'a que des 1 à gauche et des 0 à droite.
    if ones < 32 && (bits << ones) != 0 {
        return Err(format!("Masque de sous-réseau non contigu : {mask}."));
    }
    Ok(ones as u8)
}

/// Plage réellement examinée, après bornage.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRange {
    /// Réseau demandé, tel qu'il découle de l'interface.
    pub declared_cidr: String,
    /// Réseau réellement parcouru, après restriction éventuelle.
    pub scanned_cidr: String,
    pub first: String,
    pub last: String,
    /// Nombre d'adresses qui seront sondées.
    pub target_count: usize,
    /// Vrai si la plage a été réduite par rapport à l'interface.
    pub narrowed: bool,
    /// Explication de la restriction, affichable telle quelle.
    pub note: Option<String>,
}

/// Borne une plage à sonder à partir de l'adresse locale et de son préfixe.
///
/// Ne renvoie jamais plus de [`MAX_TARGETS`] adresses, quel que soit le masque.
pub fn bounded_range(local: Ipv4Addr, prefix: u8) -> Result<ScanRange, String> {
    let declared = Ipv4Network::new(local, prefix)?;
    let declared_cidr = declared.to_string();

    let (network, narrowed, note) = if prefix >= NARROWEST_AUTOMATIC_PREFIX {
        (declared, false, None)
    } else {
        let narrowed = Ipv4Network::new(local, NARROWEST_AUTOMATIC_PREFIX)?;
        (
            narrowed,
            true,
            Some(format!(
                "L'interface annonce {declared_cidr}, soit {} adresses. FourTout n'explore pas un \
                 réseau de cette taille : la découverte est ramenée au /24 qui entoure votre \
                 adresse, {}.",
                declared.total_addresses(),
                narrowed
            )),
        )
    };

    let (first, _last) = network.usable_range();
    let count = network.usable_count();

    // Ceinture et bretelles : même un /24 reste sous la barre, mais la borne
    // est appliquée ici et pas seulement déduite du préfixe.
    let capped = count.min(MAX_TARGETS as u64) as usize;
    let effective_last = Ipv4Addr::from(u32::from(first) + capped as u32 - 1);

    Ok(ScanRange {
        declared_cidr,
        scanned_cidr: network.to_string(),
        first: first.to_string(),
        last: effective_last.to_string(),
        target_count: capped,
        narrowed: narrowed || capped < count as usize,
        note: note.or_else(|| {
            (capped < count as usize).then(|| {
                format!("Plage ramenée aux {MAX_TARGETS} premières adresses (au lieu de {count}).")
            })
        }),
    })
}

/// Liste les adresses d'une plage bornée.
pub fn targets(range: &ScanRange) -> Result<Vec<Ipv4Addr>, String> {
    let first: Ipv4Addr =
        range.first.parse().map_err(|_| format!("Adresse de départ invalide : {}", range.first))?;
    let mut list = Vec::with_capacity(range.target_count);
    for offset in 0..range.target_count {
        list.push(Ipv4Addr::from(u32::from(first) + offset as u32));
    }
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(text: &str) -> Ipv4Addr {
        text.parse().unwrap()
    }

    #[test]
    fn computes_network_and_broadcast() {
        let network = Ipv4Network::new(ip("192.168.1.42"), 24).unwrap();
        assert_eq!(network.network_address(), ip("192.168.1.0"));
        assert_eq!(network.broadcast_address(), ip("192.168.1.255"));
        assert_eq!(network.usable_range(), (ip("192.168.1.1"), ip("192.168.1.254")));
        assert_eq!(network.usable_count(), 254);
        assert!(network.contains(ip("192.168.1.7")));
        assert!(!network.contains(ip("192.168.2.7")));
    }

    #[test]
    fn treats_slash_31_and_32_as_fully_usable() {
        let thirty_one = Ipv4Network::new(ip("10.0.0.4"), 31).unwrap();
        assert_eq!(thirty_one.usable_range(), (ip("10.0.0.4"), ip("10.0.0.5")));
        assert_eq!(thirty_one.usable_count(), 2);

        let thirty_two = Ipv4Network::new(ip("10.0.0.4"), 32).unwrap();
        assert_eq!(thirty_two.usable_range(), (ip("10.0.0.4"), ip("10.0.0.4")));
        assert_eq!(thirty_two.usable_count(), 1);
    }

    #[test]
    fn a_slash_24_is_scanned_whole() {
        let range = bounded_range(ip("192.168.1.42"), 24).unwrap();
        assert_eq!(range.scanned_cidr, "192.168.1.0/24");
        assert_eq!(range.first, "192.168.1.1");
        assert_eq!(range.last, "192.168.1.254");
        assert_eq!(range.target_count, 254);
        assert!(!range.narrowed);
    }

    #[test]
    fn a_slash_16_is_narrowed_instead_of_exploded() {
        let range = bounded_range(ip("10.2.3.4"), 16).unwrap();
        assert_eq!(range.declared_cidr, "10.2.0.0/16");
        assert_eq!(range.scanned_cidr, "10.2.3.0/24");
        assert_eq!(range.target_count, 254);
        assert!(range.narrowed);
        assert!(range.note.unwrap().contains("65536"));
    }

    #[test]
    fn a_slash_8_is_narrowed_too() {
        let range = bounded_range(ip("10.2.3.4"), 8).unwrap();
        assert_eq!(range.scanned_cidr, "10.2.3.0/24");
        assert_eq!(range.target_count, 254);
        assert!(range.narrowed);
    }

    #[test]
    fn never_exceeds_the_ceiling() {
        for prefix in 0..=32u8 {
            let range = bounded_range(ip("172.16.5.9"), prefix).unwrap();
            assert!(
                range.target_count <= MAX_TARGETS,
                "/{prefix} produit {} cibles",
                range.target_count
            );
            assert_eq!(targets(&range).unwrap().len(), range.target_count);
        }
    }

    #[test]
    fn small_networks_keep_their_exact_size() {
        assert_eq!(bounded_range(ip("10.0.0.4"), 32).unwrap().target_count, 1);
        assert_eq!(bounded_range(ip("10.0.0.4"), 31).unwrap().target_count, 2);
        assert_eq!(bounded_range(ip("10.0.0.4"), 30).unwrap().target_count, 2);
        assert_eq!(bounded_range(ip("10.0.0.4"), 28).unwrap().target_count, 14);
    }

    #[test]
    fn reads_dotted_masks() {
        assert_eq!(prefix_from_mask(ip("255.255.255.0")).unwrap(), 24);
        assert_eq!(prefix_from_mask(ip("255.255.0.0")).unwrap(), 16);
        assert_eq!(prefix_from_mask(ip("255.255.255.255")).unwrap(), 32);
        assert_eq!(prefix_from_mask(ip("0.0.0.0")).unwrap(), 0);
        assert!(prefix_from_mask(ip("255.0.255.0")).is_err());
    }

    #[test]
    fn lists_the_first_and_last_target() {
        let range = bounded_range(ip("192.168.1.42"), 24).unwrap();
        let list = targets(&range).unwrap();
        assert_eq!(list.first().unwrap().to_string(), "192.168.1.1");
        assert_eq!(list.last().unwrap().to_string(), "192.168.1.254");
    }
}
