/**
 * useVoiceInput — records audio, sends to Groq Whisper via backend proxy,
 * returns transcribed text.
 *
 * States: idle → recording → transcribing → idle
 */
import { useState, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { transcribeAudio } from '../services/whisper';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

export function useVoiceInput(onResult: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const startRecording = useCallback(async () => {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Microphone access is required for voice input.');
        return;
      }
      await recorder.record();
      setState('recording');
    } catch (e) {
      Alert.alert('Error', 'Could not start recording.');
    }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    if (state !== 'recording') return;
    setState('transcribing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No audio file');
      const text = await transcribeAudio(uri);
      if (text.trim()) onResult(text.trim());
    } catch (e) {
      Alert.alert('Transcription failed', 'Could not understand audio. Please try again.');
    }
    setState('idle');
  }, [state, recorder, onResult]);

  const toggle = useCallback(() => {
    if (state === 'idle') startRecording();
    else if (state === 'recording') stopRecording();
  }, [state, startRecording, stopRecording]);

  return { state, toggle };
}
