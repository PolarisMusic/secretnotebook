import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

/** `m:ss` from milliseconds. */
function fmt(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface AudioPlayerProps {
  /** URI of the decrypted audio cache file. */
  readonly uri: string;
  /** Known duration from the attachment descriptor; refined once loaded. */
  readonly durationMs?: number | null;
}

/**
 * Inline voice-note player: play/pause, a progress bar, current/total time,
 * and drag-to-scrub. Backed by expo-av; the scrubber uses core PanResponder
 * (not react-native-gesture-handler, which this app keeps out — see
 * components/AppMenu). Native module → not exercised by Jest; verify on device.
 *
 * State that the status callback / pan handlers read live in refs so neither
 * captures a stale render: the playback callback is registered once at load,
 * and the PanResponder is created once.
 */
export function AudioPlayer(props: AudioPlayerProps): JSX.Element {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [totalMs, setTotalMs] = useState(props.durationMs ?? 0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  // false = loudspeaker (default); true = earpiece (private listening).
  // Full AirPlay / Bluetooth route picking requires a native AVRoutePickerView
  // (iOS) or MediaRouteButton (Android) — not yet exposed by expo-av. This
  // toggle uses allowsRecordingIOS (iOS) and playThroughEarpieceAndroid (Android)
  // as a lightweight, JS-only earpiece/speaker switch.
  const [routeEarpiece, setRouteEarpiece] = useState(false);

  const scrubbingRef = useRef(false);
  const scrubMsRef = useRef<number | null>(null);
  const trackWidthRef = useRef(0);
  const totalMsRef = useRef(props.durationMs ?? 0);

  useEffect(() => {
    totalMsRef.current = totalMs;
  }, [totalMs]);

  // Load the sound once per uri; stream status; unload on unmount / uri change.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setPositionMs(0);
    setIsPlaying(false);
    void (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound, status } = await Audio.Sound.createAsync(
          { uri: props.uri },
          { shouldPlay: false, progressUpdateIntervalMillis: 200 },
          (st: AVPlaybackStatus) => {
            if (!st.isLoaded) return;
            setIsPlaying(st.isPlaying);
            if (typeof st.durationMillis === 'number' && st.durationMillis > 0) {
              setTotalMs(st.durationMillis);
            }
            // Don't fight the user's finger while they're scrubbing.
            if (!scrubbingRef.current) setPositionMs(st.positionMillis);
            if (st.didJustFinish) {
              setIsPlaying(false);
              setPositionMs(0);
              void soundRef.current?.setPositionAsync(0);
            }
          },
        );
        if (cancelled) {
          void sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        setLoaded(true);
        if (status.isLoaded && typeof status.durationMillis === 'number') {
          setTotalMs(status.durationMillis);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message ?? 'Could not load audio');
      }
    })();
    return () => {
      cancelled = true;
      const s = soundRef.current;
      soundRef.current = null;
      if (s) void s.unloadAsync();
    };
  }, [props.uri]);

  const toggle = useCallback(async () => {
    const s = soundRef.current;
    if (!s) return;
    try {
      if (isPlaying) {
        await s.pauseAsync();
      } else {
        // Restart from the top if we're sitting at the end.
        if (totalMsRef.current > 0 && positionMs >= totalMsRef.current - 60) {
          await s.setPositionAsync(0);
        }
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: routeEarpiece,
          playThroughEarpieceAndroid: routeEarpiece,
        });
        await s.playAsync();
      }
    } catch (e) {
      setError((e as Error)?.message ?? 'Playback error');
    }
  }, [isPlaying, positionMs, routeEarpiece]);

  const toggleRoute = useCallback(async () => {
    const next = !routeEarpiece;
    setRouteEarpiece(next);
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: next,
        playThroughEarpieceAndroid: next,
      });
    } catch {
      // Non-fatal — routing is best-effort.
    }
  }, [routeEarpiece]);

  const seekFromX = useCallback((x: number) => {
    const w = trackWidthRef.current;
    const tot = totalMsRef.current;
    if (w <= 0 || tot <= 0) return;
    const frac = Math.max(0, Math.min(1, x / w));
    scrubMsRef.current = Math.round(frac * tot);
    setScrubMs(scrubMsRef.current);
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        scrubbingRef.current = true;
        seekFromX(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e: GestureResponderEvent) => seekFromX(e.nativeEvent.locationX),
      onPanResponderRelease: () => {
        const ms = scrubMsRef.current;
        scrubbingRef.current = false;
        scrubMsRef.current = null;
        setScrubMs(null);
        if (ms != null && soundRef.current) {
          void soundRef.current.setPositionAsync(ms);
          setPositionMs(ms);
        }
      },
      onPanResponderTerminate: () => {
        scrubbingRef.current = false;
        scrubMsRef.current = null;
        setScrubMs(null);
      },
    }),
  ).current;

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWidthRef.current = w;
    setTrackWidth(w);
  }, []);

  if (error != null) {
    return (
      <View style={styles.container}>
        <Text style={styles.errText}>Voice note unavailable: {error}</Text>
      </View>
    );
  }

  const shown = scrubMs ?? positionMs;
  const pct = totalMs > 0 ? Math.max(0, Math.min(1, shown / totalMs)) : 0;

  return (
    <View style={styles.container} testID="audio-player">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause voice note' : 'Play voice note'}
        disabled={!loaded}
        hitSlop={8}
        onPress={() => void toggle()}
        style={[styles.playBtn, !loaded && styles.playBtnDisabled]}
        testID="audio-player.toggle"
      >
        <Text style={styles.playGlyph}>{isPlaying ? '⏸' : '▶'}</Text>
      </Pressable>
      <View style={styles.right}>
        <View
          style={styles.track}
          onLayout={onTrackLayout}
          {...pan.panHandlers}
          testID="audio-player.track"
        >
          <View style={styles.trackBg} />
          <View style={[styles.trackFill, { width: trackWidth * pct }]} />
          <View style={[styles.thumb, { left: Math.max(0, trackWidth * pct - 7) }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{fmt(shown)}</Text>
          <Text style={styles.time}>{fmt(totalMs)}</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={routeEarpiece ? 'Switch to speaker' : 'Switch to earpiece'}
        hitSlop={8}
        onPress={() => void toggleRoute()}
        style={styles.routeBtn}
        testID="audio-player.route"
      >
        <Text style={styles.routeGlyph}>{routeEarpiece ? '🔈' : '🔊'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#161616',
    borderRadius: 10,
    padding: 12,
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#9ec5ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnDisabled: { backgroundColor: '#2a2a2a' },
  playGlyph: { color: '#0a0a0a', fontSize: 18, fontWeight: '700' },
  right: { flex: 1, justifyContent: 'center' },
  track: { height: 28, justifyContent: 'center' },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 12,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3a3a3a',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 12,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#9ec5ff',
  },
  thumb: {
    position: 'absolute',
    top: 7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#f5f5f5',
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: '#9e9e9e', fontSize: 12, fontVariant: ['tabular-nums'] },
  errText: { color: '#ffb4b4', fontSize: 14 },
  routeBtn: { padding: 4 },
  routeGlyph: { fontSize: 18 },
});
