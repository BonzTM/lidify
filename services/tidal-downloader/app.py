"""
TIDAL Downloader — FastAPI sidecar for Lidify.

Uses the `tiddl` Python library to authenticate, search, and download
tracks/albums from TIDAL. The Node.js backend communicates with this
service over HTTP on port 8585.
"""

import asyncio
import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Optional, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── tiddl core imports ──────────────────────────────────────────────
from tiddl.core.auth import AuthAPI, AuthClientError
from tiddl.core.auth.client import AuthClient
from tiddl.core.api import TidalAPI, TidalClient, ApiError
from tiddl.core.utils import get_track_stream_data, parse_track_stream
from tiddl.core.utils.format import format_template
from tiddl.core.metadata import add_track_metadata, Cover

# ── Logging ─────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG") else logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
log = logging.getLogger("tidal-downloader")

# ── FastAPI app ─────────────────────────────────────────────────────
app = FastAPI(title="Lidify TIDAL Downloader", version="1.0.0")

# ── Paths ───────────────────────────────────────────────────────────
TIDDL_PATH = Path(os.getenv("TIDDL_PATH", "/data/.tiddl"))
MUSIC_PATH = Path(os.getenv("MUSIC_PATH", "/music"))

# ── In-memory API instance (initialised on first use) ──────────────
_tidal_api: Optional[TidalAPI] = None
_api_lock = asyncio.Lock()


# ════════════════════════════════════════════════════════════════════
# Models
# ════════════════════════════════════════════════════════════════════

class AuthTokenRequest(BaseModel):
    device_code: str


class AuthTokensPayload(BaseModel):
    """Tokens + metadata provided by the Node.js backend."""
    access_token: str
    refresh_token: str
    user_id: str
    country_code: str


class RefreshRequest(BaseModel):
    refresh_token: str


class SearchRequest(BaseModel):
    query: str


class DownloadTrackRequest(BaseModel):
    track_id: int
    quality: Literal["LOW", "HIGH", "LOSSLESS", "HI_RES_LOSSLESS"] = "HIGH"
    output_template: str = "{album.artist}/{album.title}/{item.number:02d}. {item.title}"


class DownloadAlbumRequest(BaseModel):
    album_id: int
    quality: Literal["LOW", "HIGH", "LOSSLESS", "HI_RES_LOSSLESS"] = "HIGH"
    output_template: str = "{album.artist}/{album.title}/{item.number:02d}. {item.title}"


# ════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════

def _sanitize_path_component(name: str) -> str:
    """Remove or replace chars that are invalid on most filesystems."""
    for ch in '<>:"/\\|?*':
        name = name.replace(ch, "_")
    return name.strip(". ")


def _build_api(access_token: str, user_id: str, country_code: str) -> TidalAPI:
    """Create a fresh TidalAPI client from stored credentials."""
    cache_path = TIDDL_PATH / "api_cache"
    client = TidalClient(
        token=access_token,
        cache_name=str(cache_path),
        omit_cache=True,  # We always want fresh data in a service context
    )
    return TidalAPI(client, user_id=user_id, country_code=country_code)


def _download_track_sync(
    api: TidalAPI,
    track_id: int,
    quality: str,
    output_template: str,
    dest_base: Path,
) -> dict:
    """
    Download a single track synchronously.

    Returns a dict with file info on success.
    """
    # 1. Fetch track metadata
    track = api.get_track(track_id)
    album = api.get_album(track.album.id)

    # 2. Build output path from template
    relative_path = format_template(
        template=output_template,
        item=track,
        album=album,
        with_asterisk_ext=False,
    )
    # Sanitize each path component
    parts = relative_path.split("/")
    parts = [_sanitize_path_component(p) for p in parts if p]
    relative_path = "/".join(parts)

    # 3. Get stream data
    stream = api.get_track_stream(track_id=track_id, quality=quality)
    urls, file_extension = parse_track_stream(stream)

    # Download raw bytes
    from tiddl.core.utils.download import download as download_bytes
    stream_data = download_bytes(urls)

    # 4. Write to disk
    file_path = dest_base / f"{relative_path}{file_extension}"
    file_path.parent.mkdir(parents=True, exist_ok=True)

    # Write to temp file first, then move (atomic-ish)
    tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
    tmp_path.write_bytes(stream_data)

    # 5. If FLAC, ffmpeg extraction may be needed
    if file_extension == ".flac":
        try:
            from tiddl.core.utils.ffmpeg import extract_flac
            extract_flac(tmp_path, file_path)
            tmp_path.unlink(missing_ok=True)
        except Exception:
            # Fallback — just rename
            shutil.move(str(tmp_path), str(file_path))
    else:
        shutil.move(str(tmp_path), str(file_path))

    # 6. Embed metadata
    try:
        # Fetch cover
        cover = None
        if album.cover:
            cover = Cover(album.cover)

        add_track_metadata(
            file_path=file_path,
            track=track,
            album=album,
            date=str(album.releaseDate.date()) if album.releaseDate else "",
            artist=track.artists[0].name if track.artists else "",
            credits=[],
            cover=cover,
        )
    except Exception as e:
        log.warning(f"Failed to embed metadata for track {track_id}: {e}")

    return {
        "track_id": track_id,
        "title": track.title,
        "artist": track.artists[0].name if track.artists else "Unknown",
        "album": album.title,
        "quality": stream.audioQuality,
        "file_path": str(file_path),
        "relative_path": f"{relative_path}{file_extension}",
        "file_size": file_path.stat().st_size,
    }


# ════════════════════════════════════════════════════════════════════
# Routes
# ════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {"status": "ok", "service": "tidal-downloader"}


# ── Authentication ──────────────────────────────────────────────────

@app.post("/auth/device")
async def auth_device():
    """Step 1: Initiate device-code OAuth flow. Returns a verification URL."""
    try:
        auth_api = AuthAPI()
        device_auth = auth_api.get_device_auth()
        return {
            "device_code": device_auth.deviceCode,
            "user_code": device_auth.userCode,
            "verification_uri": device_auth.verificationUri,
            "verification_uri_complete": device_auth.verificationUriComplete,
            "expires_in": device_auth.expiresIn,
            "interval": device_auth.interval,
        }
    except Exception as e:
        log.error(f"Device auth failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/token")
async def auth_token(req: AuthTokenRequest):
    """Step 2: Poll for token after user has authorised the device code."""
    try:
        auth_api = AuthAPI()
        auth_response = auth_api.get_auth(req.device_code)
        return {
            "access_token": auth_response.access_token,
            "refresh_token": auth_response.refresh_token,
            "token_type": auth_response.token_type,
            "expires_in": auth_response.expires_in,
            "user_id": str(auth_response.user.userId),
            "country_code": auth_response.user.countryCode,
            "username": auth_response.user.username,
        }
    except AuthClientError as e:
        # Expected while user hasn't authorised yet
        raise HTTPException(status_code=428, detail={
            "error": e.error,
            "sub_status": e.sub_status,
            "error_description": e.error_description,
        })
    except Exception as e:
        log.error(f"Token exchange failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/refresh")
async def auth_refresh(req: RefreshRequest):
    """Refresh an expired access token."""
    try:
        auth_api = AuthAPI()
        auth_response = auth_api.refresh_token(req.refresh_token)
        return {
            "access_token": auth_response.access_token,
            "token_type": auth_response.token_type,
            "expires_in": auth_response.expires_in,
            "user_id": str(auth_response.user.userId),
            "country_code": auth_response.user.countryCode,
        }
    except AuthClientError as e:
        raise HTTPException(status_code=401, detail={
            "error": e.error,
            "sub_status": e.sub_status,
            "error_description": e.error_description,
        })
    except Exception as e:
        log.error(f"Token refresh failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/session")
async def auth_session(tokens: AuthTokensPayload):
    """Verify that the stored tokens are still valid by calling /sessions."""
    try:
        api = _build_api(tokens.access_token, tokens.user_id, tokens.country_code)
        session = api.get_session()
        return {
            "valid": True,
            "session_id": session.sessionId,
            "user_id": session.userId,
            "country_code": session.countryCode,
        }
    except ApiError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        log.error(f"Session check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Search ──────────────────────────────────────────────────────────

@app.post("/search")
async def search(req: SearchRequest, access_token: str = "", user_id: str = "", country_code: str = "US"):
    """Search TIDAL for tracks, albums, and artists."""
    if not access_token:
        raise HTTPException(status_code=401, detail="access_token header required")

    api = _build_api(access_token, user_id, country_code)
    try:
        results = api.get_search(req.query)
        return {
            "tracks": [
                {
                    "id": t.id,
                    "title": t.title,
                    "artist": t.artists[0].name if t.artists else "Unknown",
                    "album": {"id": t.album.id, "title": t.album.title},
                    "duration": t.duration,
                    "quality": t.audioQuality,
                    "isrc": t.isrc,
                    "explicit": t.explicit,
                }
                for t in results.tracks.items[:20]
            ],
            "albums": [
                {
                    "id": a.id,
                    "title": a.title,
                    "artist": a.artist.name if a.artist else "Unknown",
                    "numberOfTracks": a.numberOfTracks,
                    "releaseDate": str(a.releaseDate) if a.releaseDate else None,
                    "type": a.type,
                    "quality": a.audioQuality,
                    "cover": a.cover,
                }
                for a in results.albums.items[:20]
            ],
            "artists": [
                {
                    "id": a.id,
                    "name": a.name,
                    "picture": a.picture,
                }
                for a in results.artists.items[:10]
            ],
        }
    except ApiError as e:
        raise HTTPException(status_code=e.status if hasattr(e, "status") else 500, detail=str(e))


# ── Download ────────────────────────────────────────────────────────

@app.post("/download/track")
async def download_track(
    req: DownloadTrackRequest,
    access_token: str = "",
    user_id: str = "",
    country_code: str = "US",
):
    """Download a single track from TIDAL."""
    if not access_token:
        raise HTTPException(status_code=401, detail="access_token required")

    api = _build_api(access_token, user_id, country_code)

    try:
        result = await asyncio.to_thread(
            _download_track_sync,
            api=api,
            track_id=req.track_id,
            quality=req.quality,
            output_template=req.output_template,
            dest_base=MUSIC_PATH,
        )
        return result
    except ApiError as e:
        log.error(f"TIDAL API error downloading track {req.track_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"Download failed for track {req.track_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/download/album")
async def download_album(
    req: DownloadAlbumRequest,
    access_token: str = "",
    user_id: str = "",
    country_code: str = "US",
):
    """Download all tracks from a TIDAL album."""
    if not access_token:
        raise HTTPException(status_code=401, detail="access_token required")

    api = _build_api(access_token, user_id, country_code)

    try:
        album = api.get_album(req.album_id)

        # Fetch all tracks
        tracks = []
        offset = 0
        while True:
            items = api.get_album_items(req.album_id, limit=100, offset=offset)
            for album_item in items.items:
                if hasattr(album_item, "item") and hasattr(album_item.item, "isrc"):
                    tracks.append(album_item.item)
            offset += items.limit
            if offset >= items.totalNumberOfItems:
                break

        results = []
        errors = []

        for i, track in enumerate(tracks):
            # Rate-limit: wait between tracks to avoid TIDAL API bans
            if i > 0:
                delay = float(os.getenv("TIDAL_TRACK_DELAY", "3"))
                log.debug(f"Rate limit: waiting {delay}s before track {i+1}/{len(tracks)}")
                await asyncio.sleep(delay)

            try:
                result = await asyncio.to_thread(
                    _download_track_sync,
                    api=api,
                    track_id=track.id,
                    quality=req.quality,
                    output_template=req.output_template,
                    dest_base=MUSIC_PATH,
                )
                results.append(result)
            except Exception as e:
                log.error(f"Failed to download track {track.id} ({track.title}): {e}")
                errors.append({
                    "track_id": track.id,
                    "title": track.title,
                    "error": str(e),
                })

        return {
            "album_id": req.album_id,
            "album_title": album.title,
            "artist": album.artist.name if album.artist else "Unknown",
            "total_tracks": len(tracks),
            "downloaded": len(results),
            "failed": len(errors),
            "tracks": results,
            "errors": errors,
        }
    except ApiError as e:
        log.error(f"TIDAL API error downloading album {req.album_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"Album download failed for {req.album_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8585)
