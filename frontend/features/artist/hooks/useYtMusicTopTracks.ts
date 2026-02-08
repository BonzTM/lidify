/**
 * useYtMusicTopTracks — enriches unowned artist top-tracks with
 * YouTube Music streaming data (streamSource + youtubeVideoId).
 *
 * This is the artist-page counterpart of album/useYtMusicGapFill.
 * It uses the same global status cache so we don't re-check on every
 * page navigation, and batches matching requests for performance.
 */

import { useEffect, useState, useRef, useMemo } from "react";
import { api } from "@/lib/api";
import type { Track, Artist } from "../types";

// Re-use the global status cache from album gap-fill
import { invalidateYtMusicStatusCache } from "@/features/album/hooks/useYtMusicGapFill";
export { invalidateYtMusicStatusCache };

interface YtMusicMatch {
    videoId: string;
    title: string;
    duration: number;
}

// ── Global YT Music status cache (shared with useYtMusicGapFill) ──
// Duplicated here to avoid a circular import – both modules write
// to their own variable but the TTL keeps them in sync.
let _ytStatusCache: { available: boolean; checkedAt: number } | null = null;
const YT_STATUS_CACHE_TTL = 60_000;

async function getYtMusicAvailable(): Promise<boolean> {
    const now = Date.now();
    if (_ytStatusCache && now - _ytStatusCache.checkedAt < YT_STATUS_CACHE_TTL) {
        return _ytStatusCache.available;
    }
    try {
        const status = await api.getYtMusicStatus();
        const available =
            status.enabled && status.available && status.authenticated;
        _ytStatusCache = { available, checkedAt: now };
        return available;
    } catch {
        _ytStatusCache = { available: false, checkedAt: now };
        return false;
    }
}

export function useYtMusicTopTracks(artist: Artist | null | undefined) {
    const [matches, setMatches] = useState<Record<string, YtMusicMatch>>({});
    const [loading, setLoading] = useState(false);
    const matchedArtistIdRef = useRef<string | null>(null);
    const [ytMusicAvailable, setYtMusicAvailable] = useState(
        _ytStatusCache?.available ?? false
    );

    // Check YTMusic availability (uses global cache)
    useEffect(() => {
        let cancelled = false;
        getYtMusicAvailable().then((available) => {
            if (!cancelled) setYtMusicAvailable(available);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Identify unowned tracks that need matching
    const unownedTracks = useMemo(() => {
        if (!ytMusicAvailable || !artist?.topTracks) return [];

        return artist.topTracks.filter(
            (t) =>
                !t.album?.id ||
                !t.album?.title ||
                t.album.title === "Unknown Album"
        );
    }, [artist?.topTracks, artist?.id, ytMusicAvailable]);

    // Match unowned tracks against YTMusic
    useEffect(() => {
        if (!unownedTracks.length || !artist?.id) return;
        if (matchedArtistIdRef.current === artist.id) return;

        let cancelled = false;
        matchedArtistIdRef.current = artist.id;
        setLoading(true);

        const matchTracks = async () => {
            const newMatches: Record<string, YtMusicMatch> = {};
            const BATCH_SIZE = 10;

            for (let i = 0; i < unownedTracks.length; i += BATCH_SIZE) {
                if (cancelled) break;
                const batch = unownedTracks.slice(i, i + BATCH_SIZE);
                const results = await Promise.allSettled(
                    batch.map((track) =>
                        api.matchYtMusicTrack(
                            track.artist?.name || artist?.name || "",
                            track.title
                            // No album title for top-tracks
                        )
                    )
                );

                results.forEach((result, idx) => {
                    if (
                        result.status === "fulfilled" &&
                        result.value.match
                    ) {
                        newMatches[batch[idx].id] = result.value.match;
                    }
                });
            }

            if (!cancelled) {
                setMatches(newMatches);
                setLoading(false);
            }
        };

        matchTracks().catch((err) => {
            console.error("[YTMusic TopTracks] Matching failed:", err);
            if (!cancelled) setLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, [unownedTracks, artist?.id, artist?.name]);

    // Produce enriched top-tracks with streamSource + youtubeVideoId
    const enrichedTopTracks = useMemo((): Track[] | undefined => {
        if (!artist?.topTracks) return undefined;
        if (Object.keys(matches).length === 0) return artist.topTracks;

        return artist.topTracks.map((track) => {
            const match = matches[track.id];
            if (match) {
                return {
                    ...track,
                    streamSource: "youtube" as const,
                    youtubeVideoId: match.videoId,
                };
            }
            return track;
        });
    }, [artist?.topTracks, matches]);

    return {
        enrichedTopTracks,
        isMatching: loading,
        ytMusicAvailable,
        matchCount: Object.keys(matches).length,
    };
}
