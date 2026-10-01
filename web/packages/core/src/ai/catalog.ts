// Kuratierte lokale Modelle (5.2). Maßstab ist ein ~3B-Modell auf schwacher Hardware; größere sind optional.
// Dateien: GGUF, 4-Bit (Q4_K_M) von unsloth auf Hugging Face; Prüfsumme (SHA-256) aus dem Hugging-Face-Index.
// Jedes andere GGUF-Modell lässt sich zusätzlich selbst einbinden.

export type ModelCapability = "text" | "image" | "audio";

export interface CatalogModel {
  id: string;
  name: string;
  family: "gemma" | "qwen";
  /** Parameter (gerundet, Milliarden) – Gemma E-Modelle: „effektive“ Parameter. */
  paramsB: number;
  quantization: "Q4_K_M";
  url: string;
  sizeBytes: number;
  sha256: string;
  /** Mindest-Arbeitsspeicher des Rechners (Modell + App + Betriebssystem). */
  minRamGb: number;
  capabilities: ModelCapability[];
  license: "Apache-2.0";
  /** Optionaler Bild-Baustein (mmproj) für Bild-Eingaben – erst bei Bedarf laden. */
  vision?: { url: string; sizeBytes: number; sha256: string };
  note: string;
}

const hf = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;

export const modelCatalog: readonly CatalogModel[] = [
  {
    id: "gemma-4-e2b-q4",
    name: "Gemma 4 E2B",
    family: "gemma",
    paramsB: 2.3,
    quantization: "Q4_K_M",
    url: hf("unsloth/gemma-4-E2B-it-GGUF", "gemma-4-E2B-it-Q4_K_M.gguf"),
    sizeBytes: 3_106_738_272,
    sha256: "740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8",
    minRamGb: 8,
    capabilities: ["text", "image", "audio"],
    license: "Apache-2.0",
    vision: {
      url: hf("unsloth/gemma-4-E2B-it-GGUF", "mmproj-F16.gguf"),
      sizeBytes: 985_654_080,
      sha256: "140be8d7849741f88c50757d529b84373ee8e27052cc2236855b537f4a8215fa",
    },
    note: "Von Google. Versteht auch Bilder und Sprache – sparsam.",
  },
  {
    id: "gemma-4-e4b-q4",
    name: "Gemma 4 E4B",
    family: "gemma",
    paramsB: 4.5,
    quantization: "Q4_K_M",
    url: hf("unsloth/gemma-4-E4B-it-GGUF", "gemma-4-E4B-it-Q4_K_M.gguf"),
    sizeBytes: 4_977_171_584,
    sha256: "85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87",
    minRamGb: 12,
    capabilities: ["text", "image", "audio"],
    license: "Apache-2.0",
    vision: {
      url: hf("unsloth/gemma-4-E4B-it-GGUF", "mmproj-F16.gguf"),
      sizeBytes: 990_372_672,
      sha256: "ddf46c21d7078e95338cfc22306b19b276a29a5ad089023449dd54d4b6170a51",
    },
    note: "Von Google. Bessere Qualität, braucht mehr Speicher.",
  },
  {
    id: "qwen-3.5-2b-q4",
    name: "Qwen 3.5 2B",
    family: "qwen",
    paramsB: 2,
    quantization: "Q4_K_M",
    url: hf("unsloth/Qwen3.5-2B-GGUF", "Qwen3.5-2B-Q4_K_M.gguf"),
    sizeBytes: 1_280_835_840,
    sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
    minRamGb: 6,
    capabilities: ["text", "image"],
    license: "Apache-2.0",
    vision: {
      url: hf("unsloth/Qwen3.5-2B-GGUF", "mmproj-F16.gguf"),
      sizeBytes: 668_227_264,
      sha256: "7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7",
    },
    note: "Von Alibaba. Kleinste Wahl, für sehr schwache Geräte.",
  },
  {
    id: "qwen-3.5-4b-q4",
    name: "Qwen 3.5 4B",
    family: "qwen",
    paramsB: 4,
    quantization: "Q4_K_M",
    url: hf("unsloth/Qwen3.5-4B-GGUF", "Qwen3.5-4B-Q4_K_M.gguf"),
    sizeBytes: 2_740_937_888,
    sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
    minRamGb: 8,
    capabilities: ["text", "image"],
    license: "Apache-2.0",
    vision: {
      url: hf("unsloth/Qwen3.5-4B-GGUF", "mmproj-F16.gguf"),
      sizeBytes: 672_423_616,
      sha256: "cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864",
    },
    note: "Von Alibaba. Gilt als stark im Deutschen.",
  },
];

/** Modelle, die auf einem Rechner mit so viel Arbeitsspeicher sinnvoll laufen (größere: ausgegraut + Warnung). */
export function modelsForRam(totalRamGb: number): { model: CatalogModel; fits: boolean }[] {
  return modelCatalog.map((model) => ({ model, fits: totalRamGb >= model.minRamGb }));
}
