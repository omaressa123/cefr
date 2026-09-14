import Constants from "expo-constants";
import { File, Directory, Paths } from "expo-file-system";
import { API_BASE_URL } from "../api/client.js";

// Phase 2 verdict (eval/verbatim-test/RESULTS.md): q5_1 is the smallest
// quantization preserving baseline verbatim behavior on all 8 test clips
// (8/8 identical to f16, no grammar autocorrection, noisy-clip parity) at
// 190,118,819 bytes (~181 MiB) vs 466 MiB baseline. q4_0/q5_0 were rejected:
// both deterministically normalize t07 CHILDRENS -> CHILDREN'S, breaking
// character-for-character fidelity — never trade that for file size.
export const OFFLINE_MODEL_FILENAME = "ggml-verbatim-small-q5_1.bin";
export const OFFLINE_MODEL_BYTES = 190118819;
// Same conditioning prompt the backend sends (backend/src/core/audio.js) and
// scripts/whisper-server.py uses. Phase 2 showed decoding without it can flip
// ambiguous words (store/story); pass it on-device too.
export const VERBATIM_CONDITIONING_PROMPT =
  "Umm, well, he don't like it. I goed to the store...";

function defaultModelUrl() {
  const base = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
  return `${base}/models/${OFFLINE_MODEL_FILENAME}`;
}

export function offlineModelUrl() {
  return process.env.EXPO_PUBLIC_OFFLINE_STT_MODEL_URL || defaultModelUrl();
}

export function isOfflineSttSupported() {
  // whisper.rn is a native module: it cannot load under Expo Go or web.
  // It requires a dev-client (or release) build via `npx expo prebuild`.
  if (Constants.appOwnership === "expo") return false;
  return true;
}

let whisperContextPromise = null;

async function loadWhisperContext(filePath) {
  // Lazy require so the rest of the app (and Expo Go) can import this module
  // without the native module being present.
  const { initWhisper } = require("whisper.rn");
  return initWhisper({ filePath });
}

// Downloads the model on first use (181 MB: too large to bundle — it would
// ~5x the install size and risk the iOS 200 MB cellular-install limit, so
// on-demand download like whisper.rn's own example app). Resolves with the
// local file:// uri. onProgress receives { bytesWritten, totalBytes }.
export async function ensureOfflineModel(onProgress) {
  const dir = new Directory(Paths.document, "offline-stt");
  try {
    dir.create();
  } catch {
    // Already exists.
  }
  const dest = new File(dir, OFFLINE_MODEL_FILENAME);
  if (dest.exists && dest.size === OFFLINE_MODEL_BYTES) return dest.uri;
  if (dest.exists) {
    try {
      dest.delete();
    } catch {
      // Best effort; the download overwrites anyway.
    }
  }
  const file = await File.downloadFileAsync(offlineModelUrl(), dest, {
    idempotent: true,
    onProgress,
  });
  if (!file.exists || file.size !== OFFLINE_MODEL_BYTES) {
    try {
      file.delete();
    } catch {
      // Best effort cleanup of a truncated download.
    }
    throw new Error(
      `Model download incomplete (got ${file.size ?? 0} of ${OFFLINE_MODEL_BYTES} bytes).`
    );
  }
  return file.uri;
}

// Transcribe a 16 kHz mono WAV file (see captureWav.js) fully on-device.
// Returns the transcript string with grammar mistakes preserved verbatim.
export async function transcribeOffline(wavUri) {
  if (!isOfflineSttSupported()) {
    throw new Error("On-device transcription needs a dev-client build (Expo Go has no native modules).");
  }
  const modelUri = await ensureOfflineModel();
  if (!whisperContextPromise) whisperContextPromise = loadWhisperContext(modelUri);
  const ctx = await whisperContextPromise;
  const { promise } = ctx.transcribe(wavUri, {
    language: "en",
    prompt: VERBATIM_CONDITIONING_PROMPT,
  });
  const { result } = await promise;
  return (result || "").trim();
}

export async function releaseOfflineStt() {
  // whisper.rn contexts expose release(); drop the singleton either way.
  whisperContextPromise = null;
}
