import { useRef } from "react";
import { Platform } from "react-native";
import { Audio } from "expo-av";
import {
  useAudioStream,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { File, Directory, Paths } from "expo-file-system";

const { IOSOutputFormat, IOSAudioQuality, AndroidOutputFormat, AndroidAudioEncoder } = Audio;

// 16 kHz mono 16-bit WAV: the one capture format consumed by BOTH the
// backend upload path (backend accepts audio/wav, decoded via the soundfile
// fast path) and the on-device whisper.rn fallback (WAV-only input).
export const CAPTURE_SAMPLE_RATE = 16000;
// Matches the server-side 30 s whisper window (scripts/whisper-server.py).
const MAX_SAMPLES = 30 * CAPTURE_SAMPLE_RATE;

// iOS records Linear PCM directly via expo-av (AVAudioRecorder supports it
// natively). Android's MediaRecorder has no PCM/WAV container, so Android
// captures raw PCM via expo-audio's AudioStream and assembles the WAV in JS.
const IOS_WAV_PRESET = {
  isMeteringEnabled: false,
  android: {
    extension: ".m4a",
    outputFormat: AndroidOutputFormat.MPEG_4,
    audioEncoder: AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
  },
  ios: {
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: IOSAudioQuality.MAX,
    sampleRate: CAPTURE_SAMPLE_RATE,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

function writeWavHeader(view, numSamples) {
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, CAPTURE_SAMPLE_RATE, true);
  view.setUint32(28, CAPTURE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, numSamples * 2, true);
}

function resampleLinear(input, fromRate) {
  if (fromRate === CAPTURE_SAMPLE_RATE) return input;
  const ratio = CAPTURE_SAMPLE_RATE / fromRate;
  const outLen = Math.floor(input.length * ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(input[i0] * (1 - frac) + input[i1] * frac);
  }
  return out;
}

// Single capture API for both platforms. Returns { uri } of a 16 kHz mono
// WAV file in the app cache directory.
export function useWavCapture() {
  const iosRecording = useRef(null);
  const pcmChunks = useRef([]);

  // Always instantiated (hooks can't be conditional); only started on
  // Android, where expo-av cannot produce WAV.
  const audioStream = useAudioStream({
    sampleRate: CAPTURE_SAMPLE_RATE,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => {
      pcmChunks.current.push({
        data: buffer.data.slice(0),
        sampleRate: buffer.sampleRate,
        channels: buffer.channels,
      });
    },
  });

  async function startCapture() {
    pcmChunks.current = [];
    if (Platform.OS === "ios") {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) throw new Error("Microphone permission was denied.");
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(IOS_WAV_PRESET);
      iosRecording.current = recording;
    } else if (Platform.OS === "android") {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) throw new Error("Microphone permission was denied.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioStream.stream.start();
    } else {
      throw new Error("Audio capture is only supported on iOS and Android.");
    }
  }

  async function stopCapture() {
    if (Platform.OS === "ios") {
      const rec = iosRecording.current;
      iosRecording.current = null;
      if (!rec) throw new Error("No recording in progress.");
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) throw new Error("Recording produced no file.");
      return { uri };
    }

    // Android: assemble the captured PCM chunks into a 16 kHz mono WAV.
    try {
      audioStream.stream.stop();
    } catch {
      // Continue with whatever was captured before the error.
    }
    const chunks = pcmChunks.current;
    pcmChunks.current = [];
    if (chunks.length === 0) throw new Error("No audio was captured.");

    let mono;
    {
      const parts = [];
      let total = 0;
      const rate = chunks[0].sampleRate;
      for (const c of chunks) {
        const samples = new Int16Array(c.data);
        if (c.channels === 1) {
          parts.push(samples);
          total += samples.length;
        } else {
          const mixed = new Int16Array(samples.length / c.channels);
          for (let i = 0; i < mixed.length; i++) {
            let sum = 0;
            for (let ch = 0; ch < c.channels; ch++) sum += samples[i * c.channels + ch];
            mixed[i] = Math.round(sum / c.channels);
          }
          parts.push(mixed);
          total += mixed.length;
        }
      }
      const concat = new Int16Array(total);
      let off = 0;
      for (const p of parts) {
        concat.set(p, off);
        off += p.length;
      }
      mono = resampleLinear(concat, rate);
    }
    const clipped = mono.length > MAX_SAMPLES ? mono.slice(0, MAX_SAMPLES) : mono;
    const bytes = new Uint8Array(44 + clipped.length * 2);
    const view = new DataView(bytes.buffer);
    writeWavHeader(view, clipped.length);
    for (let i = 0; i < clipped.length; i++) view.setInt16(44 + i * 2, clipped[i], true);

    const dir = new Directory(Paths.cache, "cefr-turns");
    try {
      dir.create();
    } catch {
      // Already exists.
    }
    const file = new File(dir, `turn-${Date.now()}.wav`);
    file.write(bytes);
    return { uri: file.uri };
  }

  return { startCapture, stopCapture };
}
