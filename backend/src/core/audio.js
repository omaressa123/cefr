import { config } from "../config.js";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

// --- Speech-to-text --------------------------------------------------------
// Provider-agnostic: point STT_BASE_URL / STT_API_KEY at any OpenAI-compatible
// /audio/transcriptions endpoint (Groq's Whisper endpoint matches this shape
// directly). This file does not implement a model - it's the wire only.
//
// Whisper Prompt Conditioning (per the original spec): STT models tend to
// auto-correct bad grammar, which erases exactly the errors we want to
// assess. We pass a deliberately flawed prompt so the model is nudged to
// transcribe morphological errors verbatim rather than "fixing" them.
const WHISPER_CONDITIONING_PROMPT = "Umm, well, he don't like it. I goed to the store...";

export async function transcribe(audioBuffer, mimeType = "audio/webm") {
  if (!config.stt.baseUrl) {
    throw new Error(
      "STT provider not configured. Set STT_BASE_URL in backend/.env."
    );
  }

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mimeType }), "audio.webm");
  form.append("model", config.stt.model);
  form.append("prompt", WHISPER_CONDITIONING_PROMPT);

  const headers = {};
  if (config.stt.apiKey) {
    headers.Authorization = `Bearer ${config.stt.apiKey}`;
  }

  const res = await fetch(`${config.stt.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`STT call failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.text ?? "";
}

// --- Text-to-speech ---------------------------------------------------------
// Real, working implementation using the free Microsoft Edge voices via the
// msedge-tts package - matches the original spec's TTS choice exactly, and
// needs no API key or model of its own.
export async function synthesize(text, voice = config.tts.voice) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text);

  const chunks = [];
  for await (const chunk of audioStream) chunks.push(chunk);
  return Buffer.concat(chunks); // MP3 bytes
}
