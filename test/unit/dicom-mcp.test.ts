import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectDicomFile, prepareDicomForVision, renderDicomPreview } from "../../packages/dicom-mcp/src/dicom";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("dicom-mcp", () => {
  it("inspects a DICOM file and redacts common PHI tags", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codeclaw-dicom-"));
    tempDirs.push(dir);
    const file = path.join(dir, "sample.dcm");
    await writeFile(file, buildDicom({ transferSyntax: "1.2.840.10008.1.2.1" }));

    const metadata = await inspectDicomFile(file);

    expect(metadata.modality).toBe("DX");
    expect(metadata.rows).toBe(2);
    expect(metadata.columns).toBe(2);
    expect(metadata.renderable).toBe(true);
    expect(metadata.redactedTags.some((tag) => tag.includes("PatientName"))).toBe(true);
    expect(JSON.stringify(metadata.deidentifiedTags)).not.toContain("Doe");
  });

  it("renders uncompressed grayscale DICOM to PNG and prompt context", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codeclaw-dicom-render-"));
    tempDirs.push(dir);
    const file = path.join(dir, "sample.dcm");
    await writeFile(file, buildDicom({ transferSyntax: "1.2.840.10008.1.2.1" }));

    const rendered = await renderDicomPreview({ filePath: file, outputDir: dir });
    const png = await readFile(rendered.pngPath);
    const prepared = await prepareDicomForVision({ filePath: file, outputDir: dir });

    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(rendered.width).toBe(2);
    expect(rendered.height).toBe(2);
    expect(prepared.promptContext).toContain("PHI has been redacted");
    expect(prepared.promptContext).toContain(rendered.metadata.transferSyntaxName);
  });

  it("refuses compressed transfer syntaxes instead of pretending to render", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codeclaw-dicom-jpeg-"));
    tempDirs.push(dir);
    const file = path.join(dir, "compressed.dcm");
    await writeFile(file, buildDicom({ transferSyntax: "1.2.840.10008.1.2.4.90" }));

    const metadata = await inspectDicomFile(file);
    expect(metadata.renderable).toBe(false);
    await expect(renderDicomPreview({ filePath: file, outputDir: dir })).rejects.toThrow(/Unsupported/);
  });
});

function buildDicom(opts: { transferSyntax: string }): Buffer {
  const preamble = Buffer.alloc(128);
  const magic = Buffer.from("DICM", "ascii");
  const pixels = Buffer.alloc(8);
  [0, 1000, 2000, 3000].forEach((value, index) => pixels.writeUInt16LE(value, index * 2));
  return Buffer.concat([
    preamble,
    magic,
    element("0002", "0010", "UI", opts.transferSyntax),
    element("0008", "0060", "CS", "DX"),
    element("0008", "1030", "LO", "Chest"),
    element("0010", "0010", "PN", "Doe^Jane"),
    element("0018", "0015", "CS", "CHEST"),
    element("0018", "5101", "CS", "PA"),
    element("0028", "0002", "US", 1),
    element("0028", "0004", "CS", "MONOCHROME2"),
    element("0028", "0010", "US", 2),
    element("0028", "0011", "US", 2),
    element("0028", "0100", "US", 16),
    element("0028", "0101", "US", 12),
    element("0028", "0103", "US", 0),
    element("0028", "1050", "DS", "1500"),
    element("0028", "1051", "DS", "3000"),
    element("7fe0", "0010", "OW", pixels),
  ]);
}

function element(groupHex: string, elementHex: string, vr: string, value: string | number | Buffer): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(Number.parseInt(groupHex, 16), 0);
  head.writeUInt16LE(Number.parseInt(elementHex, 16), 2);
  head.write(vr, 4, 2, "ascii");
  const valueBuf = valueBuffer(vr, value);
  if (new Set(["OB", "OW", "SQ", "UN", "UT"]).has(vr)) {
    const len = Buffer.alloc(6);
    len.writeUInt32LE(valueBuf.length, 2);
    return Buffer.concat([head, len, valueBuf]);
  }
  const len = Buffer.alloc(2);
  len.writeUInt16LE(valueBuf.length, 0);
  return Buffer.concat([head, len, valueBuf]);
}

function valueBuffer(vr: string, value: string | number | Buffer): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (vr === "US") {
    const out = Buffer.alloc(2);
    out.writeUInt16LE(Number(value), 0);
    return out;
  }
  const text = `${value}${vr === "UI" ? "\0" : ""}`;
  const out = Buffer.from(text.length % 2 === 0 ? text : `${text} `, "ascii");
  return out;
}
