import TrackPlayer, { Event } from "react-native-track-player";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { capturePlaybackPosition, flushPlaybackSession, getPlaybackSession, recordNativePosition, syncPlaybackState } from "./playbackSession";

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => { void syncPlaybackState(state); });
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (event) => {
    const session = getPlaybackSession();
    if (session) recordNativePosition(session, event.track, event.position);
  });
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => { void flushPlaybackSession(); });
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => { void flushPlaybackSession(); });
  AppState.addEventListener("change", (state) => {
    if (state !== "active") void flushPlaybackSession();
  });
  NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable) void flushPlaybackSession();
  });
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    await TrackPlayer.pause();
    await TrackPlayer.seekTo(0);
    await flushPlaybackSession();
  });
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try {
      await TrackPlayer.skipToNext();
    } catch {
      // No next track.
    }
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try {
      await TrackPlayer.skipToPrevious();
    } catch {
      // No previous track.
    }
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, async (event) => {
    await TrackPlayer.seekTo(event.position);
    await flushPlaybackSession();
  });
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async (event) => {
    const position = await TrackPlayer.getPosition();
    await TrackPlayer.seekTo(position + event.interval);
    await capturePlaybackPosition();
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (event) => {
    const position = await TrackPlayer.getPosition();
    await TrackPlayer.seekTo(Math.max(0, position - event.interval));
    await capturePlaybackPosition();
  });
}
