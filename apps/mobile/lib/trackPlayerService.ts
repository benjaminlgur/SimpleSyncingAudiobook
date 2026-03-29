import TrackPlayer, { Event } from "react-native-track-player";

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    await TrackPlayer.pause();
    await TrackPlayer.seekTo(0);
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
  });
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async (event) => {
    const position = await TrackPlayer.getPosition();
    await TrackPlayer.seekTo(position + event.interval);
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (event) => {
    const position = await TrackPlayer.getPosition();
    await TrackPlayer.seekTo(Math.max(0, position - event.interval));
  });
}
