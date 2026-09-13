//! Diagnostic structurel et réparations déterministes d'un PDF.
//!
//! Un PDF se lit lui aussi par la fin : `startxref` donne la position d'une
//! table de références croisées, qui donne la position de chaque objet. Trois
//! choses cassent donc un PDF bien plus souvent que son contenu :
//!
//! - des octets ajoutés **après** `%%EOF` (un serveur mal configuré, une
//!   concaténation maladroite) ;
//! - un `startxref` qui ne pointe plus au bon endroit (fichier recollé,
//!   en-tête retiré) ;
//! - une table de références absente ou illisible, alors que tous les objets
//!   sont là.
//!
//! Ces trois cas se corrigent **sans toucher au contenu** : on recopie les
//! octets utiles, ou on ajoute une table reconstruite à partir des objets
//! réellement présents. Tout le reste — un flux tronqué au milieu, une page
//! dont les données manquent — n'est pas réparable, et ce module le dit.
//!
//! Ce module ne prétend pas être un analyseur PDF complet : il lit une
//! structure, il ne rend pas une page. La vérification de ce qu'il produit est
//! faite par le moteur PDF de l'application (pdf.js), qui rouvre le fichier
//! écrit et compte ses pages. Écrire un fichier puis le déclarer réparé sans
//! l'avoir relu serait précisément le « théâtre de la réparation » que cette
//! phase refuse.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{find_from, rfind, Finding, Repairability};

/// Détail du diagnostic PDF.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDetails {
    /// Version annoncée par l'en-tête (« 1.7 »).
    pub version: Option<String>,
    /// Décalage du dernier `%%EOF`.
    pub eof_offset: Option<u64>,
    /// Octets après le dernier `%%EOF`.
    pub trailing_bytes: u64,
    /// Valeur lue après le dernier `startxref`.
    pub startxref_value: Option<u64>,
    /// Le décalage annoncé pointe-t-il sur une structure de références ?
    pub startxref_valid: bool,
    /// Décalage réel de la dernière table `xref`, si une table classique existe.
    pub xref_offset: Option<u64>,
    /// Nombre d'objets indirects trouvés par balayage.
    pub objects: usize,
    /// Numéro d'objet du catalogue (`/Root`), s'il est identifiable.
    pub root_object: Option<u32>,
    /// Le fichier utilise-t-il des flux d'objets (`/ObjStm`) ?
    pub object_streams: bool,
    /// Le fichier utilise-t-il des tables de références en flux (`/Type /XRef`) ?
    pub xref_streams: bool,
    /// Le fichier semble-t-il porter une signature numérique ?
    pub signed: bool,
    /// Nombre d'objets `/Type /Page` **complets** trouvés par balayage.
    pub page_objects: usize,
    /// Un `trailer` classique a-t-il été trouvé ?
    pub trailer: bool,
    /// Ce que FourTout a pu prouver de la cohérence du document.
    pub structure: StructuralCheck,
}

/// Un objet indirect repéré dans le fichier.
#[derive(Clone, Copy, Debug)]
struct IndirectObject {
    number: u32,
    generation: u16,
    offset: usize,
}

/// Balaie le fichier à la recherche des en-têtes `N G obj`.
///
/// Aucune interprétation du contenu : on cherche le mot-clé `obj` précédé de
/// deux entiers. C'est exactement ce que fait un lecteur PDF quand il
/// reconstruit une table perdue.
fn scan_objects(bytes: &[u8]) -> Vec<IndirectObject> {
    let mut found = Vec::new();
    let mut position = 0_usize;

    while let Some(at) = find_from(bytes, b"obj", position) {
        position = at + 3;

        // `obj` doit être un mot isolé, pas la fin de « ObjStm » ou de « objet ».
        if at + 3 < bytes.len() && !is_delimiter(bytes[at + 3]) {
            continue;
        }
        let mut cursor = at;
        if cursor == 0 || !bytes[cursor - 1].is_ascii_whitespace() {
            continue;
        }
        while cursor > 0 && bytes[cursor - 1].is_ascii_whitespace() {
            cursor -= 1;
        }
        let generation_end = cursor;
        while cursor > 0 && bytes[cursor - 1].is_ascii_digit() {
            cursor -= 1;
        }
        if cursor == generation_end {
            continue;
        }
        let generation: u16 = match std::str::from_utf8(&bytes[cursor..generation_end])
            .ok()
            .and_then(|text| text.parse().ok())
        {
            Some(value) => value,
            None => continue,
        };

        if cursor == 0 || !bytes[cursor - 1].is_ascii_whitespace() {
            continue;
        }
        while cursor > 0 && bytes[cursor - 1].is_ascii_whitespace() {
            cursor -= 1;
        }
        let number_end = cursor;
        while cursor > 0 && bytes[cursor - 1].is_ascii_digit() {
            cursor -= 1;
        }
        if cursor == number_end {
            continue;
        }
        let number: u32 = match std::str::from_utf8(&bytes[cursor..number_end])
            .ok()
            .and_then(|text| text.parse().ok())
        {
            Some(value) => value,
            None => continue,
        };

        found.push(IndirectObject { number, generation, offset: cursor });
    }

    found
}

fn is_delimiter(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b'<' | b'>' | b'[' | b']' | b'/' | b'(' | b')' | b'%')
}

/// Lit l'entier qui suit le dernier `startxref`.
fn read_startxref(bytes: &[u8]) -> Option<u64> {
    let at = rfind(bytes, b"startxref")?;
    let mut cursor = at + 9;
    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    let start = cursor;
    while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
        cursor += 1;
    }
    if cursor == start {
        return None;
    }
    std::str::from_utf8(&bytes[start..cursor]).ok()?.parse().ok()
}

/// Le décalage donné pointe-t-il vers une structure de références plausible ?
fn points_at_xref(bytes: &[u8], offset: u64) -> bool {
    let offset = offset as usize;
    if offset >= bytes.len() {
        return false;
    }
    if bytes[offset..].starts_with(b"xref") {
        return true;
    }
    // Table en flux : le décalage pointe sur un objet indirect.
    let window = &bytes[offset..bytes.len().min(offset + 64)];
    find_from(window, b"obj", 0).is_some()
}

/// Cherche le numéro d'objet du catalogue.
fn find_root(bytes: &[u8]) -> Option<u32> {
    // D'abord dans un trailer classique : c'est la déclaration faisant foi.
    if let Some(at) = rfind(bytes, b"/Root") {
        let mut cursor = at + 5;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let start = cursor;
        while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
            cursor += 1;
        }
        if cursor > start {
            if let Some(value) = std::str::from_utf8(&bytes[start..cursor]).ok().and_then(|t| t.parse().ok()) {
                return Some(value);
            }
        }
    }

    // À défaut, l'objet qui se déclare `/Type /Catalog`.
    let catalog = find_from(bytes, b"/Catalog", 0)?;
    let objects = scan_objects(bytes);
    objects
        .iter()
        .filter(|object| object.offset < catalog)
        .max_by_key(|object| object.offset)
        .map(|object| object.number)
}

/// Diagnostic structurel d'un PDF.
pub fn diagnose(bytes: &[u8]) -> (Vec<Finding>, PdfDetails) {
    let mut findings = Vec::new();
    let mut details = PdfDetails::default();

    if !bytes.starts_with(b"%PDF-") {
        // Certains PDF tolérés par les lecteurs ont quelques octets avant
        // l'en-tête : on le cherche donc, au lieu de conclure trop vite.
        match find_from(&bytes[..bytes.len().min(4096)], b"%PDF-", 0) {
            Some(at) => findings.push(Finding::warning(
                "pdf.header-not-at-start",
                "En-tête PDF décalé",
                format!(
                    "Le fichier commence par {at} octets qui ne font pas partie du PDF. La \
                     plupart des lecteurs s'en accommodent, mais les décalages d'objets sont \
                     tous faussés d'autant."
                ),
                Repairability::None,
            )),
            None => {
                findings.push(Finding::error(
                    "pdf.no-header",
                    "Ce n'est pas un PDF",
                    "La signature « %PDF- » est introuvable dans les premiers kilo-octets. Ce \
                     fichier n'est pas un PDF, ou son début a été perdu.",
                    Repairability::None,
                ));
                return (findings, details);
            }
        }
    } else {
        let end = bytes.len().min(16);
        let header = String::from_utf8_lossy(&bytes[5..end]);
        let version: String =
            header.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        if !version.is_empty() {
            details.version = Some(version);
        }
    }

    details.object_streams = find_from(bytes, b"/ObjStm", 0).is_some();
    details.xref_streams = find_from(bytes, b"/XRef", 0).is_some();
    details.trailer = rfind(bytes, b"trailer").is_some();
    details.signed = find_from(bytes, b"/ByteRange", 0).is_some()
        || find_from(bytes, b"/Adobe.PPKLite", 0).is_some();
    // Les pages sont comptées sur les objets **complets**, jamais sur ce que
    // `/Count` annonce : un document tronqué au milieu de sa première page
    // continue d'annoncer deux pages, et c'est précisément ce qu'il ne faut pas
    // croire.
    details.structure = structural_check(bytes);
    details.page_objects = details.structure.page_objects;

    let objects = scan_objects(bytes);
    details.objects = objects.len();
    details.root_object = find_root(bytes);
    details.xref_offset = rfind(bytes, b"\nxref").map(|at| (at + 1) as u64).or_else(|| {
        if bytes.starts_with(b"xref") {
            Some(0)
        } else {
            None
        }
    });

    // Fin de fichier.
    match rfind(bytes, b"%%EOF") {
        Some(at) => {
            details.eof_offset = Some(at as u64);
            let end = at + 5;
            // Une fin de ligne après %%EOF est normale ; au-delà, ce sont des
            // octets qui n'ont rien à faire là.
            let after = &bytes[end..];
            let ignorable = after.iter().take_while(|b| matches!(b, b'\r' | b'\n' | b' ')).count();
            if end + ignorable < bytes.len() {
                details.trailing_bytes = (bytes.len() - end - ignorable) as u64;
                findings.push(Finding::warning(
                    "pdf.trailing-garbage",
                    "Données parasites après la fin du document",
                    format!(
                        "{} octets suivent le dernier « %%EOF ». Certains lecteurs refusent le \
                         fichier, d'autres l'ouvrent sans rien dire. Les retirer est une copie \
                         tronquée à la fin du PDF : aucun objet, aucune page, aucune métadonnée \
                         n'est touchée.",
                        details.trailing_bytes
                    ),
                    Repairability::SafeRepair,
                ));
            }
        }
        None => {
            findings.push(Finding::error(
                "pdf.no-eof",
                "Marque de fin absente",
                "Aucun « %%EOF » dans le fichier. Le document a été tronqué, ou n'a jamais été \
                 écrit jusqu'au bout.",
                Repairability::RecoverPartial,
            ));
        }
    }

    // Table de références.
    details.startxref_value = read_startxref(bytes);
    match details.startxref_value {
        Some(value) => {
            details.startxref_valid = points_at_xref(bytes, value);
            if !details.startxref_valid {
                let repairable = details.xref_offset.is_some();
                findings.push(Finding::new(
                    super::Severity::Error,
                    "pdf.bad-startxref",
                    "Le pointeur de table de références est faux",
                    format!(
                        "« startxref » annonce la table à l'octet {value}, où ne se trouve ni \
                         table `xref` ni objet. {}",
                        if repairable {
                            format!(
                                "Une table `xref` existe pourtant à l'octet {}, et c'est la \
                                 seule : corriger le pointeur suffit, sans toucher au reste.",
                                details.xref_offset.unwrap()
                            )
                        } else {
                            "Aucune table classique n'a été trouvée ailleurs dans le fichier."
                                .to_string()
                        }
                    ),
                    if repairable { Repairability::SafeRepair } else { Repairability::RecoverPartial },
                ));
            }
        }
        None => {
            findings.push(Finding::error(
                "pdf.no-startxref",
                "Aucun pointeur de table de références",
                "Le mot-clé « startxref » est introuvable. Sans lui, aucun lecteur ne sait par \
                 où commencer — même si les objets du document sont tous présents.",
                if details.objects > 0 && !details.object_streams {
                    Repairability::SafeRepair
                } else {
                    Repairability::RecoverPartial
                },
            ));
        }
    }

    if details.objects == 0 {
        findings.push(Finding::error(
            "pdf.no-objects",
            "Aucun objet indirect trouvé",
            "Le balayage n'a trouvé aucun objet « N G obj ». Il n'y a rien à reconstruire.",
            Repairability::None,
        ));
    }

    // Les objets tronqués et les références sans destination décident de ce qui
    // est reconstructible. Sans ce constat, une table de références ajoutée à un
    // document amputé produit un fichier que certains lecteurs ouvrent — et qui
    // ne contient pourtant pas les pages qu'il annonce.
    if !details.structure.incomplete_objects.is_empty() {
        findings.push(Finding::error(
            "pdf.incomplete-objects",
            "Objets tronqués",
            format!(
                "Le ou les objets {} sont ouverts et jamais refermés : le fichier s'arrête au                  milieu de leur contenu. Ces octets n'existent nulle part, et FourTout ne les                  fabriquera pas. Aucune table de références ajoutée par-dessus ne rendrait ce                  document complet.",
                details
                    .structure
                    .incomplete_objects
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            Repairability::None,
        ));
    }

    if !details.structure.dangling_references.is_empty() {
        findings.push(Finding::error(
            "pdf.dangling-references",
            "Références sans destination",
            format!(
                "L'arbre de pages désigne des objets absents du fichier : {}. Un lecteur                  indulgent ouvrira peut-être le document, mais les pages annoncées n'y sont pas.",
                details.structure.dangling_references.join(" ; ")
            ),
            Repairability::None,
        ));
    }

    if let Some(declared) = details.structure.declared_count {
        if declared != details.structure.page_objects {
            findings.push(Finding::error(
                "pdf.page-count-mismatch",
                "Le nombre de pages annoncé est faux",
                format!(
                    "Le document annonce {declared} page(s) ; {} seulement sont présentes et                      complètes. FourTout ne croit pas le chiffre annoncé sur parole : il compte                      les pages qu'il trouve.",
                    details.structure.page_objects
                ),
                Repairability::None,
            ));
        }
    }

    if details.signed {
        findings.push(Finding::warning(
            "pdf.signed",
            "Document apparemment signé numériquement",
            "Ce PDF porte les marques d'une signature numérique. Toute réécriture structurelle, \
             y compris celles que FourTout propose, déplace des octets et **invalide la \
             signature**. FourTout ne prétend pas la préserver.",
            Repairability::None,
        ));
    }

    if details.object_streams {
        findings.push(Finding::info(
            "pdf.object-streams",
            "Document à flux d'objets",
            "Ce PDF range une partie de ses objets dans des flux compressés (`/ObjStm`). Ils ne \
             sont pas visibles au balayage : FourTout ne proposera donc pas de reconstruire sa \
             table de références, faute de pouvoir prouver qu'elle serait complète.",
        ));
    }

    if findings.is_empty() && !details.structure.proven() {
        findings.push(Finding::error(
            "pdf.unprovable-structure",
            "Structure incohérente",
            details.structure.problems.join(" "),
            Repairability::None,
        ));
    }

    if findings.is_empty() {
        findings.push(Finding::info(
            "pdf.healthy",
            "Structure conforme",
            format!(
                "En-tête, table de références et fin de fichier concordent. {} objets indirects, \
                 catalogue à l'objet {}.",
                details.objects,
                details.root_object.map(|n| n.to_string()).unwrap_or_else(|| "?".into())
            ),
        ));
    }

    (findings, details)
}


/* ------------------------------------------------------------------------ */
/* Preuve de cohérence structurelle                                          */
/* ------------------------------------------------------------------------ */

/// Ce que l'on a pu **prouver** de la structure d'un document.
///
/// Ce n'est pas un validateur PDF général — FourTout n'en écrit pas un. C'est
/// la vérification étroite du sous-ensemble que ce module sait reconstruire :
/// des objets indirects complets, un catalogue, un nœud de pages, et des pages.
/// Tout ce qui dépasse ce cadre reste **non réparable automatiquement**, et
/// c'est la bonne réponse.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralCheck {
    /// Objets dont l'en-tête `N G obj` a bien son `endobj`.
    pub complete_objects: usize,
    /// Numéros des objets ouverts et jamais refermés : ils sont tronqués.
    pub incomplete_objects: Vec<u32>,
    /// Références qui désignent un objet absent ou incomplet.
    pub dangling_references: Vec<String>,
    /// Pages réellement présentes **et complètes**.
    pub page_objects: usize,
    /// Nombre de pages annoncé par `/Count`, qui n'est jamais cru sur parole.
    pub declared_count: Option<usize>,
    pub root: Option<u32>,
    pub pages_node: Option<u32>,
    /// Motifs pour lesquels la structure n'est pas prouvable. Vide = prouvée.
    pub problems: Vec<String>,
}

impl StructuralCheck {
    /// La structure est-elle démontrée cohérente ?
    pub fn proven(&self) -> bool {
        self.problems.is_empty()
    }
}

/// Un objet indirect avec ses bornes réelles dans le fichier.
#[derive(Clone, Copy, Debug)]
struct ObjectSpan {
    number: u32,
    start: usize,
    /// Début du corps, juste après `obj`.
    body: usize,
    /// Fin du corps : position du `endobj`, ou `None` si l'objet n'est jamais
    /// refermé — c'est-à-dire s'il est tronqué.
    end: Option<usize>,
}

/// Repère les objets et vérifie que chacun est refermé.
///
/// Le `endobj` retenu doit se trouver **avant l'en-tête de l'objet suivant** :
/// sans cette condition, un document tronqué au milieu d'un objet emprunterait
/// le `endobj` d'un objet ultérieur et passerait pour complet.
fn object_spans(bytes: &[u8]) -> Vec<ObjectSpan> {
    let headers = scan_objects(bytes);
    let mut spans = Vec::with_capacity(headers.len());

    for (index, header) in headers.iter().enumerate() {
        let body = match find_from(bytes, b"obj", header.offset) {
            Some(at) => at + 3,
            None => continue,
        };
        let limit = headers.get(index + 1).map(|next| next.offset).unwrap_or(bytes.len());
        let end = find_from(bytes, b"endobj", body).filter(|at| *at < limit);
        spans.push(ObjectSpan { number: header.number, start: header.offset, body, end });
    }
    spans
}

/// Corps d'un objet, entre `obj` et `endobj`.
fn body_of<'a>(bytes: &'a [u8], span: &ObjectSpan) -> &'a [u8] {
    let end = span.end.unwrap_or(bytes.len());
    &bytes[span.body.min(end)..end]
}

/// Lit le numéro d'objet d'une référence `/Clé N G R`.
fn reference_after(body: &[u8], key: &[u8]) -> Option<u32> {
    let at = find_from(body, key, 0)? + key.len();
    let mut cursor = at;
    while cursor < body.len() && body[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    let start = cursor;
    while cursor < body.len() && body[cursor].is_ascii_digit() {
        cursor += 1;
    }
    if cursor == start {
        return None;
    }
    std::str::from_utf8(&body[start..cursor]).ok()?.parse().ok()
}

/// Lit les numéros d'objet d'un tableau `/Kids [1 0 R 2 0 R]`.
fn kids_of(body: &[u8]) -> Vec<u32> {
    let Some(at) = find_from(body, b"/Kids", 0) else { return Vec::new() };
    let Some(open) = find_from(body, b"[", at) else { return Vec::new() };
    let close = find_from(body, b"]", open).unwrap_or(body.len());
    let text = String::from_utf8_lossy(&body[open + 1..close]).to_string();

    let mut kids = Vec::new();
    let tokens: Vec<&str> = text.split_whitespace().collect();
    for window in tokens.windows(3) {
        if window[2] == "R" {
            if let Ok(number) = window[0].parse::<u32>() {
                kids.push(number);
            }
        }
    }
    kids
}

/// Lit `/Count N`.
fn count_of(body: &[u8]) -> Option<usize> {
    let at = find_from(body, b"/Count", 0)? + 6;
    let mut cursor = at;
    while cursor < body.len() && body[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    let start = cursor;
    while cursor < body.len() && body[cursor].is_ascii_digit() {
        cursor += 1;
    }
    if cursor == start {
        return None;
    }
    std::str::from_utf8(&body[start..cursor]).ok()?.parse().ok()
}

/// Vrai si ce corps d'objet se déclare page — et pas nœud de pages.
fn is_page(body: &[u8]) -> bool {
    for needle in [b"/Type /Page".as_slice(), b"/Type/Page".as_slice()] {
        let mut position = 0;
        while let Some(at) = find_from(body, needle, position) {
            if body.get(at + needle.len()).copied() != Some(b's') {
                return true;
            }
            position = at + needle.len();
        }
    }
    false
}

/// Vérifie ce que FourTout sait prouver d'un document.
///
/// Le point de méthode : **rien n'est cru sur parole**. `/Count` annonce deux
/// pages ? On compte les objets page réellement présents et complets. `/Kids`
/// référence l'objet 4 ? On vérifie que l'objet 4 existe et qu'il est refermé.
/// C'est exactement ce qui manquait : un document tronqué au milieu de sa
/// première page annonçait deux pages, et un lecteur tolérant l'ouvrait.
pub fn structural_check(bytes: &[u8]) -> StructuralCheck {
    let mut check = StructuralCheck::default();
    let spans = object_spans(bytes);

    if spans.is_empty() {
        check.problems.push("Aucun objet indirect n'a été trouvé.".to_string());
        return check;
    }

    // La dernière définition d'un numéro fait foi, comme dans un PDF mis à jour
    // par ajouts successifs.
    let mut latest: std::collections::BTreeMap<u32, ObjectSpan> =
        std::collections::BTreeMap::new();
    for span in &spans {
        latest
            .entry(span.number)
            .and_modify(|existing| {
                if span.start > existing.start {
                    *existing = *span;
                }
            })
            .or_insert(*span);
    }

    for (number, span) in &latest {
        if span.end.is_some() {
            check.complete_objects += 1;
        } else {
            check.incomplete_objects.push(*number);
        }
    }

    if !check.incomplete_objects.is_empty() {
        check.problems.push(format!(
            "Objet(s) {} ouvert(s) et jamais refermé(s) : le fichier s'arrête au milieu de leur \
             contenu. Les octets manquants n'existent nulle part.",
            check
                .incomplete_objects
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let complete = |number: u32| latest.get(&number).map(|span| span.end.is_some()).unwrap_or(false);

    // Pages réellement présentes : comptées sur les objets complets.
    check.page_objects = latest
        .values()
        .filter(|span| span.end.is_some() && is_page(body_of(bytes, span)))
        .count();

    // Le catalogue.
    check.root = find_root(bytes);
    let Some(root) = check.root else {
        check.problems.push("Le catalogue du document est introuvable.".to_string());
        return check;
    };
    if !complete(root) {
        check.problems.push(format!("Le catalogue (objet {root}) est absent ou incomplet."));
        return check;
    }

    // Le nœud de pages désigné par le catalogue.
    let catalog = body_of(bytes, latest.get(&root).unwrap());
    check.pages_node = reference_after(catalog, b"/Pages");
    let Some(pages_node) = check.pages_node else {
        check.problems
            .push(format!("Le catalogue (objet {root}) ne désigne aucun arbre de pages."));
        return check;
    };
    if !complete(pages_node) {
        check.problems.push(format!(
            "L'arbre de pages (objet {pages_node}) est absent ou incomplet : le document n'a plus \
             de table des matières."
        ));
        return check;
    }

    // Les enfants annoncés existent-ils tous, et sont-ils complets ?
    let pages_body = body_of(bytes, latest.get(&pages_node).unwrap());
    let kids = kids_of(pages_body);
    check.declared_count = count_of(pages_body);

    for kid in &kids {
        if !complete(*kid) {
            check.dangling_references.push(format!("{kid} 0 R, référencé par /Kids"));
        }
    }
    if !check.dangling_references.is_empty() {
        check.problems.push(format!(
            "Référence(s) sans destination : {}. L'arbre de pages désigne des objets qui \
             n'existent pas dans le fichier.",
            check.dangling_references.join(" ; ")
        ));
    }

    // `/Count` n'est pas cru sur parole : on le confronte aux pages réelles.
    if let Some(declared) = check.declared_count {
        if declared != check.page_objects {
            check.problems.push(format!(
                "L'arbre de pages annonce {declared} page(s), le fichier n'en contient que \
                 {} complète(s). Accepter le chiffre annoncé reviendrait à promettre des pages \
                 qui n'existent pas.",
                check.page_objects
            ));
        }
    }

    if check.page_objects == 0 {
        check.problems.push(
            "Aucune page complète n'a été trouvée : il n'y a pas de document à reconstruire."
                .to_string(),
        );
    }

    check
}

/// Vérifie qu'une table de références reconstruite désigne bien des objets.
///
/// Chaque entrée `n` doit tomber exactement sur le premier octet d'un en-tête
/// `N G obj`. Une table qui pointe à côté est une table fausse, même si un
/// lecteur indulgent s'en accommode.
pub fn xref_points_at_objects(bytes: &[u8]) -> Result<usize, String> {
    let at = rfind(bytes, b"\nxref")
        .map(|position| position + 1)
        .or_else(|| bytes.starts_with(b"xref").then_some(0))
        .ok_or_else(|| "Aucune table `xref` dans le document produit.".to_string())?;

    let text = String::from_utf8_lossy(&bytes[at..]);
    let mut lines = text.lines();
    lines.next(); // « xref »
    let header = lines.next().ok_or_else(|| "Table `xref` vide.".to_string())?;
    let mut header_fields = header.split_whitespace();
    let first: u32 = header_fields
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "En-tête de sous-section `xref` illisible.".to_string())?;
    let count: usize = header_fields
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "En-tête de sous-section `xref` illisible.".to_string())?;

    let starts: std::collections::BTreeMap<usize, u32> =
        object_spans(bytes).into_iter().map(|span| (span.start, span.number)).collect();

    let mut used = 0;
    for index in 0..count {
        let Some(line) = lines.next() else {
            return Err("Table `xref` plus courte que ce qu'elle annonce.".to_string());
        };
        let mut fields = line.split_whitespace();
        let offset: usize = match fields.next().and_then(|value| value.parse().ok()) {
            Some(value) => value,
            None => return Err(format!("Entrée `xref` n° {index} illisible.")),
        };
        let _generation = fields.next();
        let kind = fields.next().unwrap_or("f");
        if kind != "n" {
            continue;
        }
        let number = first + index as u32;
        match starts.get(&offset) {
            Some(found) if *found == number => used += 1,
            Some(found) => {
                return Err(format!(
                    "La table désigne l'objet {number} à l'octet {offset}, où commence en réalité \
                     l'objet {found}."
                ))
            }
            None => {
                return Err(format!(
                    "La table désigne l'objet {number} à l'octet {offset}, où ne commence aucun \
                     objet."
                ))
            }
        }
    }
    Ok(used)
}

/// Réparation demandée.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PdfRepair {
    /// Recopier le document jusqu'au dernier `%%EOF`, sans les octets suivants.
    StripTrailing,
    /// Recopier le document en corrigeant la valeur de `startxref`.
    FixStartxref,
    /// Ajouter une table de références reconstruite à partir des objets trouvés.
    RebuildXref,
}

/// Ce qu'une réparation a fait, mesuré.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfRepairReport {
    pub output: String,
    pub action: String,
    /// Octets retirés, quand l'opération en retire.
    pub removed_bytes: u64,
    /// Octets ajoutés, quand l'opération en ajoute.
    pub added_bytes: u64,
    /// Objets référencés par la table reconstruite.
    pub indexed_objects: usize,
    /// Ce que l'opération préserve, mesuré et non promis.
    pub preserved: Vec<String>,
}

/// Applique une réparation déterministe et écrit le résultat ailleurs.
pub fn repair(bytes: &[u8], action: PdfRepair, destination: &Path) -> Result<PdfRepairReport, String> {
    match action {
        PdfRepair::StripTrailing => {
            let at = rfind(bytes, b"%%EOF")
                .ok_or_else(|| "Aucun « %%EOF » : rien à rogner.".to_string())?;
            let end = at + 5;
            let after = &bytes[end..];
            let ignorable = after.iter().take_while(|b| matches!(b, b'\r' | b'\n' | b' ')).count();
            let keep = end + ignorable;
            if keep >= bytes.len() {
                return Err("Aucune donnée parasite après la fin du document.".to_string());
            }
            std::fs::write(destination, &bytes[..keep])
                .map_err(|e| format!("Écriture impossible : {e}"))?;
            Ok(PdfRepairReport {
                output: destination.to_string_lossy().to_string(),
                action: "strip-trailing".into(),
                removed_bytes: (bytes.len() - keep) as u64,
                added_bytes: 0,
                indexed_objects: 0,
                preserved: vec![
                    "Tous les octets du document jusqu'au « %%EOF » final, à l'identique".into(),
                ],
            })
        }
        PdfRepair::FixStartxref => {
            let xref = rfind(bytes, b"\nxref")
                .map(|at| at + 1)
                .ok_or_else(|| "Aucune table `xref` classique à désigner.".to_string())?;
            let at = rfind(bytes, b"startxref")
                .ok_or_else(|| "Aucun « startxref » à corriger.".to_string())?;

            let mut cursor = at + 9;
            while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }
            let digits_start = cursor;
            while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
                cursor += 1;
            }
            if cursor == digits_start {
                return Err("La valeur de « startxref » est illisible.".to_string());
            }

            let mut output = Vec::with_capacity(bytes.len());
            output.extend_from_slice(&bytes[..digits_start]);
            output.extend_from_slice(xref.to_string().as_bytes());
            output.extend_from_slice(&bytes[cursor..]);
            std::fs::write(destination, &output).map_err(|e| format!("Écriture impossible : {e}"))?;

            Ok(PdfRepairReport {
                output: destination.to_string_lossy().to_string(),
                action: "fix-startxref".into(),
                removed_bytes: 0,
                added_bytes: 0,
                indexed_objects: 0,
                preserved: vec![
                    "Tous les objets, à leur position d'origine".into(),
                    "Seuls les chiffres de « startxref » changent".into(),
                ],
            })
        }
        PdfRepair::RebuildXref => {
            if find_from(bytes, b"/ObjStm", 0).is_some() {
                return Err(
                    "Ce document range des objets dans des flux compressés : une table \
                     reconstruite par balayage serait incomplète, et FourTout ne l'écrira pas."
                        .to_string(),
                );
            }
            let objects = scan_objects(bytes);
            if objects.is_empty() {
                return Err("Aucun objet indirect trouvé : rien à indexer.".to_string());
            }
            // Première barrière : la source elle-même doit être cohérente.
            // Ajouter une table à un document amputé produit un fichier que
            // certains lecteurs ouvrent, et qui ne contient pourtant pas les
            // pages qu'il annonce.
            let source_check = structural_check(bytes);
            if !source_check.proven() {
                return Err(format!(
                    "Ce document ne peut pas être reconstruit de façon fiable. {} Une table de \
                     références ajoutée par-dessus ne rendrait pas les octets manquants : elle \
                     produirait un fichier qui s'ouvre peut-être, mais qui ment sur son contenu.",
                    source_check.problems.join(" ")
                ));
            }
            let root = find_root(bytes)
                .ok_or_else(|| "Catalogue du document introuvable : la table reconstruite \
                                n'aurait pas de racine.".to_string())?;

            // La dernière définition d'un numéro d'objet fait foi, comme dans
            // un PDF mis à jour par ajouts successifs.
            let mut latest: std::collections::BTreeMap<u32, IndirectObject> =
                std::collections::BTreeMap::new();
            for object in objects {
                latest
                    .entry(object.number)
                    .and_modify(|existing| {
                        if object.offset > existing.offset {
                            *existing = object;
                        }
                    })
                    .or_insert(object);
            }
            let highest = *latest.keys().max().unwrap_or(&0);
            let size = highest as usize + 1;

            let mut output = bytes.to_vec();
            // La table doit commencer sur une nouvelle ligne.
            if !output.ends_with(b"\n") {
                output.push(b'\n');
            }
            let xref_offset = output.len();

            output.extend_from_slice(b"xref\n");
            output.extend_from_slice(format!("0 {size}\n").as_bytes());
            output.extend_from_slice(b"0000000000 65535 f \n");
            for number in 1..=highest {
                match latest.get(&number) {
                    Some(object) => output.extend_from_slice(
                        format!("{:010} {:05} n \n", object.offset, object.generation).as_bytes(),
                    ),
                    // Un numéro jamais défini est déclaré libre : c'est ce que
                    // prévoit le format, et non une invention.
                    None => output.extend_from_slice(b"0000000000 65535 f \n"),
                }
            }
            output.extend_from_slice(b"trailer\n");
            output.extend_from_slice(format!("<< /Size {size} /Root {root} 0 R >>\n").as_bytes());
            output.extend_from_slice(b"startxref\n");
            output.extend_from_slice(format!("{xref_offset}\n").as_bytes());
            output.extend_from_slice(b"%%EOF\n");

            // Le candidat est éprouvé **avant** d'atteindre le disque. Écrire
            // puis effacer laisserait, entre les deux, un fichier qu'un autre
            // programme pourrait ouvrir — et surtout, un échec d'effacement
            // laisserait une fausse réparation derrière lui.
            let check = structural_check(&output);
            if !check.proven() {
                return Err(format!(
                    "Table de références reconstruite, puis vérifiée : le document obtenu n'est                      pas cohérent, et FourTout ne l'écrira pas. {} Ce document est diagnosticable,                      mais il n'est pas réparable automatiquement.",
                    check.problems.join(" ")
                ));
            }
            let indexed = xref_points_at_objects(&output).map_err(|problem| {
                format!(
                    "Table de références reconstruite, puis vérifiée : {problem} FourTout                      n'écrira pas un document dont la table désigne autre chose que ses objets."
                )
            })?;
            if indexed != latest.len() {
                return Err(format!(
                    "Table de références reconstruite, puis vérifiée : {indexed} entrées valides                      pour {} objets. FourTout n'écrira pas un document incohérent.",
                    latest.len()
                ));
            }

            std::fs::write(destination, &output).map_err(|e| format!("Écriture impossible : {e}"))?;

            Ok(PdfRepairReport {
                output: destination.to_string_lossy().to_string(),
                action: "rebuild-xref".into(),
                removed_bytes: 0,
                added_bytes: (output.len() - bytes.len()) as u64,
                indexed_objects: latest.len(),
                preserved: vec![
                    "Le document d'origine, octet pour octet".into(),
                    format!("{} objets indexés par la table reconstruite", latest.len()),
                ],
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PDF minuscule mais réel, écrit à la main pour être lisible.
    fn minimal() -> Vec<u8> {
        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.4\n");
        let mut offsets = Vec::new();
        offsets.push(pdf.len());
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        offsets.push(pdf.len());
        pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
        offsets.push(pdf.len());
        pdf.extend_from_slice(
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n",
        );
        let xref = pdf.len();
        pdf.extend_from_slice(b"xref\n0 4\n0000000000 65535 f \n");
        for offset in &offsets {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(b"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n");
        pdf.extend_from_slice(format!("{xref}\n").as_bytes());
        pdf.extend_from_slice(b"%%EOF\n");
        pdf
    }

    #[test]
    fn a_healthy_pdf_raises_nothing() {
        let (findings, details) = diagnose(&minimal());
        assert_eq!(details.version.as_deref(), Some("1.4"));
        assert_eq!(details.objects, 3);
        assert_eq!(details.root_object, Some(1));
        assert!(details.startxref_valid);
        assert_eq!(details.trailing_bytes, 0);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].code, "pdf.healthy");
    }

    #[test]
    fn finds_and_measures_trailing_garbage() {
        let mut pdf = minimal();
        pdf.extend_from_slice(b"des octets qui n'ont rien a faire la");
        let (findings, details) = diagnose(&pdf);
        assert_eq!(details.trailing_bytes, 36);
        let finding = findings.iter().find(|f| f.code == "pdf.trailing-garbage").unwrap();
        assert_eq!(finding.repairability, Repairability::SafeRepair);
    }

    #[test]
    fn strips_trailing_garbage_byte_for_byte() {
        let healthy = minimal();
        let mut pdf = healthy.clone();
        pdf.extend_from_slice(b"parasite");

        let dir = std::env::temp_dir().join("fourtout-pdf-strip");
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.pdf");
        let report = repair(&pdf, PdfRepair::StripTrailing, &out).unwrap();

        assert_eq!(report.removed_bytes, 8);
        // Le résultat est exactement le document sain d'origine.
        assert_eq!(std::fs::read(&out).unwrap(), healthy);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detects_a_startxref_pointing_nowhere() {
        let pdf = minimal();
        let text = String::from_utf8(pdf.clone()).unwrap();
        let broken = text.replace("startxref\n", "startxref\n9999999\n%");
        let (findings, details) = diagnose(broken.as_bytes());
        assert!(!details.startxref_valid);
        let finding = findings.iter().find(|f| f.code == "pdf.bad-startxref").unwrap();
        // Une table `xref` existe ailleurs : la correction est sans perte.
        assert_eq!(finding.repairability, Repairability::SafeRepair);
    }

    #[test]
    fn rewrites_only_the_digits_of_startxref() {
        let pdf = minimal();
        let real_xref = rfind(&pdf, b"\nxref").unwrap() + 1;
        let text = String::from_utf8(pdf).unwrap();
        let broken = text.replace(&format!("startxref\n{real_xref}"), "startxref\n42");

        let dir = std::env::temp_dir().join("fourtout-pdf-startxref");
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.pdf");
        repair(broken.as_bytes(), PdfRepair::FixStartxref, &out).unwrap();

        let fixed = std::fs::read(&out).unwrap();
        let (findings, details) = diagnose(&fixed);
        assert!(details.startxref_valid, "constats : {findings:?}");
        assert_eq!(details.startxref_value, Some(real_xref as u64));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rebuilds_a_reference_table_from_the_objects_themselves() {
        // Document dont toute la queue a disparu : plus de xref, plus de
        // trailer, plus de %%EOF — mais les trois objets sont intacts.
        let pdf = minimal();
        let cut = rfind(&pdf, b"\nxref").unwrap() + 1;
        let truncated = &pdf[..cut];

        let (findings, details) = diagnose(truncated);
        assert_eq!(details.objects, 3);
        assert!(findings.iter().any(|f| f.code == "pdf.no-startxref"));
        assert!(findings.iter().any(|f| f.code == "pdf.no-eof"));

        let dir = std::env::temp_dir().join("fourtout-pdf-rebuild");
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.pdf");
        let report = repair(truncated, PdfRepair::RebuildXref, &out).unwrap();
        assert_eq!(report.indexed_objects, 3);

        let rebuilt = std::fs::read(&out).unwrap();
        // Le document d'origine est intégralement conservé en tête.
        assert!(rebuilt.starts_with(truncated));
        let (after, details) = diagnose(&rebuilt);
        assert!(details.startxref_valid, "constats : {after:?}");
        assert_eq!(details.root_object, Some(1));
        assert!(after.iter().all(|f| f.severity != super::super::Severity::Error), "{after:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_to_rebuild_when_objects_hide_in_streams() {
        let mut pdf = minimal();
        pdf.extend_from_slice(b"\n4 0 obj\n<< /Type /ObjStm >>\nendobj\n");
        let error = repair(&pdf, PdfRepair::RebuildXref, Path::new("/tmp/never")).unwrap_err();
        assert!(error.contains("flux compressés"), "message obtenu : {error}");

        let (findings, details) = diagnose(&pdf);
        assert!(details.object_streams);
        assert!(findings.iter().any(|f| f.code == "pdf.object-streams"));
    }

    #[test]
    fn warns_about_digital_signatures_without_promising_anything() {
        let mut pdf = minimal();
        pdf.extend_from_slice(b"\n5 0 obj\n<< /ByteRange [0 1 2 3] >>\nendobj\n");
        let (findings, details) = diagnose(&pdf);
        assert!(details.signed);
        let finding = findings.iter().find(|f| f.code == "pdf.signed").unwrap();
        assert!(finding.detail.contains("invalide la"));
        assert_eq!(finding.repairability, Repairability::None);
    }

    #[test]
    fn a_file_that_is_not_a_pdf_stops_the_diagnosis() {
        let (findings, details) = diagnose(b"ceci est du texte ordinaire");
        assert_eq!(details.objects, 0);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].code, "pdf.no-header");
    }

    #[test]
    fn ignores_words_that_merely_end_in_obj() {
        // « endobj » et « /ObjStm » ne doivent pas être pris pour des en-têtes.
        let objects = scan_objects(b"1 0 obj\n<< >>\nendobj\n/ObjStm 2 0 obj\n<< >>\nendobj\n");
        assert_eq!(objects.len(), 2);
        assert_eq!(objects[0].number, 1);
        assert_eq!(objects[1].number, 2);
    }
}
