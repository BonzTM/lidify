/**
 * YouTube Music Service
 *
 * Communicates with the ytmusic-streamer FastAPI sidecar over HTTP.
 * Provides search, browse, library, authentication, and stream-proxying
 * capabilities. Audio is streamed through the sidecar (never saved to disk).
 *
 * All methods accept a `userId` parameter — the sidecar uses per-user
 * OAuth credentials so each Lidify user connects their own YouTube Music
 * account independently.
 */

import axios, { AxiosInstance } from "axios";
import { logger } from "../utils/logger";
import { getSystemSettings } from "../utils/systemSettings";

// ── Sidecar URL ────────────────────────────────────────────────────
const YTMUSIC_STREAMER_URL =
    process.env.YTMUSIC_STREAMER_URL || "http://ytmusic-streamer:8586";

// ── Types ──────────────────────────────────────────────────────────

export interface YtMusicAuthStatus {
    authenticated: boolean;
    reason?: string;
}

export interface YtMusicSearchResult {
    results: any[];
    total: number;
}

export interface YtMusicAlbum {
    browseId: string;
    title: string;
    artist: string;
    year?: string;
    thumbnails: any[];
    tracks: any[];
    trackCount: number;
    duration?: string;
    type: string;
}

export interface YtMusicArtist {
    channelId: string;
    name: string;
    thumbnails: any[];
    description?: string;
    albums: any[];
    songs: any[];
}

export interface YtMusicSong {
    videoId: string;
    title: string;
    artist: string;
    album?: string;
    duration?: number;
    thumbnails: any[];
}

export interface YtMusicStreamInfo {
    videoId: string;
    url: string;
    content_type: string;
    duration: number;
    abr: number;
    acodec: string;
    expires_at: number;
}

// ── Service ────────────────────────────────────────────────────────

class YouTubeMusicService {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: YTMUSIC_STREAMER_URL,
            timeout: 30_000,
        });
    }

    // ── Health / Status ────────────────────────────────────────────

    /**
     * Check whether the sidecar is reachable.
     */
    async isAvailable(): Promise<boolean> {
        try {
            const res = await this.client.get("/health", { timeout: 5_000 });
            return res.status === 200;
        } catch {
            return false;
        }
    }

    /**
     * Check whether a specific user is authenticated with YouTube Music.
     */
    async getAuthStatus(userId: string): Promise<YtMusicAuthStatus> {
        const res = await this.client.get("/auth/status", {
            params: { user_id: userId },
        });
        return res.data;
    }

    // ── OAuth Credential Restore ───────────────────────────────────

    /**
     * Write OAuth JSON to the sidecar for a specific user (used to restore
     * credentials from the DB on first request).
     */
    async restoreOAuth(userId: string, oauthJson: string): Promise<void> {
        await this.client.post(
            "/auth/restore",
            { oauth_json: oauthJson },
            { params: { user_id: userId } }
        );
    }

    /**
     * Clear stored OAuth credentials in the sidecar for a specific user.
     */
    async clearAuth(userId: string): Promise<void> {
        await this.client.post("/auth/clear", null, {
            params: { user_id: userId },
        });
    }

    // ── Search ─────────────────────────────────────────────────────

    async search(
        userId: string,
        query: string,
        filter?: "songs" | "albums" | "artists" | "videos"
    ): Promise<YtMusicSearchResult> {
        const res = await this.client.post(
            "/search",
            { query, filter },
            { params: { user_id: userId } }
        );
        return res.data;
    }

    // ── Browse ─────────────────────────────────────────────────────

    async getAlbum(userId: string, browseId: string): Promise<YtMusicAlbum> {
        const res = await this.client.get(`/album/${browseId}`, {
            params: { user_id: userId },
        });
        return res.data;
    }

    async getArtist(userId: string, channelId: string): Promise<YtMusicArtist> {
        const res = await this.client.get(`/artist/${channelId}`, {
            params: { user_id: userId },
        });
        return res.data;
    }

    async getSong(userId: string, videoId: string): Promise<YtMusicSong> {
        const res = await this.client.get(`/song/${videoId}`, {
            params: { user_id: userId },
        });
        return res.data;
    }

    // ── Streaming ──────────────────────────────────────────────────

    /**
     * Get stream metadata (URL, format, quality) for a video.
     * The URL itself is IP-locked to the sidecar — callers should
     * use `getStreamProxy` for actual audio delivery.
     */
    async getStreamInfo(
        userId: string,
        videoId: string,
        quality?: string
    ): Promise<YtMusicStreamInfo> {
        const params: Record<string, string> = { user_id: userId };
        if (quality) params.quality = quality;
        const res = await this.client.get(`/stream/${videoId}`, { params });
        return res.data;
    }

    /**
     * Return an Axios response that streams the audio bytes from the
     * sidecar proxy. The caller should pipe `res.data` to the client.
     */
    async getStreamProxy(
        userId: string,
        videoId: string,
        quality?: string,
        rangeHeader?: string
    ) {
        const params: Record<string, string> = { user_id: userId };
        if (quality) params.quality = quality;

        const headers: Record<string, string> = {};
        if (rangeHeader) headers["Range"] = rangeHeader;

        return this.client.get(`/proxy/${videoId}`, {
            params,
            headers,
            responseType: "stream",
            timeout: 120_000, // Longer timeout for streaming
        });
    }

    // ── Library ────────────────────────────────────────────────────

    async getLibrarySongs(userId: string, limit = 100): Promise<any[]> {
        const res = await this.client.get("/library/songs", {
            params: { user_id: userId, limit },
        });
        return res.data.songs;
    }

    async getLibraryAlbums(userId: string, limit = 100): Promise<any[]> {
        const res = await this.client.get("/library/albums", {
            params: { user_id: userId, limit },
        });
        return res.data.albums;
    }

    // ── Gap-Fill Matching ──────────────────────────────────────────

    /**
     * Find a matching YouTube Music track for an album track that
     * isn't in the local library. Searches by "{artist} {title}" and
     * picks the first song result that closely matches.
     */
    async findMatchForTrack(
        userId: string,
        artist: string,
        title: string,
        albumTitle?: string
    ): Promise<{ videoId: string; title: string; duration: number } | null> {
        try {
            const query = albumTitle
                ? `${artist} ${title} ${albumTitle}`
                : `${artist} ${title}`;

            const searchResult = await this.search(userId, query, "songs");
            if (!searchResult.results || searchResult.results.length === 0) {
                return null;
            }

            // Return the first result — the sidecar already orders by relevance
            const match = searchResult.results[0];
            return {
                videoId: match.videoId,
                title: match.title,
                duration: match.duration_seconds || match.duration || 0,
            };
        } catch (err) {
            logger.warn(
                `[YTMusic] Failed to find match for "${artist} - ${title}":`,
                err
            );
            return null;
        }
    }
}

export const ytMusicService = new YouTubeMusicService();
