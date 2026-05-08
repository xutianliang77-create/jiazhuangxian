export type KnowledgeSource = "rag" | "graph" | "doc" | "beelink";

export interface KnowledgeHit {
  id: string;
  source: KnowledgeSource;
  title: string;
  excerpt: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  score: number;
  provenance: Record<string, unknown>;
}

export interface KnowledgeSearchOptions {
  topK?: number;
  mode?: "auto" | "rag" | "graph" | "beelink";
  sources?: Array<Extract<KnowledgeSource, "rag" | "graph" | "beelink">>;
}

export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  text: string;
  diagnostics: {
    ragAvailable: boolean;
    graphAvailable: boolean;
    beelinkAvailable: boolean;
    ragHits: number;
    graphHits: number;
    beelinkHits: number;
    enabledSources: Array<Extract<KnowledgeSource, "rag" | "graph" | "beelink">>;
  };
}
