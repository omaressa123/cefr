import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Directory, Paths } from "expo-file-system";

// Pending offline turns: WAV audio + on-device transcript, waiting to be
// resubmitted to the backend for retroactive grammar assessment once the
// network returns. We resubmit the AUDIO (not just the transcript) so the
// server-side pipeline (verbatim STT + analyzeGrammar 11-category taxonomy)
// runs exactly as if the turn had been online in the first place.
const QUEUE_KEY = "cefr_offline_turn_queue_v1";

async function readQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeQueue(list) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(list));
}

// Persist a recording for later resubmission. Copies the WAV out of the
// volatile capture location into the documents directory first.
export async function enqueueOfflineTurn({ sessionId, wavUri, transcript }) {
  const dir = new Directory(Paths.document, "offline-stt", "pending");
  try {
    dir.create();
  } catch {
    // Already exists.
  }
  const name = `pending-${Date.now()}.wav`;
  const kept = new File(dir, name);
  await new File(wavUri).copy(kept);
  const entry = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    sessionId,
    wavUri: kept.uri,
    transcript,
    createdAt: new Date().toISOString(),
  };
  const list = await readQueue();
  list.push(entry);
  await writeQueue(list);
  return entry;
}

export async function listPendingTurns() {
  return readQueue();
}

export async function countPendingTurns() {
  return (await readQueue()).length;
}

async function removeEntries(ids) {
  const kept = (await readQueue()).filter((e) => !ids.includes(e.id));
  await writeQueue(kept);
}

// Resubmit every queued turn's AUDIO through the normal backend path so it
// receives full grammar assessment. onAssessed(entry, result) lets the UI
// replace the transcription-only turn with the assessed one. Returns
// { assessed: [ids], failed: [ids] }. Stops at the first network failure so
// a dead connection doesn't burn through the queue with errors.
export async function flushPendingTurns(api, onAssessed) {
  const pending = await readQueue();
  const assessed = [];
  const failed = [];
  for (const entry of pending) {
    const formData = new FormData();
    formData.append("audio", { uri: entry.wavUri, name: "turn.wav", type: "audio/wav" });
    try {
      const result = await api.submitAudioTurn(entry.sessionId, formData);
      if (onAssessed) await onAssessed(entry, result);
      try {
        new File(entry.wavUri).delete();
      } catch {
        // Best effort; the queue entry is what matters.
      }
      assessed.push(entry.id);
    } catch (err) {
      failed.push(entry.id);
      if (err && (err.isNetworkError || err.isTimeout)) break;
    }
  }
  await removeEntries(assessed);
  return { assessed, failed };
}
