import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/useQueries";
import { api } from "@/lib/api";
import { useDownloadContext } from "@/lib/download-context";
import { ArtistSource } from "../types";
import { useMemo, useEffect, useRef, useState } from "react";

export function useArtistData() {
    const params = useParams();
    const id = params.id as string;
    const { downloadStatus } = useDownloadContext();
    const prevActiveCountRef = useRef(downloadStatus.activeDownloads.length);
    const retryCountRef = useRef(0);
    const MAX_DISCOGRAPHY_RETRIES = 3;

    // Use React Query - no polling needed, webhook events trigger refresh via download context
    const {
        data: artist,
        isLoading,
        isError,
        refetch,
    } = useQuery({
        queryKey: queryKeys.artist(id || ""),
        queryFn: async () => {
            if (!id) throw new Error("Artist ID is required");
            try {
                return await api.getArtist(id);
            } catch {
                return await api.getArtistDiscovery(id);
            }
        },
        enabled: !!id,
        staleTime: (query) => {
            // If discography failed to load, mark as immediately stale
            // so it re-fetches on next mount/navigation
            const data = query.state.data as any;
            if (data?.discographyComplete === false) return 0;
            return 10 * 60 * 1000;
        },
        retry: 1,
    });

    // If discography was incomplete (MusicBrainz failed), automatically retry
    // with exponential backoff up to MAX_DISCOGRAPHY_RETRIES times
    useEffect(() => {
        if (!artist || isLoading) return;

        // Only retry for library artists where discography fetch failed
        const isLibrary = artist.id && !artist.id.includes("-");
        if (!isLibrary) return;

        if (artist.discographyComplete === false && retryCountRef.current < MAX_DISCOGRAPHY_RETRIES) {
            const delay = Math.min(2000 * Math.pow(2, retryCountRef.current), 10000);
            const timeoutId = setTimeout(() => {
                retryCountRef.current += 1;
                refetch();
            }, delay);
            return () => clearTimeout(timeoutId);
        }

        // Reset retry count when we get complete data or switch artists
        if (artist.discographyComplete !== false) {
            retryCountRef.current = 0;
        }
    }, [artist, isLoading, refetch]);

    // Reset retry counter when navigating to a different artist
    useEffect(() => {
        retryCountRef.current = 0;
    }, [id]);

    // Refetch when downloads complete (active count decreases)
    useEffect(() => {
        const currentActiveCount = downloadStatus.activeDownloads.length;
        if (
            prevActiveCountRef.current > 0 &&
            currentActiveCount < prevActiveCountRef.current
        ) {
            // Downloads have completed, refresh data
            refetch();
        }
        prevActiveCountRef.current = currentActiveCount;
    }, [downloadStatus.activeDownloads.length, refetch]);

    // Determine source from the artist data (if it came from library or discovery)
    const source: ArtistSource | null = useMemo(() => {
        if (!artist) return null;
        return artist.id && !artist.id.includes("-") ? "library" : "discovery";
    }, [artist]);

    // Sort state: 'year' or 'dateAdded'
    const [sortBy, setSortBy] = useState<"year" | "dateAdded">("year");

    // Sort albums by year or dateAdded (auto-memoized by React Compiler)
    const albums = !artist?.albums
        ? []
        : [...artist.albums].sort((a, b) => {
              if (sortBy === "dateAdded") {
                  if (!a.lastSynced && !b.lastSynced) return 0;
                  if (!a.lastSynced) return 1;
                  if (!b.lastSynced) return -1;
                  return (
                      new Date(b.lastSynced).getTime() -
                      new Date(a.lastSynced).getTime()
                  );
              } else {
                  if (a.year == null && b.year == null) return 0;
                  if (a.year == null) return 1;
                  if (b.year == null) return -1;
                  return b.year - a.year;
              }
          });

    // Handle errors - only show toast once, don't auto-navigate
    // The page component should handle displaying a "not found" state
    // Don't call router.back() as it causes navigation loops

    return {
        artist,
        albums,
        loading: isLoading,
        error: isError,
        source,
        sortBy,
        setSortBy,
        reloadArtist: refetch,
    };
}
