import { useState, useEffect, useRef } from "react";
import { useAudioState } from "@/lib/audio-context";
import { api } from "@/lib/api";

/**
 * Returns the audio bitrate (kbps) and codec for the currently
 * playing YouTube Music stream, or null for local tracks.
 *
 * Fetches stream-info from the backend the first time a YT track
 * starts playing and caches results per videoId so repeat plays
 * (e.g. looping) don't trigger extra requests.
 */
export function useStreamBitrate(): {
    bitrate: number | null;
    codec: string | null;
} {
    const { currentTrack, playbackType } = useAudioState();
    const [bitrate, setBitrate] = useState<number | null>(null);
    const [codec, setCodec] = useState<string | null>(null);
    const cacheRef = useRef<Map<string, { abr: number; acodec: string }>>(
        new Map()
    );

    useEffect(() => {
        if (
            playbackType !== "track" ||
            !currentTrack ||
            currentTrack.streamSource !== "youtube" ||
            !currentTrack.youtubeVideoId
        ) {
            setBitrate(null);
            setCodec(null);
            return;
        }

        const videoId = currentTrack.youtubeVideoId;

        // Check cache first
        const cached = cacheRef.current.get(videoId);
        if (cached) {
            setBitrate(cached.abr);
            setCodec(cached.acodec);
            return;
        }

        let cancelled = false;

        api.getYtMusicStreamInfo(videoId)
            .then((info) => {
                if (cancelled) return;
                cacheRef.current.set(videoId, {
                    abr: info.abr,
                    acodec: info.acodec,
                });
                setBitrate(info.abr);
                setCodec(info.acodec);
            })
            .catch(() => {
                // Silently ignore — bitrate display is best-effort
                if (!cancelled) {
                    setBitrate(null);
                    setCodec(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [currentTrack, playbackType]);

    return { bitrate, codec };
}
