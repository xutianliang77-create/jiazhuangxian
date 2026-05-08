export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface DicomTagValue {
  tag: string;
  name: string;
  vr: string;
  value: string | number | Array<string | number>;
}

export interface DicomMetadata {
  filePath: string;
  transferSyntaxUid: string;
  transferSyntaxName: string;
  modality?: string;
  studyDescription?: string;
  seriesDescription?: string;
  bodyPartExamined?: string;
  viewPosition?: string;
  rows?: number;
  columns?: number;
  samplesPerPixel?: number;
  photometricInterpretation?: string;
  bitsAllocated?: number;
  bitsStored?: number;
  pixelRepresentation?: number;
  windowCenter?: number;
  windowWidth?: number;
  rescaleIntercept?: number;
  rescaleSlope?: number;
  deidentifiedTags: DicomTagValue[];
  redactedTags: string[];
  warnings: string[];
  renderable: boolean;
  renderReason: string;
}

export interface RenderedDicomPreview {
  metadata: DicomMetadata;
  pngPath: string;
  metadataPath: string;
  width: number;
  height: number;
  windowCenter?: number;
  windowWidth?: number;
}
