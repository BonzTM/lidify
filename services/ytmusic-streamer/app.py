"""
YouTube Music Streamer — FastAPI sidecar for Lidify.

Uses `ytmusicapi` for search/browse/library and `yt-dlp` for audio stream
URL extraction. Streams audio by proxying from YouTube's CDN — no files
are saved to disk.

Supports **per-user** OAuth credentials: each Lidify user connects their
own YouTube Music account. Credentials are stored as individual files
(`oauth_{user_id}.json`) and each user gets a separate YTMusic instance.

The Node.js backend communicates with this service over HTTP on port 8586,
passing `user_id` as a query parameter to scope every request.
"""

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Optional, Literal

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ytmusicapi import YTMusic, OAuthCredentials

# ── Logging ─────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG") else logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
log = logging.getLogger("ytmusic-streamer")

# ── FastAPI app ─────────────────────────────────────────────────────
app = FastAPI(title="Lidify YouTube Music Streamer", version="1.0.0")

# ── Paths ───────────────────────────────────────────────────────────
DATA_PATH = Path(os.getenv("DATA_PATH", "/data"))

# ── Stream URL cache (in-memory, URLs expire after ~6h) ────────────
# Keys are "{user_id}:{video_id}" to isolate per-user sessions
_stream_cache: dict[str, dict] = {}
STREAM_CACHE_TTL = 5 * 60 * 60  # 5 hours (YouTube URLs expire at ~6h)

# ── Per-user YTMusic instances ──────────────────────────────────────
_ytmusic_instances: dict[str, YTMusic] = {}
_ytmusic_lock = asyncio.Lock()


# ════════════════════════════════════════════════════════════════════
# Models
# ════════════════════════════════════════════════════════════════════

class OAuthTokenPayload(BaseModel):
    """OAuth tokens stored by the backend."""
    oauth_json: str  # Full JSON string from ytmusicapi OAuth


class DeviceCodeRequest(BaseModel):
    """Request to initiate device code flow."""
    client_id: str
    client_secret: str


class DeviceCodePollRequest(BaseModel):
    """Request to poll for device code completion."""
    client_id: str
    client_secret: str
    device_code: str


class SearchRequest(BaseModel):
    query: str
    filter: Optional[Literal["songs", "albums", "artists", "videos"]] = None
    limit: int = 20


# ════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════

def _oauth_file(user_id: str) -> Path:
    """Return the OAuth JSON path for a given user."""
    return DATA_PATH / f"oauth_{user_id}.json"


def _get_ytmusic(user_id: str) -> YTMusic:
    """Get or create an authenticated YTMusic instance for a specific user."""
    if user_id in _ytmusic_instances:
        return _ytmusic_instances[user_id]

    oauth_path = _oauth_file(user_id)
    if oauth_path.exists():
        try:
            # Read the oauth JSON to check if it has custom client credentials
            oauth_data = json.loads(oauth_path.read_text())

            # Build OAuthCredentials if client_id/client_secret are stored alongside
            oauth_creds = None
            creds_path = DATA_PATH / f"client_creds_{user_id}.json"
            if creds_path.exists():
                creds_data = json.loads(creds_path.read_text())
                oauth_creds = OAuthCredentials(
                    client_id=creds_data["client_id"],
                    client_secret=creds_data["client_secret"],
                )

            if oauth_creds:
                yt = YTMusic(str(oauth_path), oauth_credentials=oauth_creds)
            else:
                yt = YTMusic(str(oauth_path))

            _ytmusic_instances[user_id] = yt
            log.info(f"Loaded YTMusic for user {user_id}")
            return yt
        except Exception as e:
            log.error(f"Failed to load OAuth for user {user_id}: {e}")
            raise HTTPException(
                status_code=401,
                detail="OAuth credentials invalid. Please re-authenticate.",
            )

    raise HTTPException(
        status_code=401,
        detail="Not authenticated. Please set up OAuth first.",
    )


def _invalidate_ytmusic(user_id: str):
    """Force re-creation of a user's YTMusic instance on next use."""
    _ytmusic_instances.pop(user_id, None)


def _get_stream_url_sync(user_id: str, video_id: str, quality: str = "HIGH") -> dict:
    """
    Use yt-dlp to extract audio stream URL for a YouTube Music video.
    Returns dict with url, format, duration, expires_at.
    """
    import yt_dlp

    cache_key = f"{user_id}:{video_id}"

    # Check cache first
    cached = _stream_cache.get(cache_key)
    if cached and cached.get("expires_at", 0) > time.time():
        log.debug(f"Stream URL cache hit for {cache_key}")
        return cached

    # Map quality to yt-dlp format selection
    format_map = {
        "LOW": "ba[abr<=64]/worstaudio/ba",
        "MEDIUM": "ba[abr<=128]/ba[abr<=192]/ba",
        "HIGH": "ba[abr<=256]/ba",
        "LOSSLESS": "ba/bestaudio",
    }
    fmt = format_map.get(quality, format_map["HIGH"])

    ydl_opts = {
        "format": fmt,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
    }

    url = f"https://music.youtube.com/watch?v={video_id}"

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

            if not info:
                raise ValueError("No info extracted")

            stream_url = info.get("url")
            if not stream_url:
                # Try to find audio format in formats list
                formats = info.get("formats", [])
                audio_formats = [
                    f for f in formats
                    if f.get("acodec") != "none" and f.get("vcodec") in ("none", None)
                ]
                if audio_formats:
                    audio_formats.sort(key=lambda f: f.get("abr", 0) or 0, reverse=True)
                    stream_url = audio_formats[0].get("url")

            if not stream_url:
                raise ValueError("No audio stream URL found")

            result = {
                "url": stream_url,
                "content_type": info.get("audio_ext", "m4a"),
                "duration": info.get("duration", 0),
                "title": info.get("title", ""),
                "artist": info.get("artist") or info.get("uploader", ""),
                "expires_at": time.time() + STREAM_CACHE_TTL,
                "abr": info.get("abr", 0),
                "acodec": info.get("acodec", ""),
            }

            _stream_cache[cache_key] = result
            log.debug(f"Extracted stream URL for {cache_key}: {result['acodec']} @ {result['abr']}kbps")
            return result

    except Exception as e:
        log.error(f"yt-dlp extraction failed for {video_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to extract stream: {str(e)}")


def _clean_stream_cache():
    """Remove expired entries from stream cache."""
    now = time.time()
    expired = [k for k, v in _stream_cache.items() if v.get("expires_at", 0) <= now]
    for k in expired:
        del _stream_cache[k]
    if expired:
        log.debug(f"Cleaned {len(expired)} expired stream cache entries")


# ════════════════════════════════════════════════════════════════════
# Routes
# ════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    # Count how many users have OAuth files
    oauth_files = list(DATA_PATH.glob("oauth_*.json"))
    return {
        "status": "ok",
        "service": "ytmusic-streamer",
        "authenticated_users": len(oauth_files),
    }


# ── OAuth Authentication (per-user) ────────────────────────────────

@app.get("/auth/status")
async def auth_status(user_id: str = Query(...)):
    """Check if a specific user has valid OAuth credentials."""
    oauth_path = _oauth_file(user_id)

    if not oauth_path.exists():
        return {"authenticated": False, "reason": "No OAuth credentials found"}

    try:
        _get_ytmusic(user_id)
        return {"authenticated": True}
    except Exception as e:
        return {"authenticated": False, "reason": str(e)}


@app.post("/auth/restore")
async def auth_restore(req: Request, user_id: str = Query(...)):
    """
    Restore OAuth credentials for a user from the backend database.
    The backend sends the decrypted OAuth JSON which is written as
    the user's credential file so that ytmusicapi can use it.
    Optionally accepts client_id/client_secret for OAuthCredentials.
    """
    body = await req.json()
    oauth_json = body.get("oauth_json")
    if not oauth_json:
        raise HTTPException(status_code=400, detail="oauth_json is required")

    try:
        json.loads(oauth_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in oauth_json")

    DATA_PATH.mkdir(parents=True, exist_ok=True)
    _oauth_file(user_id).write_text(oauth_json)

    # Save client credentials if provided
    client_id = body.get("client_id")
    client_secret = body.get("client_secret")
    if client_id and client_secret:
        creds_path = DATA_PATH / f"client_creds_{user_id}.json"
        creds_path.write_text(json.dumps({
            "client_id": client_id,
            "client_secret": client_secret,
        }))

    _invalidate_ytmusic(user_id)
    log.info(f"OAuth credentials restored for user {user_id}")
    return {"status": "ok", "message": "OAuth credentials restored"}


@app.post("/auth/clear")
async def auth_clear(user_id: str = Query(...)):
    """Remove stored OAuth credentials for a specific user."""
    _invalidate_ytmusic(user_id)
    oauth_path = _oauth_file(user_id)
    if oauth_path.exists():
        oauth_path.unlink()
    creds_path = DATA_PATH / f"client_creds_{user_id}.json"
    if creds_path.exists():
        creds_path.unlink()
    log.info(f"OAuth credentials cleared for user {user_id}")
    return {"status": "ok", "message": "OAuth credentials removed"}


# ── OAuth Device Code Flow ──────────────────────────────────────────

@app.post("/auth/device-code")
async def auth_device_code(req: DeviceCodeRequest):
    """
    Initiate the Google OAuth device code flow.
    Returns a user_code and verification_url for the user to visit.
    """
    try:
        oauth_creds = OAuthCredentials(
            client_id=req.client_id,
            client_secret=req.client_secret,
        )
        code = oauth_creds.get_code()
        log.info(f"Device code flow initiated, user_code: {code.get('user_code')}")
        return {
            "device_code": code["device_code"],
            "user_code": code["user_code"],
            "verification_url": code["verification_url"],
            "expires_in": code.get("expires_in", 1800),
            "interval": code.get("interval", 5),
        }
    except Exception as e:
        log.error(f"Device code initiation failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to initiate device code flow: {str(e)}",
        )


@app.post("/auth/device-code/poll")
async def auth_device_code_poll(req: DeviceCodePollRequest, user_id: str = Query(...)):
    """
    Poll for device code authorization completion.
    Returns the OAuth token JSON when the user completes authorization,
    or a pending status if still waiting.
    """
    # User-friendly error descriptions
    ERROR_MESSAGES = {
        "invalid_grant": "The sign-in code has expired or was already used. Please start over.",
        "expired_token": "The sign-in code has expired. Please start over.",
        "access_denied": "Access was denied. Please try again and click 'Allow' on the Google page.",
        "invalid_client": "OAuth client credentials are invalid. Please ask your admin to check the Client ID and Secret.",
    }

    try:
        oauth_creds = OAuthCredentials(
            client_id=req.client_id,
            client_secret=req.client_secret,
        )
        token = oauth_creds.token_from_code(req.device_code)

        # Check if we got an error (authorization_pending, slow_down, etc.)
        if "error" in token:
            error = token["error"]
            if error in ("authorization_pending", "slow_down"):
                return {"status": "pending", "error": error}
            else:
                friendly = ERROR_MESSAGES.get(error, f"Authorization failed ({error}). Please try again.")
                log.error(f"Device code poll error: {error}")
                return {"status": "error", "error": friendly}

        # Success — we have a token. Save it for this user.
        DATA_PATH.mkdir(parents=True, exist_ok=True)
        token_json = json.dumps(dict(token), indent=True)
        _oauth_file(user_id).write_text(token_json)

        # Save client credentials alongside so _get_ytmusic can use them
        creds_path = DATA_PATH / f"client_creds_{user_id}.json"
        creds_path.write_text(json.dumps({
            "client_id": req.client_id,
            "client_secret": req.client_secret,
        }))

        _invalidate_ytmusic(user_id)
        log.info(f"Device code flow completed for user {user_id}")

        return {
            "status": "success",
            "oauth_json": token_json,
        }
    except Exception as e:
        error_str = str(e).lower()
        # ytmusicapi raises exceptions for pending states too
        if "authorization_pending" in error_str:
            return {"status": "pending", "error": "authorization_pending"}

        # Check for known error types in exception messages
        for error_key, friendly_msg in ERROR_MESSAGES.items():
            if error_key in error_str:
                log.warning(f"Device code poll error for user {user_id}: {error_key}")
                return {"status": "error", "error": friendly_msg}

        log.error(f"Device code poll failed for user {user_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to poll device code: {str(e)}",
        )


# ── Search ──────────────────────────────────────────────────────────

@app.post("/search")
async def search(req: SearchRequest, user_id: str = Query(...)):
    """Search YouTube Music for songs, albums, or artists."""
    yt = _get_ytmusic(user_id)

    try:
        results = yt.search(req.query, filter=req.filter, limit=req.limit)

        items = []
        for r in results:
            result_type = r.get("resultType") or r.get("category", "").lower()

            if result_type == "song":
                artists = r.get("artists", [])
                album = r.get("album", {}) or {}
                items.append({
                    "type": "song",
                    "videoId": r.get("videoId"),
                    "title": r.get("title"),
                    "artist": artists[0].get("name") if artists else "Unknown",
                    "artists": [a.get("name") for a in artists],
                    "album": album.get("name") if album else None,
                    "albumId": album.get("id") if album else None,
                    "duration": r.get("duration"),
                    "duration_seconds": r.get("duration_seconds"),
                    "thumbnails": r.get("thumbnails", []),
                    "isExplicit": r.get("isExplicit", False),
                })
            elif result_type == "album":
                artists = r.get("artists", [])
                items.append({
                    "type": "album",
                    "browseId": r.get("browseId"),
                    "title": r.get("title"),
                    "artist": artists[0].get("name") if artists else "Unknown",
                    "artists": [a.get("name") for a in artists],
                    "year": r.get("year"),
                    "thumbnails": r.get("thumbnails", []),
                    "isExplicit": r.get("isExplicit", False),
                    "type_detail": r.get("type", "Album"),
                })
            elif result_type == "artist":
                items.append({
                    "type": "artist",
                    "browseId": r.get("browseId"),
                    "name": r.get("artist") or r.get("name"),
                    "thumbnails": r.get("thumbnails", []),
                    "subscribers": r.get("subscribers"),
                })
            elif result_type == "video":
                artists = r.get("artists", [])
                items.append({
                    "type": "video",
                    "videoId": r.get("videoId"),
                    "title": r.get("title"),
                    "artist": artists[0].get("name") if artists else "Unknown",
                    "artists": [a.get("name") for a in artists],
                    "duration": r.get("duration"),
                    "duration_seconds": r.get("duration_seconds"),
                    "thumbnails": r.get("thumbnails", []),
                })

        return {"results": items, "total": len(items)}
    except Exception as e:
        log.error(f"Search failed for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/album/{browse_id}")
async def get_album(browse_id: str, user_id: str = Query(...)):
    """Get album details and track listing from YouTube Music."""
    yt = _get_ytmusic(user_id)

    try:
        album = yt.get_album(browse_id)

        tracks = []
        for t in album.get("tracks", []):
            artists = t.get("artists", [])
            tracks.append({
                "videoId": t.get("videoId"),
                "title": t.get("title"),
                "artist": artists[0].get("name") if artists else "Unknown",
                "artists": [a.get("name") for a in artists],
                "trackNumber": t.get("trackNumber"),
                "duration": t.get("duration"),
                "duration_seconds": t.get("duration_seconds"),
                "isExplicit": t.get("isExplicit", False),
                "likeStatus": t.get("likeStatus"),
            })

        thumbnails = album.get("thumbnails", [])
        return {
            "browseId": browse_id,
            "title": album.get("title"),
            "artist": album.get("artists", [{}])[0].get("name") if album.get("artists") else "Unknown",
            "artists": [a.get("name") for a in album.get("artists", [])],
            "year": album.get("year"),
            "trackCount": album.get("trackCount"),
            "duration": album.get("duration"),
            "type": album.get("type", "Album"),
            "thumbnails": thumbnails,
            "coverUrl": thumbnails[-1].get("url") if thumbnails else None,
            "tracks": tracks,
            "description": album.get("description"),
        }
    except Exception as e:
        log.error(f"Get album failed for {browse_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/artist/{channel_id}")
async def get_artist(channel_id: str, user_id: str = Query(...)):
    """Get artist details from YouTube Music."""
    yt = _get_ytmusic(user_id)

    try:
        artist = yt.get_artist(channel_id)

        songs = []
        for s in (artist.get("songs", {}).get("results", []))[:10]:
            artists = s.get("artists", [])
            songs.append({
                "videoId": s.get("videoId"),
                "title": s.get("title"),
                "artist": artists[0].get("name") if artists else "Unknown",
                "album": s.get("album", {}).get("name") if s.get("album") else None,
                "duration": s.get("duration"),
            })

        albums = []
        for a in (artist.get("albums", {}).get("results", []))[:20]:
            albums.append({
                "browseId": a.get("browseId"),
                "title": a.get("title"),
                "year": a.get("year"),
                "type": a.get("type", "Album"),
                "thumbnails": a.get("thumbnails", []),
            })

        thumbnails = artist.get("thumbnails", [])
        return {
            "channelId": channel_id,
            "name": artist.get("name"),
            "description": artist.get("description"),
            "thumbnails": thumbnails,
            "subscribers": artist.get("subscribers"),
            "songs": songs,
            "albums": albums,
        }
    except Exception as e:
        log.error(f"Get artist failed for {channel_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/song/{video_id}")
async def get_song(video_id: str, user_id: str = Query(...)):
    """Get song metadata from YouTube Music."""
    yt = _get_ytmusic(user_id)

    try:
        song = yt.get_song(video_id)
        video_details = song.get("videoDetails", {})

        return {
            "videoId": video_details.get("videoId"),
            "title": video_details.get("title"),
            "artist": video_details.get("author"),
            "duration": int(video_details.get("lengthSeconds", 0)),
            "thumbnails": video_details.get("thumbnail", {}).get("thumbnails", []),
            "isOwner": video_details.get("isOwnerViewing", False),
            "viewCount": video_details.get("viewCount"),
        }
    except Exception as e:
        log.error(f"Get song failed for {video_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Streaming ───────────────────────────────────────────────────────

@app.get("/stream/{video_id}")
async def get_stream_info(video_id: str, user_id: str = Query(...), quality: str = "HIGH"):
    """Get stream URL info for a video (metadata only, no proxy)."""
    # Verify user is authenticated before extracting
    _get_ytmusic(user_id)

    result = await asyncio.to_thread(_get_stream_url_sync, user_id, video_id, quality)
    return {
        "videoId": video_id,
        "url": result["url"],
        "content_type": result["content_type"],
        "duration": result["duration"],
        "abr": result.get("abr", 0),
        "acodec": result.get("acodec", ""),
        "expires_at": result["expires_at"],
    }


@app.get("/proxy/{video_id}")
async def proxy_stream(
    video_id: str,
    user_id: str = Query(...),
    quality: str = "HIGH",
    request: Request = None,
):
    """
    Proxy the audio stream from YouTube. The backend pipes this to the
    frontend player. Stream URLs are IP-locked to the server, so we
    must proxy.
    """
    # Verify user is authenticated
    _get_ytmusic(user_id)

    stream_info = await asyncio.to_thread(_get_stream_url_sync, user_id, video_id, quality)
    stream_url = stream_info["url"]

    # Determine content type for the response
    acodec = stream_info.get("acodec", "")
    if "opus" in acodec:
        content_type = "audio/webm"
    elif "mp4a" in acodec or "aac" in acodec:
        content_type = "audio/mp4"
    else:
        content_type = "audio/mp4"

    # Build headers for upstream request
    headers = {}
    if request and "range" in request.headers:
        headers["Range"] = request.headers["range"]

    async def stream_audio():
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=300.0)) as client:
            try:
                async with client.stream("GET", stream_url, headers=headers) as response:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk
            except httpx.HTTPError as e:
                log.error(f"Upstream stream error for {video_id}: {e}")
                raise

    # For range requests, fetch upstream first to get headers
    if headers.get("Range"):
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=300.0)) as client:
            upstream = await client.send(
                client.build_request("GET", stream_url, headers=headers),
                stream=True,
            )
            response_headers = {
                "Content-Type": content_type,
                "Accept-Ranges": "bytes",
            }
            if "content-range" in upstream.headers:
                response_headers["Content-Range"] = upstream.headers["content-range"]
            if "content-length" in upstream.headers:
                response_headers["Content-Length"] = upstream.headers["content-length"]

            async def range_stream():
                async for chunk in upstream.aiter_bytes(chunk_size=65536):
                    yield chunk
                await upstream.aclose()

            return StreamingResponse(
                range_stream(),
                status_code=upstream.status_code,
                headers=response_headers,
            )

    return StreamingResponse(
        stream_audio(),
        media_type=content_type,
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
        },
    )


# ── Library ─────────────────────────────────────────────────────────

@app.get("/library/songs")
async def library_songs(user_id: str = Query(...), limit: int = 100, order: str = "recently_added"):
    """Get user's liked/library songs from YouTube Music."""
    yt = _get_ytmusic(user_id)

    try:
        songs = yt.get_library_songs(limit=limit, order=order)
        items = []
        for s in songs:
            artists = s.get("artists", [])
            album = s.get("album", {}) or {}
            items.append({
                "videoId": s.get("videoId"),
                "title": s.get("title"),
                "artist": artists[0].get("name") if artists else "Unknown",
                "artists": [a.get("name") for a in artists],
                "album": album.get("name") if album else None,
                "duration": s.get("duration"),
                "duration_seconds": s.get("duration_seconds"),
                "thumbnails": s.get("thumbnails", []),
            })
        return {"songs": items, "total": len(items)}
    except Exception as e:
        log.error(f"Get library songs failed for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/library/albums")
async def library_albums(user_id: str = Query(...), limit: int = 100, order: str = "recently_added"):
    """Get user's saved albums from YouTube Music."""
    yt = _get_ytmusic(user_id)

    try:
        albums = yt.get_library_albums(limit=limit, order=order)
        items = []
        for a in albums:
            artists = a.get("artists", [])
            items.append({
                "browseId": a.get("browseId"),
                "title": a.get("title"),
                "artist": artists[0].get("name") if artists else "Unknown",
                "artists": [a_name.get("name") for a_name in artists],
                "year": a.get("year"),
                "thumbnails": a.get("thumbnails", []),
                "type": a.get("type", "Album"),
            })
        return {"albums": items, "total": len(items)}
    except Exception as e:
        log.error(f"Get library albums failed for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Cleanup ─────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    log.info("YouTube Music Streamer starting up (multi-user mode)")
    oauth_files = list(DATA_PATH.glob("oauth_*.json"))
    if oauth_files:
        log.info(f"Found {len(oauth_files)} user OAuth credential file(s)")
    else:
        log.info("No OAuth credentials found — users need to authenticate via settings")


@app.on_event("shutdown")
async def shutdown():
    _clean_stream_cache()
    _ytmusic_instances.clear()
    log.info("YouTube Music Streamer shutting down")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8586)
