"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/utils/cn";
import { api } from "@/lib/api";
import { useFeatures } from "@/lib/features-context";
import Image from "next/image";
import {
    Loader2,
    RefreshCw,
    AlertCircle,
    Disc3,
    Zap,
    Heart,
    Music2,
    Mic2,
    Waves,
    Activity,
    Play,
    Search,
    Shuffle,
    ChevronRight,
} from "lucide-react";

// ============================================
// TYPES
// ============================================

interface TrackFeatures {
    energy: number;
    valence: number;
    arousal: number;
    danceability: number;
    instrumentalness: number;
    acousticness: number;
    speechiness: number;
    bpm: number | null;
    key: string | null;
}

interface TrackData {
    id: string;
    title: string;
    artist: string;
    artistId: string;
    album: string;
    albumId: string;
    coverUrl: string | null;
    duration: number;
    features: TrackFeatures;
    distance?: number;
    similarity?: number;
}

interface LibraryTrack {
    id: string;
    title: string;
    duration: number;
    album: {
        id: string;
        title: string;
        coverUrl?: string | null;
        coverArt?: string | null;
        artist: { id: string; name: string };
    };
}

interface VibePlaylist {
    id: string;
    name: string;
    description: string;
    query: string;
    gradient: string;
}

type ViewMode = "comparison" | "search-results";

const AUDIO_FEATURES = [
    { key: "energy", label: "Energy", icon: Zap, color: "#f59e0b" },
    { key: "valence", label: "Mood", icon: Heart, color: "#ec4899" },
    { key: "danceability", label: "Groove", icon: Music2, color: "#a855f7" },
    { key: "acousticness", label: "Acoustic", icon: Waves, color: "#22c55e" },
    { key: "instrumentalness", label: "Instrumental", icon: Mic2, color: "#3b82f6" },
    { key: "arousal", label: "Intensity", icon: Activity, color: "#ef4444" },
];

const VIBE_PLAYLISTS: VibePlaylist[] = [
    { id: "chill", name: "Chill Vibes", description: "Relaxing and calm", query: "relaxing calm ambient peaceful mellow", gradient: "from-cyan-600 to-blue-800" },
    { id: "energy", name: "High Energy", description: "Pump up the volume", query: "energetic powerful intense driving upbeat", gradient: "from-orange-500 to-red-700" },
    { id: "dark", name: "Dark & Moody", description: "Atmospheric depths", query: "dark atmospheric moody brooding cinematic", gradient: "from-slate-700 to-slate-900" },
    { id: "happy", name: "Feel Good", description: "Bright and uplifting", query: "happy upbeat cheerful bright positive", gradient: "from-yellow-400 to-orange-500" },
    { id: "melancholic", name: "Melancholic", description: "Emotional journeys", query: "sad melancholic emotional nostalgic bittersweet", gradient: "from-indigo-600 to-purple-900" },
    { id: "electronic", name: "Electronic", description: "Synths and beats", query: "electronic synth digital pulsing techno", gradient: "from-fuchsia-600 to-purple-800" },
];

function distanceToSimilarity(distance: number): number {
    return Math.max(0, 1 - distance / 2);
}

// ============================================
// COVER IMAGE COMPONENT
// ============================================
function CoverImage({
    coverUrl,
    albumId,
    title,
    size = 160,
    className,
    priority = false,
}: {
    coverUrl: string | null;
    albumId?: string;
    title: string;
    size?: number;
    className?: string;
    priority?: boolean;
}) {
    const [hasError, setHasError] = useState(false);

    const imgSrc = useMemo(() => {
        if (coverUrl) {
            return api.getCoverArtUrl(coverUrl);
        }
        if (albumId) {
            return api.getCoverArtUrl(`native:albums/${albumId}.jpg`);
        }
        return null;
    }, [coverUrl, albumId]);

    if (!imgSrc || hasError) {
        return (
            <div
                className={cn("bg-[#282828] flex items-center justify-center", className)}
                style={{ width: size, height: size }}
            >
                <Disc3 className="text-gray-600" style={{ width: size * 0.35, height: size * 0.35 }} />
            </div>
        );
    }

    return (
        <div className={cn("relative overflow-hidden", className)} style={{ width: size, height: size }}>
            <Image
                src={imgSrc}
                alt={title}
                fill
                sizes={`${size}px`}
                className="object-cover"
                priority={priority}
                unoptimized
                onError={() => setHasError(true)}
            />
        </div>
    );
}

// ============================================
// EMBEDDING VISUALIZATION
// ============================================
function EmbeddingVisualization({
    source,
    match,
}: {
    source: TrackData;
    match: TrackData;
}) {
    const similarity = match.similarity || 0;

    return (
        <div className="relative py-8">
            {/* Connection lines */}
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#ecb200" stopOpacity="0.6" />
                        <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.6" />
                    </linearGradient>
                </defs>
                {AUDIO_FEATURES.map((feature, i) => {
                    const sourceVal = source.features[feature.key as keyof TrackFeatures] as number || 0.5;
                    const matchVal = match.features[feature.key as keyof TrackFeatures] as number || 0.5;
                    const featureSimilarity = 1 - Math.abs(sourceVal - matchVal);
                    const yOffset = 20 + i * 16;

                    return (
                        <g key={feature.key}>
                            <motion.path
                                d={`M 80 ${yOffset} Q 50% ${yOffset + (i % 2 === 0 ? 10 : -10)}, calc(100% - 80px) ${yOffset}`}
                                fill="none"
                                stroke="url(#connectionGradient)"
                                strokeWidth={1 + featureSimilarity * 2}
                                strokeOpacity={0.3 + featureSimilarity * 0.5}
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 1, delay: i * 0.1 }}
                            />
                        </g>
                    );
                })}
            </svg>

            {/* Center CLAP embedding indicator */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                <motion.div
                    className="relative"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.3 }}
                >
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#ecb200]/20 to-purple-500/20 flex items-center justify-center backdrop-blur-sm border border-white/10">
                        <div className="text-center">
                            <div className="text-xl font-bold text-white">{Math.round(similarity * 100)}%</div>
                            <div className="text-[10px] text-gray-400 uppercase tracking-wider">CLAP</div>
                        </div>
                    </div>
                    {/* Pulse animation */}
                    <motion.div
                        className="absolute inset-0 rounded-full bg-gradient-to-br from-[#ecb200]/30 to-purple-500/30"
                        animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                    />
                </motion.div>
            </div>
        </div>
    );
}

// ============================================
// FEATURE COMPARISON BAR
// ============================================
function FeatureBar({
    feature,
    sourceVal,
    matchVal,
}: {
    feature: typeof AUDIO_FEATURES[0];
    sourceVal: number;
    matchVal: number;
}) {
    const Icon = feature.icon;
    const similarity = 1 - Math.abs(sourceVal - matchVal);

    return (
        <div className="flex items-center gap-3 py-2">
            <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">{feature.label}</span>
                    <span className="text-xs text-gray-500">
                        {Math.round(similarity * 100)}%
                    </span>
                </div>
                <div className="relative h-1.5 bg-[#282828] rounded-full">
                    <div
                        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#ecb200] shadow-sm shadow-[#ecb200]/50"
                        style={{ left: `calc(${sourceVal * 100}% - 4px)` }}
                    />
                    <div
                        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-purple-500 shadow-sm shadow-purple-500/50"
                        style={{ left: `calc(${matchVal * 100}% - 4px)` }}
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================
// TRACK COMPARISON CARD (with embedding viz)
// ============================================
function ComparisonCard({
    source,
    match,
}: {
    source: TrackData;
    match: TrackData;
}) {
    return (
        <div className="bg-[#121212] rounded-lg p-6">
            <div className="flex items-start gap-6">
                {/* Source Track */}
                <div className="flex-1">
                    <div className="text-xs text-[#ecb200] font-medium mb-3 uppercase tracking-wide flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#ecb200]" />
                        Source Track
                    </div>
                    <div className="flex gap-4">
                        <CoverImage
                            coverUrl={source.coverUrl}
                            albumId={source.albumId}
                            title={source.title}
                            size={100}
                            className="rounded-md shadow-lg flex-shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-white truncate text-lg">{source.title}</h3>
                            <p className="text-sm text-gray-400 truncate">{source.artist}</p>
                            <p className="text-xs text-gray-500 truncate mt-1">{source.album}</p>
                            <div className="flex gap-2 mt-3">
                                {source.features.bpm && (
                                    <span className="text-xs px-2 py-0.5 bg-[#282828] rounded text-gray-300">
                                        {Math.round(source.features.bpm)} BPM
                                    </span>
                                )}
                                {source.features.key && (
                                    <span className="text-xs px-2 py-0.5 bg-[#282828] rounded text-gray-300">
                                        {source.features.key}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Embedding visualization */}
                <div className="w-48 flex-shrink-0">
                    <EmbeddingVisualization source={source} match={match} />
                </div>

                {/* Match Track */}
                <div className="flex-1">
                    <div className="text-xs text-purple-400 font-medium mb-3 uppercase tracking-wide flex items-center gap-2 justify-end">
                        Similar Match
                        <div className="w-2 h-2 rounded-full bg-purple-500" />
                    </div>
                    <div className="flex gap-4 flex-row-reverse">
                        <CoverImage
                            coverUrl={match.coverUrl}
                            albumId={match.albumId}
                            title={match.title}
                            size={100}
                            className="rounded-md shadow-lg flex-shrink-0"
                        />
                        <div className="min-w-0 flex-1 text-right">
                            <h3 className="font-semibold text-white truncate text-lg">{match.title}</h3>
                            <p className="text-sm text-gray-400 truncate">{match.artist}</p>
                            <p className="text-xs text-gray-500 truncate mt-1">{match.album}</p>
                            <div className="flex gap-2 mt-3 justify-end">
                                {match.features.bpm && (
                                    <span className="text-xs px-2 py-0.5 bg-[#282828] rounded text-gray-300">
                                        {Math.round(match.features.bpm)} BPM
                                    </span>
                                )}
                                {match.features.key && (
                                    <span className="text-xs px-2 py-0.5 bg-[#282828] rounded text-gray-300">
                                        {match.features.key}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Feature comparison */}
            <div className="mt-6 pt-4 border-t border-[#282828]">
                <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                    {AUDIO_FEATURES.map((feature) => (
                        <FeatureBar
                            key={feature.key}
                            feature={feature}
                            sourceVal={source.features[feature.key as keyof TrackFeatures] as number || 0}
                            matchVal={match.features[feature.key as keyof TrackFeatures] as number || 0}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

// ============================================
// TRACK CARD (matching MediaCard design)
// ============================================
function TrackCard({
    track,
    isSelected,
    onSelect,
    showSimilarity = true,
}: {
    track: TrackData;
    isSelected?: boolean;
    onSelect: () => void;
    showSimilarity?: boolean;
}) {
    return (
        <div
            onClick={onSelect}
            className={cn(
                "bg-[#121212] hover:bg-[#181818] p-4 rounded-lg cursor-pointer transition-colors group",
                isSelected && "ring-1 ring-purple-500"
            )}
        >
            <div className="aspect-square bg-[#181818] rounded-md mb-4 flex items-center justify-center overflow-hidden relative shadow-lg">
                <CoverImage
                    coverUrl={track.coverUrl}
                    albumId={track.albumId}
                    title={track.title}
                    size={200}
                    className="w-full h-full"
                />
                {/* Similarity badge */}
                {showSimilarity && track.similarity !== undefined && (
                    <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/80 rounded text-xs font-semibold text-purple-400">
                        {Math.round(track.similarity * 100)}%
                    </div>
                )}
                {/* Play button on hover */}
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                    <div className="w-10 h-10 rounded-full bg-[#1db954] flex items-center justify-center shadow-lg">
                        <Play className="w-5 h-5 text-black fill-black ml-0.5" />
                    </div>
                </div>
            </div>
            <div className="min-w-0">
                <h3 className="text-sm font-bold text-white line-clamp-1 mb-1">{track.title}</h3>
                <p className="text-sm text-gray-400 line-clamp-1">{track.artist}</p>
            </div>
        </div>
    );
}

// ============================================
// VIBE PLAYLIST CARD
// ============================================
function VibePlaylistCard({
    playlist,
    onSelect,
}: {
    playlist: VibePlaylist;
    onSelect: () => void;
}) {
    return (
        <button
            onClick={onSelect}
            className="group relative overflow-hidden rounded-lg aspect-square bg-[#121212] hover:scale-[1.02] transition-transform"
        >
            <div className={cn("absolute inset-0 bg-gradient-to-br opacity-80", playlist.gradient)} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4">
                <h3 className="text-lg font-bold text-white">{playlist.name}</h3>
                <p className="text-sm text-white/70">{playlist.description}</p>
            </div>
            <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                <div className="w-12 h-12 rounded-full bg-[#1db954] flex items-center justify-center shadow-xl">
                    <Play className="w-6 h-6 text-black fill-black ml-0.5" />
                </div>
            </div>
        </button>
    );
}

// ============================================
// SEARCH INPUT
// ============================================
function VibeSearchInput({
    onSearch,
    isSearching,
}: {
    onSearch: (query: string) => void;
    isSearching: boolean;
}) {
    const [query, setQuery] = useState("");

    return (
        <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
                type="text"
                placeholder="Search by vibe... (e.g., 'dark atmospheric', 'upbeat dance')"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && query.trim() && onSearch(query.trim())}
                className="w-full pl-12 pr-4 py-3 bg-[#121212] border border-transparent hover:border-[#282828] focus:border-[#ecb200] rounded-full text-white placeholder-gray-500 focus:outline-none transition-colors"
            />
            {isSearching && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 animate-spin" />
            )}
        </div>
    );
}

// ============================================
// MAIN PAGE
// ============================================
export default function VibePage() {
    const { vibeEmbeddings, loading: featuresLoading } = useFeatures();

    if (featuresLoading) {
        return <div className="p-8 text-gray-400">Loading...</div>;
    }

    if (!vibeEmbeddings) {
        return (
            <div className="p-8">
                <h1 className="text-2xl font-bold text-white mb-4">Vibe Explorer</h1>
                <div className="bg-gray-800 rounded-lg p-6 text-center">
                    <p className="text-gray-300 mb-2">Feature not available</p>
                    <p className="text-sm text-gray-500">
                        Vibe similarity requires the CLAP analyzer service.
                        Remove <code className="bg-gray-700 px-1 rounded">docker-compose.override.yml</code> and restart to enable.
                    </p>
                </div>
            </div>
        );
    }

    return <VibePageContent />;
}

function VibePageContent() {
    const [libraryTracks, setLibraryTracks] = useState<LibraryTrack[]>([]);
    const [sourceTrack, setSourceTrack] = useState<TrackData | null>(null);
    const [similarTracks, setSimilarTracks] = useState<TrackData[]>([]);
    const [selectedMatch, setSelectedMatch] = useState<TrackData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [vibeStatus, setVibeStatus] = useState<{ totalTracks: number; embeddedTracks: number } | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>("comparison");
    const [searchQuery, setSearchQuery] = useState<string | null>(null);

    const fetchTrackWithFeatures = useCallback(async (
        trackInfo: {
            id: string;
            title: string;
            duration: number;
            album: { id: string; title: string; coverUrl?: string | null; coverArt?: string | null };
            artist: { id: string; name: string };
            distance?: number;
        }
    ): Promise<TrackData> => {
        const incomingCover = trackInfo.album.coverUrl || trackInfo.album.coverArt || null;

        try {
            const analysis = await api.getTrackAnalysis(trackInfo.id);
            return {
                id: trackInfo.id,
                title: trackInfo.title,
                artist: trackInfo.artist.name,
                artistId: trackInfo.artist.id,
                album: trackInfo.album.title,
                albumId: trackInfo.album.id,
                coverUrl: incomingCover,
                duration: trackInfo.duration,
                distance: trackInfo.distance,
                similarity: trackInfo.distance !== undefined ? distanceToSimilarity(trackInfo.distance) : undefined,
                features: {
                    energy: analysis.energy ?? 0.5,
                    valence: analysis.valence ?? 0.5,
                    arousal: analysis.arousal ?? 0.5,
                    danceability: analysis.danceability ?? 0.5,
                    instrumentalness: analysis.instrumentalness ?? 0.5,
                    acousticness: analysis.acousticness ?? 0.5,
                    speechiness: analysis.speechiness ?? 0.1,
                    bpm: analysis.bpm,
                    key: analysis.key ? `${analysis.key}${analysis.keyScale ? ` ${analysis.keyScale}` : ""}` : null,
                },
            };
        } catch {
            return {
                id: trackInfo.id,
                title: trackInfo.title,
                artist: trackInfo.artist.name,
                artistId: trackInfo.artist.id,
                album: trackInfo.album.title,
                albumId: trackInfo.album.id,
                coverUrl: incomingCover,
                duration: trackInfo.duration,
                distance: trackInfo.distance,
                similarity: trackInfo.distance !== undefined ? distanceToSimilarity(trackInfo.distance) : undefined,
                features: {
                    energy: 0.5, valence: 0.5, arousal: 0.5, danceability: 0.5,
                    instrumentalness: 0.5, acousticness: 0.5, speechiness: 0.1,
                    bpm: null, key: null,
                },
            };
        }
    }, []);

    const loadSimilarTracks = useCallback(async (track: LibraryTrack) => {
        setIsLoading(true);
        setError(null);
        setViewMode("comparison");
        setSearchQuery(null);

        try {
            const result = await api.getVibeSimilarTracks(track.id, 20);

            if (result.tracks.length === 0) {
                setError("No similar tracks found. This track may not have been analyzed yet.");
                setIsLoading(false);
                return;
            }

            const sourceData = await fetchTrackWithFeatures({
                id: track.id,
                title: track.title,
                duration: track.duration,
                album: {
                    id: track.album.id,
                    title: track.album.title,
                    coverUrl: track.album.coverUrl,
                    coverArt: track.album.coverArt,
                },
                artist: track.album.artist,
            });
            setSourceTrack(sourceData);

            const similarWithFeatures = await Promise.all(
                result.tracks.map(t => fetchTrackWithFeatures(t))
            );
            setSimilarTracks(similarWithFeatures);
            setSelectedMatch(similarWithFeatures[0] || null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load similar tracks");
        } finally {
            setIsLoading(false);
        }
    }, [fetchTrackWithFeatures]);

    const handleVibeSearch = useCallback(async (query: string) => {
        setIsSearching(true);
        setError(null);
        setViewMode("search-results");
        setSearchQuery(query);

        try {
            const result = await api.vibeSearch(query, 20);

            if (result.tracks.length === 0) {
                setError(`No tracks found matching "${query}"`);
                setIsSearching(false);
                return;
            }

            const tracksWithFeatures = await Promise.all(
                result.tracks.map(t => fetchTrackWithFeatures(t))
            );

            // For search results, we don't have a "source" track
            // Clear source and show results as a list
            setSourceTrack(null);
            setSimilarTracks(tracksWithFeatures);
            setSelectedMatch(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Search failed");
        } finally {
            setIsSearching(false);
        }
    }, [fetchTrackWithFeatures]);

    const handleSelectSearchResult = useCallback(async (track: TrackData) => {
        // When a search result is clicked, load similar tracks for it
        setIsLoading(true);
        setError(null);
        setViewMode("comparison");

        try {
            const result = await api.getVibeSimilarTracks(track.id, 20);

            if (result.tracks.length === 0) {
                setError("No similar tracks found for this track.");
                setIsLoading(false);
                return;
            }

            setSourceTrack(track);

            const similarWithFeatures = await Promise.all(
                result.tracks.map(t => fetchTrackWithFeatures(t))
            );
            setSimilarTracks(similarWithFeatures);
            setSelectedMatch(similarWithFeatures[0] || null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load similar tracks");
        } finally {
            setIsLoading(false);
        }
    }, [fetchTrackWithFeatures]);

    const handleRandomTrack = useCallback(() => {
        if (libraryTracks.length === 0) return;
        const randomIndex = Math.floor(Math.random() * libraryTracks.length);
        loadSimilarTracks(libraryTracks[randomIndex]);
    }, [libraryTracks, loadSimilarTracks]);

    const loadInitialData = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const status = await api.getVibeStatus();
            setVibeStatus(status);

            if (status.embeddedTracks === 0) {
                setError("No tracks analyzed yet. Run vibe analysis first.");
                setIsLoading(false);
                return;
            }

            const { tracks } = await api.getTracks({ limit: 200 });
            setLibraryTracks(tracks);

            for (const track of tracks) {
                try {
                    const result = await api.getVibeSimilarTracks(track.id, 20);
                    if (result.tracks.length > 0) {
                        await loadSimilarTracks(track);
                        return;
                    }
                } catch {
                    continue;
                }
            }

            setError("No tracks with embeddings found.");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load");
        } finally {
            setIsLoading(false);
        }
    }, [loadSimilarTracks]);

    useEffect(() => {
        loadInitialData();
    }, [loadInitialData]);

    return (
        <div className="min-h-screen bg-[#0a0a0a]">
            {/* Hero gradient background */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-b from-[#ecb200]/10 via-purple-900/5 to-transparent" style={{ height: "50vh" }} />
            </div>

            <div className="relative max-w-7xl mx-auto px-6 py-8">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-3xl font-bold text-white mb-1">Vibe Explorer</h1>
                            <p className="text-gray-400">
                                Discover tracks with similar sonic characteristics
                                {vibeStatus && (
                                    <span className="text-gray-500"> - {vibeStatus.embeddedTracks.toLocaleString()} tracks analyzed</span>
                                )}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleRandomTrack}
                                disabled={isLoading || libraryTracks.length === 0}
                                className="flex items-center gap-2 px-4 py-2 bg-[#121212] hover:bg-[#181818] rounded-full text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                <Shuffle className="w-4 h-4" />
                                Random
                            </button>
                            <button
                                onClick={loadInitialData}
                                disabled={isLoading}
                                className="p-2 bg-[#121212] hover:bg-[#181818] rounded-full transition-colors disabled:opacity-50"
                            >
                                <RefreshCw className={cn("w-5 h-5", isLoading && "animate-spin")} />
                            </button>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="max-w-xl">
                        <VibeSearchInput onSearch={handleVibeSearch} isSearching={isSearching} />
                    </div>
                </div>

                {/* Vibe Playlists */}
                <section className="mb-10">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-white">Vibe Playlists</h2>
                        <button className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1">
                            Show all <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        {VIBE_PLAYLISTS.map((playlist) => (
                            <VibePlaylistCard
                                key={playlist.id}
                                playlist={playlist}
                                onSelect={() => handleVibeSearch(playlist.query)}
                            />
                        ))}
                    </div>
                </section>

                {/* Error */}
                {error && (
                    <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                        <span className="text-red-200">{error}</span>
                    </div>
                )}

                {/* Loading */}
                {(isLoading || isSearching) && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-[#ecb200]" />
                    </div>
                )}

                {/* Search Results View */}
                {!isLoading && !isSearching && viewMode === "search-results" && similarTracks.length > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-white">
                                Results for "{searchQuery}"
                            </h2>
                            <span className="text-sm text-gray-400">{similarTracks.length} tracks found</span>
                        </div>
                        <p className="text-gray-400 text-sm mb-6">Click a track to explore similar vibes</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                            {similarTracks.map((track) => (
                                <TrackCard
                                    key={track.id}
                                    track={track}
                                    onSelect={() => handleSelectSearchResult(track)}
                                    showSimilarity={true}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {/* Comparison View */}
                {!isLoading && !isSearching && viewMode === "comparison" && sourceTrack && selectedMatch && (
                    <div className="space-y-8">
                        {/* Comparison */}
                        <section>
                            <h2 className="text-xl font-bold text-white mb-4">Track Comparison</h2>
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={selectedMatch.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <ComparisonCard source={sourceTrack} match={selectedMatch} />
                                </motion.div>
                            </AnimatePresence>
                        </section>

                        {/* Similar tracks grid */}
                        <section>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xl font-bold text-white">Similar Tracks</h2>
                                <span className="text-sm text-gray-400">{similarTracks.length} matches</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                {similarTracks.map((track) => (
                                    <TrackCard
                                        key={track.id}
                                        track={track}
                                        isSelected={selectedMatch?.id === track.id}
                                        onSelect={() => setSelectedMatch(track)}
                                    />
                                ))}
                            </div>
                        </section>
                    </div>
                )}

                {/* Empty state */}
                {!isLoading && !isSearching && !error && !sourceTrack && similarTracks.length === 0 && (
                    <div className="text-center py-20">
                        <Disc3 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-400">No vibe data available</h3>
                        <p className="text-gray-500 mt-2">Run the CLAP analysis on your library to start exploring</p>
                    </div>
                )}
            </div>
        </div>
    );
}
