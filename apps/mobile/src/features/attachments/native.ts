import { base64ToBytes, bytesToBase64 } from '@secretnotebook/crypto';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import type { AudioRecorder, FileStore, MediaSource, PickedMedia } from './types';

/**
 * Production wiring for the attachment seams. These are the only modules that
 * touch native (expo-image-picker / expo-av / expo-file-system); everything
 * else in the attachments feature is pure and Node-tested. They cannot run
 * under Jest (no native runtime) — verify on device per apps/mobile/RUNBOOK.md.
 */

const ENC_DIR = `${FileSystem.documentDirectory ?? ''}attachments/`;
const CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}attachments/`;

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/** FileStore backed by expo-file-system (base64 bridge for binary IO). */
export function createExpoFileStore(): FileStore {
  return {
    async readFile(uri: string): Promise<Uint8Array> {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return base64ToBytes(b64);
    },
    async writeEncryptedFile(name: string, bytes: Uint8Array): Promise<string> {
      await ensureDir(ENC_DIR);
      const uri = `${ENC_DIR}${name}`;
      await FileSystem.writeAsStringAsync(uri, await bytesToBase64(bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      return uri;
    },
    async writeCacheFile(name: string, bytes: Uint8Array): Promise<string> {
      await ensureDir(CACHE_DIR);
      const uri = `${CACHE_DIR}${name}`;
      await FileSystem.writeAsStringAsync(uri, await bytesToBase64(bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      return uri;
    },
    async remove(uri: string): Promise<void> {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    },
  };
}

function pickedFromAsset(asset: ImagePicker.ImagePickerAsset): PickedMedia {
  return {
    uri: asset.uri,
    mediaType: 'image',
    mimeType: asset.mimeType ?? 'image/jpeg',
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
  };
}

/** MediaSource backed by expo-image-picker (library + camera). */
export function createExpoMediaSource(): MediaSource {
  return {
    async pickImage(): Promise<PickedMedia | null> {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return null;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      const asset = res.canceled ? undefined : res.assets[0];
      return asset ? pickedFromAsset(asset) : null;
    },
    async captureImage(): Promise<PickedMedia | null> {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return null;
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      const asset = res.canceled ? undefined : res.assets[0];
      return asset ? pickedFromAsset(asset) : null;
    },
  };
}

/** AudioRecorder backed by expo-av. One active recording at a time. */
export function createExpoAudioRecorder(): AudioRecorder {
  let recording: Audio.Recording | null = null;

  return {
    async start(): Promise<void> {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) throw new Error('microphone permission denied');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recording = rec;
    },
    async stop(): Promise<PickedMedia | null> {
      if (!recording) return null;
      const rec = recording;
      recording = null;
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) return null;
      const status = await rec.getStatusAsync();
      const durationMs =
        typeof status.durationMillis === 'number' ? status.durationMillis : undefined;
      return {
        uri,
        mediaType: 'audio',
        mimeType: 'audio/m4a',
        ...(durationMs != null ? { durationMs } : {}),
      };
    },
    async cancel(): Promise<void> {
      if (!recording) return;
      const rec = recording;
      recording = null;
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        // best effort — already stopped/unloaded
      }
    },
  };
}

/** Play a decrypted audio cache file through expo-av; resolves when done. */
export async function playAudioFile(uri: string): Promise<void> {
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  sound.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded && status.didJustFinish) {
      void sound.unloadAsync();
    }
  });
}
