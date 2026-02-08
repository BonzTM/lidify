/**
 * YouTube Music Routes
 *
 * Exposes the ytmusic-streamer sidecar's functionality to the frontend.
 * All routes require authentication. Each user connects their own
 * YouTube Music account — OAuth credentials are stored per-user in
 * UserSettings.ytMusicOAuthJson.
 *
 * The /stream/:videoId endpoint proxies audio bytes from the sidecar
 * so that IP-locked YouTube URLs work correctly.
 */

import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { ytMusicService } from "../services/youtubeMusic";
import { getSystemSettings } from "../utils/systemSettings";
import { logger } from "../utils/logger";
import { prisma } from "../utils/db";
import { encrypt, decrypt } from "../utils/encryption";

const router = Router();

// ── Guard middleware ───────────────────────────────────────────────

async function requireYtMusicEnabled(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const settings = await getSystemSettings();
        if (!settings.ytMusicEnabled) {
            return res
                .status(403)
                .json({ error: "YouTube Music integration is not enabled" });
        }
        next();
    } catch (err) {
        logger.error("[YTMusic Route] Failed to check settings:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}

/**
 * Ensure the user's OAuth credentials from the DB are synced to the
 * sidecar. Called lazily on each request so we don't need a startup
 * restore block. The sidecar caches instances, so this is a no-op
 * if already restored.
 */
async function ensureUserOAuth(userId: string): Promise<boolean> {
    try {
        // Quick check — is the sidecar already aware of this user?
        const status = await ytMusicService.getAuthStatus(userId);
        if (status.authenticated) return true;

        // Not authenticated in sidecar — try restoring from DB
        const userSettings = await prisma.userSettings.findUnique({
            where: { userId },
            select: { ytMusicOAuthJson: true },
        });

        if (!userSettings?.ytMusicOAuthJson) return false;

        const oauthJson = decrypt(userSettings.ytMusicOAuthJson);
        if (!oauthJson) return false;

        await ytMusicService.restoreOAuth(userId, oauthJson);
        logger.info(`[YTMusic] Restored OAuth credentials for user ${userId}`);
        return true;
    } catch (err) {
        logger.debug(`[YTMusic] OAuth restore failed for user ${userId}:`, err);
        return false;
    }
}

// ── Status ─────────────────────────────────────────────────────────

router.get(
    "/status",
    requireAuth,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            const settings = await getSystemSettings();
            const available = await ytMusicService.isAvailable();

            if (!available) {
                return res.json({
                    enabled: settings.ytMusicEnabled,
                    available: false,
                    authenticated: false,
                });
            }

            // Try to restore OAuth if needed, then check status
            await ensureUserOAuth(userId);
            const authStatus = await ytMusicService.getAuthStatus(userId);

            return res.json({
                enabled: settings.ytMusicEnabled,
                available: true,
                ...authStatus,
            });
        } catch (err) {
            logger.error("[YTMusic Route] Status check failed:", err);
            res.status(500).json({ error: "Failed to check YouTube Music status" });
        }
    }
);

// ── OAuth Flow (per-user) ──────────────────────────────────────────

router.post(
    "/auth/save-token",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            const { oauthJson } = req.body;

            if (!oauthJson) {
                return res.status(400).json({ error: "oauthJson is required" });
            }

            // Validate it's proper JSON
            try {
                JSON.parse(oauthJson);
            } catch {
                return res.status(400).json({ error: "Invalid JSON in oauthJson" });
            }

            // Encrypt and save to UserSettings
            await prisma.userSettings.upsert({
                where: { userId },
                create: {
                    userId,
                    ytMusicOAuthJson: encrypt(oauthJson),
                },
                update: {
                    ytMusicOAuthJson: encrypt(oauthJson),
                },
            });

            // Restore to sidecar so it's immediately usable
            await ytMusicService.restoreOAuth(userId, oauthJson);

            logger.info(`[YTMusic] OAuth credentials saved for user ${userId}`);
            res.json({ success: true });
        } catch (err: any) {
            logger.error("[YTMusic Route] Save OAuth token failed:", err);
            res.status(500).json({
                error: err.response?.data?.detail || "Failed to save OAuth token",
            });
        }
    }
);

router.post(
    "/auth/clear",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;

            // Clear from sidecar
            await ytMusicService.clearAuth(userId);

            // Clear from database
            await prisma.userSettings.upsert({
                where: { userId },
                create: { userId, ytMusicOAuthJson: null },
                update: { ytMusicOAuthJson: null },
            });

            logger.info(`[YTMusic] OAuth credentials cleared for user ${userId}`);
            res.json({ success: true });
        } catch (err: any) {
            logger.error("[YTMusic Route] Clear auth failed:", err);
            res.status(500).json({
                error: err.response?.data?.detail || "Failed to clear auth",
            });
        }
    }
);

// ── Search ─────────────────────────────────────────────────────────

router.post(
    "/search",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            await ensureUserOAuth(userId);

            const { query, filter } = req.body;
            if (!query) {
                return res.status(400).json({ error: "query is required" });
            }
            const result = await ytMusicService.search(userId, query, filter);
            res.json(result);
        } catch (err: any) {
            logger.error("[YTMusic Route] Search failed:", err);
            res.status(500).json({
                error: err.response?.data?.detail || "Search failed",
            });
        }
    }
);

// ── Browse ─────────────────────────────────────────────────────────

router.get(
    "/album/:browseId",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            await ensureUserOAuth(userId);
            const album = await ytMusicService.getAlbum(userId, req.params.browseId);
            res.json(album);
        } catch (err: any) {
            logger.error("[YTMusic Route] Get album failed:", err);
            res.status(500).json({
                error: err.response?.data?.detail || "Failed to get album",
            });
        }
    }
);

router.get(
    "/artist/:channelId",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            await ensureUserOAuth(userId);
            const artist = await ytMusicService.getArtist(userId, req.params.channelId);
            res.json(artist);
        } catch (err: any) {
            logger.error("[YTMusic Route] Get artist failed:", err);
            res.status(500).json({
                error: err.response?.data?.detail || "Failed to get artist",
            });
        }
    }
);

router.get(
    "/song/:videoId",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            await ensureUserOAuth(userId);
            const song = await ytMusicService.getSong(userId, req.params.videoId);
            res.json(song);
        } catch (err: any) {
            logger.error("[YTMusic Route] Get song failed:", err);
            res.status(500).json({
                error: err.response?.data?.detail || "Failed to get song",
            });
        }
    }
);

// ── Stream Proxy ───────────────────────────────────────────────────
// This is the critical endpoint: the frontend requests audio from here,
// and we pipe it from the sidecar. This avoids exposing IP-locked
// YouTube CDN URLs directly to the browser.

router.get(
    "/stream/:videoId",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            await ensureUserOAuth(userId);

            const { videoId } = req.params;
            const quality =
                (req.query.quality as string) || undefined;
            const rangeHeader = req.headers.range;

            const proxyRes = await ytMusicService.getStreamProxy(
                userId,
                videoId,
                quality,
                rangeHeader
            );

            // Forward status code and relevant headers
            res.status(proxyRes.status);

            const forwardHeaders = [
                "content-type",
                "content-length",
                "content-range",
                "accept-ranges",
            ];
            for (const header of forwardHeaders) {
                const value = proxyRes.headers[header];
                if (value) res.setHeader(header, value);
            }

            // Pipe the audio stream to the client
            proxyRes.data.pipe(res);
        } catch (err: any) {
            if (err.response?.status === 404) {
                return res.status(404).json({ error: "Stream not found" });
            }
            logger.error("[YTMusic Route] Stream proxy failed:", err);
            res.status(500).json({
                error: "Failed to stream audio",
            });
        }
    }
);

// ── Library ────────────────────────────────────────────────────────

router.get(
    "/library/songs",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            await ensureUserOAuth(userId);
            const limit = parseInt(req.query.limit as string) || 100;
            const songs = await ytMusicService.getLibrarySongs(userId, limit);
            res.json({ songs });
        } catch (err: any) {
            logger.error("[YTMusic Route] Library songs failed:", err);
            res.status(500).json({
                error: err.response?.data?.detail || "Failed to get library songs",
            });
        }
    }
);

router.get(
    "/library/albums",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            await ensureUserOAuth(userId);
            const limit = parseInt(req.query.limit as string) || 100;
            const albums = await ytMusicService.getLibraryAlbums(userId, limit);
            res.json({ albums });
        } catch (err: any) {
            logger.error("[YTMusic Route] Library albums failed:", err);
            res.status(500).json({
                error: err.response?.data?.detail || "Failed to get library albums",
            });
        }
    }
);

// ── Gap-Fill Match ─────────────────────────────────────────────────

router.post(
    "/match",
    requireAuth,
    requireYtMusicEnabled,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;
            await ensureUserOAuth(userId);

            const { artist, title, albumTitle } = req.body;
            if (!artist || !title) {
                return res
                    .status(400)
                    .json({ error: "artist and title are required" });
            }
            const match = await ytMusicService.findMatchForTrack(
                userId,
                artist,
                title,
                albumTitle
            );
            res.json({ match });
        } catch (err: any) {
            logger.error("[YTMusic Route] Match failed:", err);
            res.status(500).json({
                error: "Failed to find matching track",
            });
        }
    }
);

export default router;
