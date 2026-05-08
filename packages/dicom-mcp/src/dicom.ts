import { mkdir, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { encodeGrayscalePng } from "./png";
import type { DicomMetadata, DicomTagValue, RenderedDicomPreview } from "./types";

const EXPLICIT_LE = "1.2.840.10008.1.2.1";
const IMPLICIT_LE = "1.2.840.10008.1.2";
const DEFLATED_EXPLICIT_LE = "1.2.840.10008.1.2.1.99";

const TRANSFER_SYNTAX_NAMES: Record<string, string> = {
  [IMPLICIT_LE]: "Implicit VR Little Endian",
  [EXPLICIT_LE]: "Explicit VR Little Endian",
  [DEFLATED_EXPLICIT_LE]: "Deflated Explicit VR Little Endian",
  "1.2.840.10008.1.2.2": "Explicit VR Big Endian",
  "1.2.840.10008.1.2.4.50": "JPEG Baseline",
  "1.2.840.10008.1.2.4.51": "JPEG Extended",
  "1.2.840.10008.1.2.4.57": "JPEG Lossless",
  "1.2.840.10008.1.2.4.70": "JPEG Lossless SV1",
  "1.2.840.10008.1.2.4.90": "JPEG 2000 Lossless",
  "1.2.840.10008.1.2.4.91": "JPEG 2000",
  "1.2.840.10008.1.2.5": "RLE Lossless",
};

const TAGS: Record<string, { name: string; vr: string; phi?: boolean }> = {
  "0002,0010": { name: "TransferSyntaxUID", vr: "UI" },
  "0008,0020": { name: "StudyDate", vr: "DA", phi: true },
  "0008,0030": { name: "StudyTime", vr: "TM", phi: true },
  "0008,0060": { name: "Modality", vr: "CS" },
  "0008,1030": { name: "StudyDescription", vr: "LO" },
  "0008,103e": { name: "SeriesDescription", vr: "LO" },
  "0010,0010": { name: "PatientName", vr: "PN", phi: true },
  "0010,0020": { name: "PatientID", vr: "LO", phi: true },
  "0010,0030": { name: "PatientBirthDate", vr: "DA", phi: true },
  "0010,0040": { name: "PatientSex", vr: "CS", phi: true },
  "0018,0015": { name: "BodyPartExamined", vr: "CS" },
  "0018,5101": { name: "ViewPosition", vr: "CS" },
  "0020,000d": { name: "StudyInstanceUID", vr: "UI", phi: true },
  "0020,000e": { name: "SeriesInstanceUID", vr: "UI", phi: true },
  "0020,0013": { name: "InstanceNumber", vr: "IS" },
  "0028,0002": { name: "SamplesPerPixel", vr: "US" },
  "0028,0004": { name: "PhotometricInterpretation", vr: "CS" },
  "0028,0010": { name: "Rows", vr: "US" },
  "0028,0011": { name: "Columns", vr: "US" },
  "0028,0030": { name: "PixelSpacing", vr: "DS" },
  "0028,0100": { name: "BitsAllocated", vr: "US" },
  "0028,0101": { name: "BitsStored", vr: "US" },
  "0028,0102": { name: "HighBit", vr: "US" },
  "0028,0103": { name: "PixelRepresentation", vr: "US" },
  "0028,1050": { name: "WindowCenter", vr: "DS" },
  "0028,1051": { name: "WindowWidth", vr: "DS" },
  "0028,1052": { name: "RescaleIntercept", vr: "DS" },
  "0028,1053": { name: "RescaleSlope", vr: "DS" },
  "7fe0,0010": { name: "PixelData", vr: "OW" },
};

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UR", "UT", "UN"]);

interface ElementValue {
  tag: string;
  name: string;
  vr: string;
  value?: string | number | Array<string | number>;
  valueOffset: number;
  length: number;
}

interface ParsedDicom {
  buffer: Buffer;
  elements: Map<string, ElementValue>;
  metadata: DicomMetadata;
}

export async function inspectDicomFile(filePath: string): Promise<DicomMetadata> {
  const parsed = await parseDicomFile(filePath);
  return parsed.metadata;
}

export async function renderDicomPreview(opts: {
  filePath: string;
  outputDir?: string;
  windowCenter?: number;
  windowWidth?: number;
}): Promise<RenderedDicomPreview> {
  const parsed = await parseDicomFile(opts.filePath);
  if (!parsed.metadata.renderable) {
    throw new Error(parsed.metadata.renderReason);
  }

  const pixels = renderPixels(parsed, opts.windowCenter, opts.windowWidth);
  const outputDir = opts.outputDir ?? path.join(os.homedir(), ".codeclaw", "artifacts", "dicom-mcp");
  await mkdir(outputDir, { recursive: true });
  const baseName = `${path.basename(opts.filePath).replace(/[^a-zA-Z0-9_.-]+/g, "_")}-${shortHash(opts.filePath)}`;
  const pngPath = path.join(outputDir, `${baseName}.png`);
  const metadataPath = path.join(outputDir, `${baseName}.metadata.json`);
  await writeFile(pngPath, encodeGrayscalePng(pixels.width, pixels.height, pixels.bytes));
  await writeFile(metadataPath, JSON.stringify(parsed.metadata, null, 2), "utf8");

  return {
    metadata: parsed.metadata,
    pngPath,
    metadataPath,
    width: pixels.width,
    height: pixels.height,
    windowCenter: pixels.windowCenter,
    windowWidth: pixels.windowWidth,
  };
}

export async function prepareDicomForVision(opts: {
  filePath: string;
  outputDir?: string;
  windowCenter?: number;
  windowWidth?: number;
}): Promise<RenderedDicomPreview & { promptContext: string }> {
  const rendered = await renderDicomPreview(opts);
  return {
    ...rendered,
    promptContext: buildPromptContext(rendered),
  };
}

async function parseDicomFile(filePath: string): Promise<ParsedDicom> {
  if (!path.isAbsolute(filePath)) throw new Error("path must be absolute");
  const st = await stat(filePath);
  const maxBytes = Number(process.env.CODECLAW_DICOM_MAX_FILE_BYTES ?? 256 * 1024 * 1024);
  if (st.size > maxBytes) throw new Error(`DICOM file is too large: ${st.size} bytes > ${maxBytes}`);
  const buffer = readFileSync(filePath);
  if (buffer.length < 132 || buffer.toString("ascii", 128, 132) !== "DICM") {
    throw new Error("not a DICOM Part 10 file: missing DICM magic after 128-byte preamble");
  }

  const metaElements = parseElements(buffer, 132, true, true);
  const transferSyntaxUid = cleanString(metaElements.elements.get("0002,0010")?.value) || EXPLICIT_LE;
  const explicitVr = transferSyntaxUid !== IMPLICIT_LE;
  const datasetElements = parseElements(buffer, metaElements.endOffset, explicitVr, false);
  const elements = new Map([...metaElements.elements, ...datasetElements.elements]);
  const metadata = buildMetadata(filePath, elements, transferSyntaxUid);
  return { buffer, elements, metadata };
}

function parseElements(buffer: Buffer, offset: number, explicitVr: boolean, stopAfterMetaGroup: boolean): {
  elements: Map<string, ElementValue>;
  endOffset: number;
} {
  const elements = new Map<string, ElementValue>();
  let cursor = offset;
  while (cursor + 8 <= buffer.length) {
    const group = buffer.readUInt16LE(cursor);
    const element = buffer.readUInt16LE(cursor + 2);
    const tag = `${hex(group)},${hex(element)}`;
    if (stopAfterMetaGroup && group !== 0x0002) break;
    cursor += 4;

    let vr = TAGS[tag]?.vr ?? "UN";
    let length = 0;
    if (explicitVr) {
      vr = buffer.toString("ascii", cursor, cursor + 2);
      cursor += 2;
      if (LONG_VR.has(vr)) {
        cursor += 2;
        length = buffer.readUInt32LE(cursor);
        cursor += 4;
      } else {
        length = buffer.readUInt16LE(cursor);
        cursor += 2;
      }
    } else {
      length = buffer.readUInt32LE(cursor);
      cursor += 4;
    }

    if (length === 0xffffffff) break;
    if (length < 0 || cursor + length > buffer.length) break;

    const valueOffset = cursor;
    const spec = TAGS[tag] ?? { name: tag, vr };
    const value = tag === "7fe0,0010" ? undefined : parseValue(buffer.subarray(valueOffset, valueOffset + length), spec.vr);
    elements.set(tag, { tag, name: spec.name, vr: spec.vr, value, valueOffset, length });
    cursor += length + (length % 2);
  }
  return { elements, endOffset: cursor };
}

function buildMetadata(filePath: string, elements: Map<string, ElementValue>, transferSyntaxUid: string): DicomMetadata {
  const warnings: string[] = [];
  const redactedTags: string[] = [];
  const deidentifiedTags: DicomTagValue[] = [];
  for (const element of elements.values()) {
    if (element.tag === "7fe0,0010") continue;
    const spec = TAGS[element.tag];
    if (spec?.phi) {
      redactedTags.push(`${element.tag} ${spec.name}`);
      continue;
    }
    if (element.value !== undefined && spec) {
      deidentifiedTags.push({ tag: element.tag, name: spec.name, vr: spec.vr, value: element.value });
    }
  }

  const samplesPerPixel = num(elements, "0028,0002");
  const bitsAllocated = num(elements, "0028,0100");
  const photometric = str(elements, "0028,0004");
  const pixelData = elements.get("7fe0,0010");
  const supportedSyntax = transferSyntaxUid === EXPLICIT_LE || transferSyntaxUid === IMPLICIT_LE;
  if (!supportedSyntax) warnings.push(`Unsupported compressed or non-little-endian transfer syntax: ${transferSyntaxUid}`);
  if (!pixelData) warnings.push("PixelData tag (7FE0,0010) was not found.");
  if (samplesPerPixel !== undefined && samplesPerPixel !== 1) warnings.push(`Only grayscale SamplesPerPixel=1 is supported; got ${samplesPerPixel}.`);
  if (bitsAllocated !== undefined && bitsAllocated !== 8 && bitsAllocated !== 16) warnings.push(`Only 8-bit and 16-bit grayscale pixel data is supported; got ${bitsAllocated}.`);
  if (photometric && photometric !== "MONOCHROME1" && photometric !== "MONOCHROME2") warnings.push(`Only MONOCHROME1/MONOCHROME2 is supported; got ${photometric}.`);

  const renderable =
    supportedSyntax &&
    Boolean(pixelData) &&
    (samplesPerPixel === undefined || samplesPerPixel === 1) &&
    (bitsAllocated === 8 || bitsAllocated === 16) &&
    (!photometric || photometric === "MONOCHROME1" || photometric === "MONOCHROME2");

  return {
    filePath,
    transferSyntaxUid,
    transferSyntaxName: TRANSFER_SYNTAX_NAMES[transferSyntaxUid] ?? "Unknown transfer syntax",
    modality: str(elements, "0008,0060"),
    studyDescription: str(elements, "0008,1030"),
    seriesDescription: str(elements, "0008,103e"),
    bodyPartExamined: str(elements, "0018,0015"),
    viewPosition: str(elements, "0018,5101"),
    rows: num(elements, "0028,0010"),
    columns: num(elements, "0028,0011"),
    samplesPerPixel,
    photometricInterpretation: photometric,
    bitsAllocated,
    bitsStored: num(elements, "0028,0101"),
    pixelRepresentation: num(elements, "0028,0103"),
    windowCenter: num(elements, "0028,1050"),
    windowWidth: num(elements, "0028,1051"),
    rescaleIntercept: num(elements, "0028,1052"),
    rescaleSlope: num(elements, "0028,1053"),
    deidentifiedTags,
    redactedTags,
    warnings,
    renderable,
    renderReason: renderable ? "renderable as grayscale PNG" : warnings.join(" ") || "not renderable",
  };
}

function renderPixels(parsed: ParsedDicom, windowCenter?: number, windowWidth?: number): {
  bytes: Uint8Array;
  width: number;
  height: number;
  windowCenter: number;
  windowWidth: number;
} {
  const rows = parsed.metadata.rows;
  const columns = parsed.metadata.columns;
  const bitsAllocated = parsed.metadata.bitsAllocated;
  const pixel = parsed.elements.get("7fe0,0010");
  if (!rows || !columns || !bitsAllocated || !pixel) throw new Error("missing rows, columns, bitsAllocated, or pixel data");

  const count = rows * columns;
  const bytesPerPixel = bitsAllocated / 8;
  if (pixel.length < count * bytesPerPixel) {
    throw new Error(`PixelData is shorter than expected: ${pixel.length} < ${count * bytesPerPixel}`);
  }

  const slope = parsed.metadata.rescaleSlope ?? 1;
  const intercept = parsed.metadata.rescaleIntercept ?? 0;
  const signed = parsed.metadata.pixelRepresentation === 1;
  const values = new Float64Array(count);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    const off = pixel.valueOffset + i * bytesPerPixel;
    const raw =
      bitsAllocated === 8
        ? signed
          ? parsed.buffer.readInt8(off)
          : parsed.buffer.readUInt8(off)
        : signed
          ? parsed.buffer.readInt16LE(off)
          : parsed.buffer.readUInt16LE(off);
    const value = raw * slope + intercept;
    values[i] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const center = windowCenter ?? parsed.metadata.windowCenter ?? (min + max) / 2;
  const width = Math.max(1, windowWidth ?? parsed.metadata.windowWidth ?? (max - min || 1));
  const low = center - width / 2;
  const out = new Uint8Array(count);
  const invert = parsed.metadata.photometricInterpretation === "MONOCHROME1";
  for (let i = 0; i < count; i += 1) {
    const normalized = Math.max(0, Math.min(255, Math.round(((values[i] - low) / width) * 255)));
    out[i] = invert ? 255 - normalized : normalized;
  }
  return { bytes: out, width: columns, height: rows, windowCenter: center, windowWidth: width };
}

function parseValue(raw: Buffer, vr: string): string | number | Array<string | number> {
  if (vr === "US") return raw.length >= 2 ? raw.readUInt16LE(0) : 0;
  if (vr === "SS") return raw.length >= 2 ? raw.readInt16LE(0) : 0;
  if (vr === "UL") return raw.length >= 4 ? raw.readUInt32LE(0) : 0;
  if (vr === "SL") return raw.length >= 4 ? raw.readInt32LE(0) : 0;
  if (vr === "FL") return raw.length >= 4 ? raw.readFloatLE(0) : 0;
  if (vr === "FD") return raw.length >= 8 ? raw.readDoubleLE(0) : 0;
  const text = raw.toString("utf8").replace(/\0/g, "").trim();
  if (vr === "DS" || vr === "IS") {
    const values = text.split("\\").map((item) => Number(item.trim())).filter(Number.isFinite);
    return values.length === 1 ? values[0] : values;
  }
  return text.includes("\\") ? text.split("\\").map((item) => item.trim()) : text;
}

function buildPromptContext(rendered: RenderedDicomPreview): string {
  const m = rendered.metadata;
  return [
    "DICOM image prepared for vision model. Use the rendered PNG, not the original DICOM bytes.",
    "PHI has been redacted from the metadata context.",
    `pngPath: ${rendered.pngPath}`,
    `metadataPath: ${rendered.metadataPath}`,
    `modality: ${m.modality ?? "unknown"}`,
    `bodyPartExamined: ${m.bodyPartExamined ?? "unknown"}`,
    `viewPosition: ${m.viewPosition ?? "unknown"}`,
    `imageSize: ${rendered.width}x${rendered.height}`,
    `transferSyntax: ${m.transferSyntaxName} (${m.transferSyntaxUid})`,
    `window: center=${rendered.windowCenter ?? "auto"}, width=${rendered.windowWidth ?? "auto"}`,
    "Safety: answer in Chinese, provide clinical decision support only, and recommend radiologist/clinician confirmation for urgent or uncertain findings.",
  ].join("\n");
}

function str(elements: Map<string, ElementValue>, tag: string): string | undefined {
  const value = elements.get(tag)?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(elements: Map<string, ElementValue>, tag: string): number | undefined {
  const value = elements.get(tag)?.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && typeof value[0] === "number" && Number.isFinite(value[0])) return value[0];
  return undefined;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/\0/g, "").trim() : undefined;
}

function hex(value: number): string {
  return value.toString(16).padStart(4, "0");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}
