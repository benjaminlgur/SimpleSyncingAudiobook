import TrackPlayer from "react-native-track-player";
import { PlaybackService } from "./lib/trackPlayerService";

TrackPlayer.registerPlaybackService(() => PlaybackService);

import "expo-router/entry";
