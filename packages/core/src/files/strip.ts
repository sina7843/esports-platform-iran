/**
 * EDIT-007 display variants: removes embedded metadata (EXIF/GPS, XMP, comments, text chunks) from JPEG and PNG
 * without re-encoding pixels. JPEG keeps only image-essential segments (APP0/JFIF, quantisation, Huffman, frame,
 * restart and scan data); PNG drops ancillary text/time/EXIF chunks. Other formats are returned unchanged and
 * reported so the caller can refuse or accept them knowingly.
 */
export function stripMetadata(buf: Buffer, mime: string): { data: Buffer; stripped: boolean } {
  if (mime === 'image/jpeg') return { data: stripJpeg(buf), stripped: true };
  if (mime === 'image/png') return { data: stripPng(buf), stripped: true };
  return { data: buf, stripped: false };
}

function stripJpeg(b: Buffer): Buffer {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG');
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('corrupt JPEG segment');
    const marker = b[i + 1]!;
    if (marker === 0xda) {
      out.push(b.subarray(i)); // start of scan: the rest is image data up to EOI
      return Buffer.concat(out);
    }
    if (marker === 0xd9) {
      out.push(b.subarray(i, i + 2));
      return Buffer.concat(out);
    }
    const len = b.readUInt16BE(i + 2);
    const seg = b.subarray(i, i + 2 + len);
    // keep APP0 (JFIF) and APP14 (Adobe colour transform); drop APP1..APP13, APP15 (EXIF/XMP/ICC text) and COM
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if ((!isApp || marker === 0xe0 || marker === 0xee) && marker !== 0xfe) out.push(seg);
    i += 2 + len;
  }
  throw new Error('JPEG without image data');
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString('latin1');
    const chunk = b.subarray(i, i + 12 + len);
    if (!PNG_DROP.has(type)) out.push(chunk);
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}
