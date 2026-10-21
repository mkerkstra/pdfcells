// PP-OCR model sets: PaddlePaddle's official ONNX exports on Hugging Face,
// pinned by commit (a resolve URL at a commit SHA never changes), each file
// with its sha256 (the .onnx ones are Hugging Face's LFS oids). The eval
// harness downloads these. The browser never talks to Hugging Face: it loads
// the one set it supports, v6-tiny, from our own origin (PPOCR_BROWSER_MODEL,
// files under public/ppocr/, same bytes and hashes). All Apache-2.0.
// Det/rec constants are the ones in each repo's inference.yml. Sizes and
// provenance: docs/research/ocr-sota-2026.md.

import type { DetParams } from './core'

export interface ModelFile {
  url: string
  bytes: number
  /** sha256 of the file, hex. Every asset has one, dictionaries included. */
  sha256: string
}

export interface PpocrModel {
  id: PpocrModelId
  det: ModelFile & { params: DetParams }
  rec: ModelFile
  /** The rec model's inference.yml, which holds its character list. */
  recYml: ModelFile
}

export type PpocrModelId = 'v6-tiny' | 'v6-small' | 'v5-en-mobile'

const hf = (repo: string, commit: string, file: string) =>
  `https://huggingface.co/PaddlePaddle/${repo}/resolve/${commit}/${file}`

const V6_TINY_DET = '2ba1506c0380b8f0b03dd142459aac66d4421f6c'
const V6_TINY_REC = '2612ab37152ae0a677521bae4e1e3d4fb4cf7c30'
const V6_SMALL_DET = '28fe5895c24fd108c19eb3e8479f4ab385fbfc62'
const V6_SMALL_REC = 'b8f84f0b80c529de40b4fbb3544b84fa7233a513'
const V5_DET = 'e6f4fa85f00e168c862bc462aebca69eef9b3d3d'
const V5_EN_REC = '3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b'

/** PP-OCRv6 det inference.yml: thresh 0.2, box_thresh 0.4, unclip_ratio 1.4. */
const V6_DET: DetParams = { thresh: 0.2, boxThresh: 0.4, unclipRatio: 1.4 }
/** PP-OCRv5 mobile det inference.yml: thresh 0.3, box_thresh 0.6, unclip_ratio 1.5. */
const V5_DET_PARAMS: DetParams = { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 }

export const PPOCR_MODELS: Record<PpocrModelId, PpocrModel> = {
  'v6-tiny': {
    id: 'v6-tiny',
    det: {
      url: hf('PP-OCRv6_tiny_det_onnx', V6_TINY_DET, 'inference.onnx'),
      bytes: 1_780_590,
      sha256: '193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8',
      params: V6_DET,
    },
    rec: {
      url: hf('PP-OCRv6_tiny_rec_onnx', V6_TINY_REC, 'inference.onnx'),
      bytes: 4_462_639,
      sha256: '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6',
    },
    recYml: {
      url: hf('PP-OCRv6_tiny_rec_onnx', V6_TINY_REC, 'inference.yml'),
      bytes: 55_571,
      sha256: '66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1',
    },
  },
  'v6-small': {
    id: 'v6-small',
    det: {
      url: hf('PP-OCRv6_small_det_onnx', V6_SMALL_DET, 'inference.onnx'),
      bytes: 9_880_512,
      sha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e',
      params: V6_DET,
    },
    rec: {
      url: hf('PP-OCRv6_small_rec_onnx', V6_SMALL_REC, 'inference.onnx'),
      bytes: 21_159_378,
      sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
    },
    recYml: {
      url: hf('PP-OCRv6_small_rec_onnx', V6_SMALL_REC, 'inference.yml'),
      bytes: 150_579,
      sha256: 'ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1',
    },
  },
  'v5-en-mobile': {
    id: 'v5-en-mobile',
    det: {
      url: hf('PP-OCRv5_mobile_det_onnx', V5_DET, 'inference.onnx'),
      bytes: 4_826_518,
      sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
      params: V5_DET_PARAMS,
    },
    rec: {
      url: hf('en_PP-OCRv5_mobile_rec_onnx', V5_EN_REC, 'inference.onnx'),
      bytes: 7_848_423,
      sha256: 'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f',
    },
    recYml: {
      url: hf('en_PP-OCRv5_mobile_rec_onnx', V5_EN_REC, 'inference.yml'),
      bytes: 3_964,
      sha256: '27e91d0582f40168aa218303c76e184bc78fa7a5d105aad0cfbad8458b441067',
    },
  },
}

export function isPpocrModelId(s: string): s is PpocrModelId {
  return s in PPOCR_MODELS
}

/** Total download for a model set, in bytes. */
export function modelBytes(m: PpocrModel): number {
  return m.det.bytes + m.rec.bytes + m.recYml.bytes
}

/** Where public/ppocr/<dir>/ is served; the directory name carries both commits. */
export const PPOCR_BROWSER_BASE = `/ppocr/PP-OCRv6_tiny-${V6_TINY_DET.slice(0, 7)}-${V6_TINY_REC.slice(0, 7)}/`

/** The browser's model set: v6-tiny, self-hosted (bigger sets are eval-only). */
export const PPOCR_BROWSER_MODEL: PpocrModel = {
  ...PPOCR_MODELS['v6-tiny'],
  det: { ...PPOCR_MODELS['v6-tiny'].det, url: `${PPOCR_BROWSER_BASE}det.onnx` },
  rec: { ...PPOCR_MODELS['v6-tiny'].rec, url: `${PPOCR_BROWSER_BASE}rec.onnx` },
  recYml: { ...PPOCR_MODELS['v6-tiny'].recYml, url: `${PPOCR_BROWSER_BASE}rec.yml` },
}
