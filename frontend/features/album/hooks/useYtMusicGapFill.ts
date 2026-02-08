/**
 * useYtMusicGapFill — enriches unowned album tracks with YouTube Music
 * streaming data (streamSource + youtubeVideoId).
 *
 * When the user has YouTube Music connected, this hook matches unowned
 * tracks against YTMusic and marks them as streamable so the player
 * can stream them via the backend proxy instead of showing a 30s preview.
 */

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { api } from "@/lib/api";
import type { Album, Track } from "../types";
import type { AlbumSource } from "../types";

interface YtMusicMatch {
    videoId: string;
    title: string;
    duration: number;
}

export function useYtMusicGapFill(
    album: Album | null | undefined,
    source: AlbumSource | null
) {
    const [matches, setMatches] = useState<Record<string, YtMusicMatch>>({});
    const [loading, setLoading] = useState(false);
    const matchedAlbumIdRef = useRef<string | null>(null);
    const [ytMusicAvailable, setYtMusicAvailable] = useState(false);

    // Check YTMusic status once
    useEffect(() => {
        let cancelled = false;
        api.getYtMusicStatus()
            .then((status) => {
                if (!cancelled) {
                    setYtMusicAvailable(
                        status.enabled && status.available && status.authenticated
                    );
                }
            })
            .catch(() => {
                if (!cancelled) setYtMusicAvailable(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Find unowned tracks that need matching
    const unownedTracks = useMemo(() => {
        if (!album?.tracks || !ytMusicAvailable) return [];
        if (source === "library") {
            // For library albums, all tracks are owned — no gap fill needed
            // (In the future we could check per-track ownership for partial albums)
            return [];
        }
        // Discovery album — all tracks are unowned
        return album.tracks;
    }, [album?.tracks, album?.id, source, ytMusicAvailable]);

    // Match unowned tracks against YTMusic
    useEffect(() => {
        if (!unownedTracks.length || !album?.id) return;
        // Don't re-match if we already matched this album
        if (matchedAlbumIdRef.current === album.id) return;

        let cancelled = false;
        matchedAlbumIdRef.current = album.id;
        setLoading(true);

        const matchTracks = async () => {
            const newMatches: Record<string, YtMusicMatch> = {};

            // Match tracks in parallel with a concurrency limit
            const BATCH_SIZE = 5;
            for (let i = 0; i < unownedTracks.length; i += BATCH_SIZE) {
                if (cancelled) break;
                const batch = unownedTracks.slice(i, i + BATCH_SIZE);
                const results = await Promise.allSettled(
                    batch.map((track) =>
                        api.matchYtMusicTrack(
                            track.artist?.name || album?.artist?.name || "",
                            track.title,
                            album?.title
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
            console.error("[YTMusic Gap-Fill] Matching failed:", err);
            if (!cancelled) setLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, [unownedTracks, album?.id, album?.title, album?.artist?.name]);

    // Produce enriched tracks with streamSource + youtubeVideoId
    const enrichedTracks = useMemo((): Track[] | undefined => {
        if (!album?.tracks) return undefined;
        if (Object.keys(matches).length === 0) return album.tracks;

        return album.tracks.map((track) => {
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
    }, [album?.tracks, matches]);

    // Reset when album changes
    const reset = useCallback(() => {
        matchedAlbumIdRef.current = null;
        setMatches({});
    }, []);

    return {
        enrichedTracks,
        isMatching: loading,
        ytMusicAvailable,
        matchCount: Object.keys(matches).length,
        reset,
    };
}
