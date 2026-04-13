/**
 * Voice transcription via Groq Whisper API (free, fast).
 * Records audio with expo-audio, sends m4a to Groq /audio/transcriptions.
 */
import { API_BASE } from './api';
import * as SecureStore from 'expo-secure-store';

const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export async function transcribeAudio(audioUri: string): Promise<string> {
  // We proxy through our own backend so the Groq key stays server-side
  const token = await SecureStore.getItemAsync('access_token');

  const form = new FormData();
  form.append('file', {
    uri: audioUri,
    name: 'recording.m4a',
    type: 'audio/m4a',
  } as any);

  const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Transcription failed: ${res.status}`);
  const data = await res.json();
  return data.text as string;
}
