/**
 * Décompression DEFLATE (RFC 1951), sans dépendance.
 *
 * Pourquoi l'écrire plutôt que d'ajouter une bibliothèque : le seul besoin de
 * FourTout est de **lire** les quelques parties XML d'un `.docx`, dans la
 * WebView comme dans les tests Node. Les API navigateur de décompression ne
 * sont pas disponibles partout où l'application tourne (WebKitGTK ancien), et
 * le côté natif Rust n'est joignable qu'avec un chemin de fichier — ce qu'un
 * fichier déposé n'a pas. L'algorithme, lui, est figé depuis 1996 et tient en
 * une page.
 *
 * L'implémentation est volontairement directe : correcte et vérifiable avant
 * d'être rapide. Elle traite des documents bureautiques, pas des flux vidéo.
 */

export class InflateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InflateError";
  }
}

/** Lecture bit à bit, du bit de poids faible au bit de poids fort. */
class BitReader {
  private position = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(private readonly bytes: Uint8Array) {}

  bits(count: number): number {
    while (this.bitCount < count) {
      if (this.position >= this.bytes.length) {
        throw new InflateError("Flux compressé tronqué.");
      }
      this.bitBuffer |= this.bytes[this.position] << this.bitCount;
      this.position += 1;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << count) - 1);
    this.bitBuffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  /** Abandonne les bits restants de l'octet courant. */
  alignToByte(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  readBytes(count: number): Uint8Array {
    if (this.position + count > this.bytes.length) {
      throw new InflateError("Flux compressé tronqué.");
    }
    const slice = this.bytes.subarray(this.position, this.position + count);
    this.position += count;
    return slice;
  }
}

/**
 * Table de Huffman canonique, décrite par la longueur de code de chaque
 * symbole — la seule forme dans laquelle DEFLATE transporte ses arbres.
 */
interface HuffmanTable {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function buildHuffman(lengths: Uint8Array): HuffmanTable {
  const counts = new Uint16Array(16);
  for (const length of lengths) counts[length] += 1;
  counts[0] = 0;

  const offsets = new Uint16Array(16);
  for (let bits = 1; bits < 16; bits += 1) {
    offsets[bits] = offsets[bits - 1] + counts[bits - 1];
  }

  const symbols = new Uint16Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    if (lengths[symbol] !== 0) {
      symbols[offsets[lengths[symbol]]] = symbol;
      offsets[lengths[symbol]] += 1;
    }
  }
  return { counts, symbols };
}

function decodeSymbol(reader: BitReader, table: HuffmanTable): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let length = 1; length < 16; length += 1) {
    code |= reader.bits(1);
    const count = table.counts[length];
    if (code - first < count) return table.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new InflateError("Code de Huffman invalide.");
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
  131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
  2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
  13, 13,
];
/** Ordre dans lequel DEFLATE transmet les longueurs de l'arbre des longueurs. */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

let fixedLiteral: HuffmanTable | undefined;
let fixedDistance: HuffmanTable | undefined;

function fixedTables(): { literal: HuffmanTable; distance: HuffmanTable } {
  if (!fixedLiteral || !fixedDistance) {
    const lengths = new Uint8Array(288);
    lengths.fill(8, 0, 144);
    lengths.fill(9, 144, 256);
    lengths.fill(7, 256, 280);
    lengths.fill(8, 280, 288);
    fixedLiteral = buildHuffman(lengths);
    fixedDistance = buildHuffman(new Uint8Array(30).fill(5));
  }
  return { literal: fixedLiteral, distance: fixedDistance };
}

/** Croissance amortie : on ne connaît pas la taille finale à l'avance. */
class OutputBuffer {
  private data: Uint8Array;
  private size = 0;

  constructor(initial: number) {
    this.data = new Uint8Array(Math.max(1024, initial));
  }

  get length(): number {
    return this.size;
  }

  private ensure(extra: number): void {
    if (this.size + extra <= this.data.length) return;
    let capacity = this.data.length * 2;
    while (capacity < this.size + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.data.subarray(0, this.size));
    this.data = next;
  }

  pushByte(byte: number): void {
    this.ensure(1);
    this.data[this.size] = byte;
    this.size += 1;
  }

  pushChunk(chunk: Uint8Array): void {
    this.ensure(chunk.length);
    this.data.set(chunk, this.size);
    this.size += chunk.length;
  }

  /** Recopie `length` octets déjà écrits, `distance` octets en arrière. */
  copyBack(distance: number, length: number): void {
    if (distance > this.size) throw new InflateError("Référence arrière hors du flux.");
    this.ensure(length);
    let from = this.size - distance;
    for (let i = 0; i < length; i += 1) {
      this.data[this.size] = this.data[from];
      this.size += 1;
      from += 1;
    }
  }

  toBytes(): Uint8Array {
    return this.data.slice(0, this.size);
  }
}

/**
 * Décompresse un flux DEFLATE brut (sans en-tête zlib ni gzip), tel qu'il est
 * stocké dans une archive ZIP.
 *
 * `expectedSize` sert uniquement à dimensionner le tampon : la valeur exacte
 * n'est pas exigée, et n'est jamais crue sur parole.
 */
export function inflateRaw(bytes: Uint8Array, expectedSize = 0): Uint8Array {
  const reader = new BitReader(bytes);
  const output = new OutputBuffer(expectedSize);

  for (;;) {
    const isLast = reader.bits(1);
    const type = reader.bits(2);

    if (type === 0) {
      reader.alignToByte();
      const header = reader.readBytes(4);
      const length = header[0] | (header[1] << 8);
      const complement = header[2] | (header[3] << 8);
      if ((length ^ 0xffff) !== complement) {
        throw new InflateError("Bloc non compressé incohérent.");
      }
      output.pushChunk(reader.readBytes(length));
    } else if (type === 1 || type === 2) {
      let literal: HuffmanTable;
      let distance: HuffmanTable;
      if (type === 1) {
        ({ literal, distance } = fixedTables());
      } else {
        ({ literal, distance } = readDynamicTables(reader));
      }
      inflateBlock(reader, output, literal, distance);
    } else {
      throw new InflateError("Type de bloc DEFLATE réservé.");
    }

    if (isLast) break;
  }

  return output.toBytes();
}

function readDynamicTables(reader: BitReader): {
  literal: HuffmanTable;
  distance: HuffmanTable;
} {
  const literalCount = reader.bits(5) + 257;
  const distanceCount = reader.bits(5) + 1;
  const codeLengthCount = reader.bits(4) + 4;

  const codeLengths = new Uint8Array(19);
  for (let i = 0; i < codeLengthCount; i += 1) {
    codeLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);
  }
  const codeLengthTable = buildHuffman(codeLengths);

  const lengths = new Uint8Array(literalCount + distanceCount);
  let index = 0;
  while (index < lengths.length) {
    const symbol = decodeSymbol(reader, codeLengthTable);
    if (symbol < 16) {
      lengths[index] = symbol;
      index += 1;
    } else if (symbol === 16) {
      if (index === 0) throw new InflateError("Répétition sans longueur précédente.");
      const previous = lengths[index - 1];
      const repeat = reader.bits(2) + 3;
      for (let i = 0; i < repeat; i += 1) lengths[index++] = previous;
    } else if (symbol === 17) {
      index += reader.bits(3) + 3;
    } else {
      index += reader.bits(7) + 11;
    }
    if (index > lengths.length) throw new InflateError("Table de Huffman incohérente.");
  }

  return {
    literal: buildHuffman(lengths.subarray(0, literalCount)),
    distance: buildHuffman(lengths.subarray(literalCount)),
  };
}

function inflateBlock(
  reader: BitReader,
  output: OutputBuffer,
  literal: HuffmanTable,
  distance: HuffmanTable,
): void {
  for (;;) {
    const symbol = decodeSymbol(reader, literal);
    if (symbol < 256) {
      output.pushByte(symbol);
      continue;
    }
    // 256 : fin du bloc.
    if (symbol === 256) return;

    const lengthIndex = symbol - 257;
    if (lengthIndex >= LENGTH_BASE.length) {
      throw new InflateError("Code de longueur invalide.");
    }
    const length = LENGTH_BASE[lengthIndex] + reader.bits(LENGTH_EXTRA[lengthIndex]);

    const distanceSymbol = decodeSymbol(reader, distance);
    if (distanceSymbol >= DISTANCE_BASE.length) {
      throw new InflateError("Code de distance invalide.");
    }
    const back =
      DISTANCE_BASE[distanceSymbol] + reader.bits(DISTANCE_EXTRA[distanceSymbol]);

    output.copyBack(back, length);
  }
}
