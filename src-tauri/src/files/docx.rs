//! Lecture des documents DOCX.
//!
//! Un `.docx` est une archive ZIP contenant du XML : `word/document.xml` pour
//! le corps, `docProps/core.xml` pour les propriétés. On en extrait la
//! **structure** (titres, paragraphes, listes, gras/italique, tableaux), pas la
//! mise en page — et l'interface le dit clairement plutôt que de laisser croire
//! à une conversion fidèle.
//!
//! Le XML est parcouru par un petit analyseur maison : les documents Word sont
//! réguliers, et ajouter une dépendance XML complète pour lire une poignée de
//! balises ne se justifie pas.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocxRun {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BlockKind {
    Paragraph,
    Heading,
    ListItem,
    TableRow,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocxBlock {
    pub kind: BlockKind,
    /// Niveau de titre (1 à 6) ou d'imbrication de liste.
    pub level: usize,
    pub runs: Vec<DocxRun>,
    /// Cellules, pour une ligne de tableau.
    pub cells: Vec<String>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocxMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub keywords: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub last_modified_by: Option<String>,
    pub application: Option<String>,
    pub pages: Option<String>,
    pub words: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxDocument {
    pub blocks: Vec<DocxBlock>,
    pub metadata: DocxMetadata,
    /// Éléments présents dans le fichier mais non restitués.
    pub dropped: Vec<String>,
    pub images: usize,
    pub tables: usize,
}

/// Lit un fichier DOCX et en extrait la structure.
pub fn read(path: &Path) -> Result<DocxDocument, String> {
    let file = File::open(path).map_err(|e| format!("Ouverture impossible : {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "Ce fichier n'est pas un document Word (.docx) valide.".to_string())?;

    let document_xml = read_entry(&mut archive, "word/document.xml")
        .ok_or("Document Word invalide : « word/document.xml » est absent.")?;
    let core_xml = read_entry(&mut archive, "docProps/core.xml");
    let app_xml = read_entry(&mut archive, "docProps/app.xml");

    let images = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|e| e.name().to_string()))
        .filter(|name| name.starts_with("word/media/"))
        .count();

    let mut document = parse_document(&document_xml);
    document.images = images;
    document.metadata = parse_metadata(core_xml.as_deref(), app_xml.as_deref());

    if images > 0 {
        document.dropped.push(format!("{images} image(s) — non restituées en texte"));
    }
    Ok(document)
}

fn read_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    let mut content = String::new();
    entry.read_to_string(&mut content).ok()?;
    Some(content)
}

/* --------------------------------------------------------- analyse XML */

/// Contenu textuel de la première balise `name` rencontrée.
fn tag_text(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}");
    let start = xml.find(&open)?;
    let content_start = xml[start..].find('>')? + start + 1;
    let close = format!("</{name}>");
    let end = xml[content_start..].find(&close)? + content_start;
    let raw = &xml[content_start..end];
    let text = unescape(raw);
    if text.trim().is_empty() {
        None
    } else {
        Some(text.trim().to_string())
    }
}

fn unescape(input: &str) -> String {
    input
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn parse_metadata(core: Option<&str>, app: Option<&str>) -> DocxMetadata {
    let mut metadata = DocxMetadata::default();
    if let Some(xml) = core {
        metadata.title = tag_text(xml, "dc:title");
        metadata.author = tag_text(xml, "dc:creator");
        metadata.subject = tag_text(xml, "dc:subject");
        metadata.keywords = tag_text(xml, "cp:keywords");
        metadata.created = tag_text(xml, "dcterms:created");
        metadata.modified = tag_text(xml, "dcterms:modified");
        metadata.last_modified_by = tag_text(xml, "cp:lastModifiedBy");
    }
    if let Some(xml) = app {
        metadata.application = tag_text(xml, "Application");
        metadata.pages = tag_text(xml, "Pages");
        metadata.words = tag_text(xml, "Words");
    }
    metadata
}

/// Extrait le contenu de chaque `<w:p>` du corps du document.
fn parse_document(xml: &str) -> DocxDocument {
    let mut blocks: Vec<DocxBlock> = Vec::new();
    let mut dropped: Vec<String> = Vec::new();
    let mut tables = 0_usize;

    let body = match (xml.find("<w:body"), xml.rfind("</w:body>")) {
        (Some(start), Some(end)) => &xml[start..end],
        _ => xml,
    };

    // Les lignes de tableau sont repérées avant les paragraphes : un
    // paragraphe situé dans une cellule ne doit pas être compté deux fois.
    let mut table_ranges: Vec<(usize, usize)> = Vec::new();
    let mut cursor = 0;
    while let Some(start) = body[cursor..].find("<w:tbl>") {
        let absolute = cursor + start;
        let Some(end) = body[absolute..].find("</w:tbl>") else { break };
        let stop = absolute + end + "</w:tbl>".len();
        table_ranges.push((absolute, stop));
        tables += 1;
        cursor = stop;
    }

    // Les paragraphes et les tableaux sont collectés séparément puis remis
    // dans l'ordre du document : un paragraphe situé dans une cellule ne doit
    // apparaître qu'une fois, à sa place, dans la ligne de tableau.
    enum Event {
        Paragraph(usize, usize),
        Table(usize, usize),
    }

    let mut events: Vec<(usize, Event)> =
        table_ranges.iter().map(|(s, e)| (*s, Event::Table(*s, *e))).collect();

    let mut cursor = 0;
    while cursor < body.len() {
        let next = match (body[cursor..].find("<w:p "), body[cursor..].find("<w:p>")) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };
        let Some(next) = next else { break };
        let start = cursor + next;
        let Some(end) = body[start..].find("</w:p>") else { break };
        let stop = start + end + "</w:p>".len();
        if !table_ranges.iter().any(|(s, e)| start >= *s && start < *e) {
            events.push((start, Event::Paragraph(start, stop)));
        }
        cursor = stop;
    }
    events.sort_by_key(|(position, _)| *position);

    for (_, event) in events {
        match event {
            Event::Table(start, stop) => {
                for row in split_tags(&body[start..stop], "w:tr") {
                    let cells: Vec<String> = split_tags(&row, "w:tc")
                        .iter()
                        .map(|cell| {
                            split_tags(cell, "w:p")
                                .iter()
                                .map(|p| runs_of(p).iter().map(|r| r.text.clone()).collect::<String>())
                                .collect::<Vec<_>>()
                                .join(" ")
                                .trim()
                                .to_string()
                        })
                        .collect();
                    if !cells.is_empty() {
                        blocks.push(DocxBlock {
                            kind: BlockKind::TableRow,
                            level: 0,
                            runs: Vec::new(),
                            cells,
                        });
                    }
                }
            }
            Event::Paragraph(start, stop) => {
                let paragraph = &body[start..stop];
                let runs = runs_of(paragraph);
                let text: String = runs.iter().map(|r| r.text.as_str()).collect();
                let style = paragraph_style(paragraph);
                let heading_level = style.as_deref().and_then(heading_level_of);
                let is_list = paragraph.contains("<w:numPr")
                    || style.as_deref().map(|s| s.starts_with("ListParagraph")).unwrap_or(false);

                if text.trim().is_empty() && !is_list {
                    continue;
                }
                blocks.push(DocxBlock {
                    kind: match (heading_level, is_list) {
                        (Some(_), _) => BlockKind::Heading,
                        (None, true) => BlockKind::ListItem,
                        _ => BlockKind::Paragraph,
                    },
                    level: heading_level.unwrap_or(0),
                    runs,
                    cells: Vec::new(),
                });
            }
        }
    }

    if tables > 0 {
        dropped.push(format!("{tables} tableau(x) — rendus en texte, sans mise en forme"));
    }

    DocxDocument { blocks, metadata: DocxMetadata::default(), dropped, images: 0, tables }
}

/// Découpe une portion de XML sur une balise donnée et renvoie chaque bloc.
fn split_tags(xml: &str, tag: &str) -> Vec<String> {
    let open_short = format!("<{tag}>");
    let open_long = format!("<{tag} ");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut cursor = 0;
    while cursor < xml.len() {
        let next = match (xml[cursor..].find(&open_short), xml[cursor..].find(&open_long)) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };
        let Some(next) = next else { break };
        let start = cursor + next;
        let Some(end) = xml[start..].find(&close) else { break };
        let stop = start + end + close.len();
        out.push(xml[start..stop].to_string());
        cursor = stop;
    }
    out
}

fn paragraph_style(paragraph: &str) -> Option<String> {
    let marker = "<w:pStyle w:val=\"";
    let start = paragraph.find(marker)? + marker.len();
    let end = paragraph[start..].find('"')? + start;
    Some(paragraph[start..end].to_string())
}

fn heading_level_of(style: &str) -> Option<usize> {
    let lower = style.to_lowercase();
    for prefix in ["heading", "titre", "berschrift"] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            if let Ok(level) = rest.trim().parse::<usize>() {
                return Some(level.clamp(1, 6));
            }
        }
    }
    if lower == "title" || lower == "titre" {
        return Some(1);
    }
    None
}

/// Fragments de texte d'un paragraphe, avec leur style.
fn runs_of(paragraph: &str) -> Vec<DocxRun> {
    let mut runs: Vec<DocxRun> = Vec::new();
    for run in split_tags(paragraph, "w:r") {
        let bold = run.contains("<w:b/>") || run.contains("<w:b ");
        let italic = run.contains("<w:i/>") || run.contains("<w:i ");
        let mut text = String::new();
        for piece in split_tags(&run, "w:t") {
            if let Some(content_start) = piece.find('>') {
                let inner = &piece[content_start + 1..piece.len() - "</w:t>".len()];
                text.push_str(&unescape(inner));
            }
        }
        if run.contains("<w:tab/>") {
            text.push('\t');
        }
        if run.contains("<w:br/>") {
            text.push('\n');
        }
        if text.is_empty() {
            continue;
        }
        match runs.last_mut() {
            Some(last) if last.bold == bold && last.italic == italic => last.text.push_str(&text),
            _ => runs.push(DocxRun { text, bold, italic }),
        }
    }
    runs
}

/* ---------------------------------------------------------- restitution */

/// Texte brut du document.
pub fn to_text(document: &DocxDocument) -> String {
    let mut out = String::new();
    for block in &document.blocks {
        match block.kind {
            BlockKind::TableRow => {
                out.push_str(&block.cells.join("\t"));
                out.push('\n');
            }
            BlockKind::ListItem => {
                out.push_str("- ");
                out.push_str(&plain(block));
                out.push('\n');
            }
            BlockKind::Heading => {
                out.push('\n');
                out.push_str(&plain(block));
                out.push_str("\n\n");
            }
            BlockKind::Paragraph => {
                out.push_str(&plain(block));
                out.push_str("\n\n");
            }
        }
    }
    out.replace("\n\n\n", "\n\n").trim().to_string() + "\n"
}

fn plain(block: &DocxBlock) -> String {
    block.runs.iter().map(|r| r.text.as_str()).collect()
}

fn escape_html(input: &str) -> String {
    input.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// HTML du document, restreint aux balises que FourTout sait produire.
pub fn to_html(document: &DocxDocument) -> String {
    let mut out = String::new();
    let mut in_list = false;
    let mut in_table = false;

    let close_open = |out: &mut String, in_list: &mut bool, in_table: &mut bool| {
        if *in_list {
            out.push_str("</ul>\n");
            *in_list = false;
        }
        if *in_table {
            out.push_str("</table>\n");
            *in_table = false;
        }
    };

    for block in &document.blocks {
        match block.kind {
            BlockKind::Heading => {
                close_open(&mut out, &mut in_list, &mut in_table);
                let level = block.level.clamp(1, 6);
                out.push_str(&format!("<h{level}>{}</h{level}>\n", inline_html(block)));
            }
            BlockKind::Paragraph => {
                close_open(&mut out, &mut in_list, &mut in_table);
                out.push_str(&format!("<p>{}</p>\n", inline_html(block)));
            }
            BlockKind::ListItem => {
                if in_table {
                    out.push_str("</table>\n");
                    in_table = false;
                }
                if !in_list {
                    out.push_str("<ul>\n");
                    in_list = true;
                }
                out.push_str(&format!("<li>{}</li>\n", inline_html(block)));
            }
            BlockKind::TableRow => {
                if in_list {
                    out.push_str("</ul>\n");
                    in_list = false;
                }
                if !in_table {
                    out.push_str("<table>\n");
                    in_table = true;
                }
                let cells: String = block
                    .cells
                    .iter()
                    .map(|cell| format!("<td>{}</td>", escape_html(cell)))
                    .collect();
                out.push_str(&format!("<tr>{cells}</tr>\n"));
            }
        }
    }
    close_open(&mut out, &mut in_list, &mut in_table);
    out
}

fn inline_html(block: &DocxBlock) -> String {
    block
        .runs
        .iter()
        .map(|run| {
            let text = escape_html(&run.text);
            match (run.bold, run.italic) {
                (true, true) => format!("<strong><em>{text}</em></strong>"),
                (true, false) => format!("<strong>{text}</strong>"),
                (false, true) => format!("<em>{text}</em>"),
                (false, false) => text,
            }
        })
        .collect()
}

/// Markdown du document.
pub fn to_markdown(document: &DocxDocument) -> String {
    let mut out = String::new();
    for block in &document.blocks {
        match block.kind {
            BlockKind::Heading => {
                out.push_str(&format!("{} {}\n\n", "#".repeat(block.level.clamp(1, 6)), inline_markdown(block)));
            }
            BlockKind::Paragraph => out.push_str(&format!("{}\n\n", inline_markdown(block))),
            BlockKind::ListItem => out.push_str(&format!("- {}\n", inline_markdown(block))),
            BlockKind::TableRow => out.push_str(&format!("| {} |\n", block.cells.join(" | "))),
        }
    }
    out.trim().to_string() + "\n"
}

fn inline_markdown(block: &DocxBlock) -> String {
    block
        .runs
        .iter()
        .map(|run| match (run.bold, run.italic) {
            (true, true) => format!("***{}***", run.text.trim()),
            (true, false) => format!("**{}**", run.text.trim()),
            (false, true) => format!("*{}*", run.text.trim()),
            (false, false) => run.text.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_headings_paragraphs_lists_and_styles() {
        let xml = r#"<w:document><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Rapport FourTout</w:t></w:r></w:p>
        <w:p><w:r><w:t>Un paragraphe </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>en gras</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Premier point</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Second point</w:t></w:r></w:p>
        </w:body></w:document>"#;
        let document = parse_document(xml);
        assert_eq!(document.blocks.len(), 4);
        assert_eq!(document.blocks[0].kind, BlockKind::Heading);
        assert_eq!(document.blocks[0].level, 1);
        assert_eq!(document.blocks[2].kind, BlockKind::ListItem);

        let text = to_text(&document);
        assert!(text.contains("Rapport FourTout"));
        assert!(text.contains("- Premier point"));

        let html = to_html(&document);
        assert!(html.contains("<h1>Rapport FourTout</h1>"));
        assert!(html.contains("<strong>en gras</strong>"));
        assert!(html.contains("<ul>"));

        let markdown = to_markdown(&document);
        assert!(markdown.contains("# Rapport FourTout"));
        assert!(markdown.contains("**en gras**"));
    }

    #[test]
    fn reads_table_rows_without_duplicating_paragraphs() {
        let xml = r#"<w:document><w:body>
        <w:p><w:r><w:t>Avant</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        <w:p><w:r><w:t>Apres</w:t></w:r></w:p>
        </w:body></w:document>"#;
        let document = parse_document(xml);
        let kinds: Vec<&BlockKind> = document.blocks.iter().map(|b| &b.kind).collect();
        assert_eq!(kinds, vec![&BlockKind::Paragraph, &BlockKind::TableRow, &BlockKind::Paragraph]);
        assert_eq!(document.blocks[1].cells, vec!["A1".to_string(), "B1".to_string()]);
        assert_eq!(document.tables, 1);
    }

    #[test]
    fn escapes_entities_and_html() {
        let xml = r#"<w:document><w:body><w:p><w:r><w:t>a &amp; b &lt;script&gt;</w:t></w:r></w:p></w:body></w:document>"#;
        let document = parse_document(xml);
        assert_eq!(to_text(&document).trim(), "a & b <script>");
        assert!(to_html(&document).contains("&lt;script&gt;"));
    }
}
