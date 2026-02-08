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
    process.env.YTMUSIC_STREAMER_URL || "http://127.0.0.1:8586";

// ── Types ──────────────────────────────────────────────────────────

export interface YtMusicAuthStatus {
    authenticated: boolean;
    reason?: string;
}

export interface YtMusicDeviceCode {
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
}

export interface YtMusicDeviceCodePollResult {
    status: "pending" | "success" | "error";
    error?: string;
    oauth_json?: string;
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

    // ── Device Code OAuth Flow ─────────────────────────────────────

    /**
     * Initiate the Google OAuth device code flow.
     * Returns a user_code and verification_url for the user to visit.
     */
    async initiateDeviceAuth(
        clientId: string,
        clientSecret: string
    ): Promise<YtMusicDeviceCode> {
        const res = await this.client.post("/auth/device-code", {
            client_id: clientId,
            client_secret: clientSecret,
        });
        return res.data;
    }

    /**
     * Poll for device code authorization completion.
     * Returns the token when ready, or a pending status.
     */
    async pollDeviceAuth(
        userId: string,
        clientId: string,
        clientSecret: string,
        deviceCode: string
    ): Promise<YtMusicDeviceCodePollResult> {
        const res = await this.client.post(
            "/auth/device-code/poll",
            {
                client_id: clientId,
                client_secret: clientSecret,
                device_code: deviceCode,
            },
            { params: { user_id: userId } }
        );
        return res.data;
    }

    /**
     * Restore OAuth credentials to the sidecar, including client credentials
     * for OAuthCredentials support.
     */
    async restoreOAuthWithCredentials(
        userId: string,
        oauthJson: string,
        clientId?: string,
        clientSecret?: string
    ): Promise<void> {
        const body: Record<string, string> = { oauth_json: oauthJson };
        if (clientId && clientSecret) {
            body.client_id = clientId;
            body.client_secret = clientSecret;
        }
        await this.client.post("/auth/restore", body, {
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
     * Sanitize a search query for YouTube Music.
     * Strips characters that cause HTTP 400 from Google's API:
     * parentheses, brackets, featuring tags, remaster suffixes, etc.
     */
    private sanitizeQuery(text: string): string {
        return text
            .replace(/\s*\(.*?\)\s*/g, " ")     // Remove (Deluxe Edition), (feat. X), etc.
            .replace(/\s*\[.*?\]\s*/g, " ")      // Remove [Remastered], [Explicit], etc.
            .replace(/[^\p{L}\p{N}\s'-]/gu, " ") // Keep letters, numbers, spaces, hyphens, apostrophes
            .replace(/\s+/g, " ")                 // Collapse whitespace
            .trim();
    }

    /**
     * Find a matching YouTube Music track for an album track that
     * isn't in the local library. Searches by "{artist} {title}" and
     * picks the first song result that closely matches.
     *
     * Uses a tiered fallback strategy:
     *   1. artist + title (filtered to songs)
     *   2. artist + title (unfiltered, pick first song result)
     *   3. artist + title + album (unfiltered, pick first song result)
     */
    async findMatchForTrack(
        userId: string,
        artist: string,
        title: string,
        albumTitle?: string
    ): Promise<{ videoId: string; title: string; duration: number } | null> {
        const cleanArtist = this.sanitizeQuery(artist);
        const cleanTitle = this.sanitizeQuery(title);
        const shortQuery = `${cleanArtist} ${cleanTitle}`;

        // --- Attempt 1: filtered search (songs only) ---
        try {
            const result = await this.search(userId, shortQuery, "songs");
            if (result.results?.length) {
                const match = result.results[0];
                return {
                    videoId: match.videoId,
                    title: match.title,
                    duration: match.duration_seconds || match.duration || 0,
                };
            }
        } catch {
            // Filtered search failed (HTTP 400) — fall through
        }

        // --- Attempt 2: unfiltered search, pick first song ---
        try {
            const result = await this.search(userId, shortQuery);
            const song = result.results?.find(
                (r: any) => r.type === "song" && r.videoId
            );
            if (song) {
                return {
                    videoId: song.videoId,
                    title: song.title,
                    duration: song.duration_seconds || song.duration || 0,
                };
            }
        } catch {
            // Unfiltered search also failed — fall through
        }

        // --- Attempt 3: add album title for disambiguation ---
        if (albumTitle) {
            const cleanAlbum = this.sanitizeQuery(albumTitle);
            const longQuery = `${cleanArtist} ${cleanTitle} ${cleanAlbum}`;
            try {
                const result = await this.search(userId, longQuery);
                const song = result.results?.find(
                    (r: any) => r.type === "song" && r.videoId
                );
                if (song) {
                    return {
                        videoId: song.videoId,
                        title: song.title,
                        duration: song.duration_seconds || song.duration || 0,
                    };
                }
            } catch (err) {
                logger.warn(
                    `[YTMusic] All search attempts failed for "${artist} - ${title}":`,
                    err
                );
            }
        }

        return null;
    }
}

export const ytMusicService = new YouTubeMusicService();
