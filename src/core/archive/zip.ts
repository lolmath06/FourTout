/**
 * Écriture d'archives ZIP.
 *
 * Implémentation minimale et volontairement sans dépendance : les fichiers
 * sont stockés sans compression (méthode « store »), ce qui convient au cas
 * d'usage — regrouper des images déjà compressées (PNG, JPEG) issues d'un PDF.
 * Le format produit est standard et s'ouvre avec n'importe quel gestionnaire
 * d'archives.
 *
 * Ce module vivra sa vraie vie à la phase « Fichiers & Archives » ; il est
 * déjà isolé ici pour être réutilisé plutôt que réécrit.
 */

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
  /** Date de modification ; l'heure courante par défaut. */
  date?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Encode une date au format MS-DOS utilisé par le ZIP. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private size = 0;

  get length(): number {
    return this.size;
  }

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  uint16(value: number): void {
    const buffer = new Uint8Array(2);
    new DataView(buffer.buffer).setUint16(0, value, true);
    this.push(buffer);
  }

  uint32(value: number): void {
    const buffer = new Uint8Array(4);
    new DataView(buffer.buffer).setUint32(0, value >>> 0, true);
    this.push(buffer);
  }

  concat(): Uint8Array {
    const output = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

/** Assemble les entrées en une archive ZIP prête à être enregistrée. */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const body = new ByteWriter();
  const central = new ByteWriter();
  const now = new Date();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const { time, date } = dosDateTime(entry.date ?? now);
    const crc = crc32(entry.bytes);
    const offset = body.length;

    // En-tête local
    body.uint32(0x04034b50);
    body.uint16(20); // version minimale
    body.uint16(0x0800); // noms de fichiers en UTF-8
    body.uint16(0); // méthode 0 : stocké
    body.uint16(time);
    body.uint16(date);
    body.uint32(crc);
    body.uint32(entry.bytes.length);
    body.uint32(entry.bytes.length);
    body.uint16(nameBytes.length);
    body.uint16(0);
    body.push(nameBytes);
    body.push(entry.bytes);

    // Entrée du répertoire central
    central.uint32(0x02014b50);
    central.uint16(20); // version d'écriture
    central.uint16(20); // version minimale
    central.uint16(0x0800);
    central.uint16(0);
    central.uint16(time);
    central.uint16(date);
    central.uint32(crc);
    central.uint32(entry.bytes.length);
    central.uint32(entry.bytes.length);
    central.uint16(nameBytes.length);
    central.uint16(0); // champ « extra »
    central.uint16(0); // commentaire
    central.uint16(0); // numéro de disque
    central.uint16(0); // attributs internes
    central.uint32(0); // attributs externes
    central.uint32(offset);
    central.push(nameBytes);
  }

  const centralBytes = central.concat();
  const bodyBytes = body.concat();

  const end = new ByteWriter();
  end.uint32(0x06054b50);
  end.uint16(0);
  end.uint16(0);
  end.uint16(entries.length);
  end.uint16(entries.length);
  end.uint32(centralBytes.length);
  end.uint32(bodyBytes.length);
  end.uint16(0);

  const output = new Uint8Array(bodyBytes.length + centralBytes.length + end.length);
  output.set(bodyBytes, 0);
  output.set(centralBytes, bodyBytes.length);
  output.set(end.concat(), bodyBytes.length + centralBytes.length);
  return output;
}
