"use client";

import { useState, useEffect, useCallback } from "react";
import { SettingsSection, SettingsRow, SettingsToggle, SettingsSelect } from "../ui";
import { UserSettings, SystemSettings } from "../../types";
import { api } from "@/lib/api";
import { CheckCircle, XCircle, Loader2, Upload, Trash2 } from "lucide-react";

// ── Admin Section: enable/disable toggle (system-wide) ─────────────

interface YouTubeMusicAdminSectionProps {
    settings: SystemSettings;
    onUpdate: (updates: Partial<SystemSettings>) => void;
}

export function YouTubeMusicAdminSection({ settings, onUpdate }: YouTubeMusicAdminSectionProps) {
    return (
        <SettingsSection
            id="youtube-music-admin"
            title="YouTube Music"
            description="Enable or disable YouTube Music integration for all users"
        >
            <SettingsRow
                label="Enable YouTube Music"
                description="Allow users to connect their own YouTube Music accounts for gap-fill streaming"
            >
                <SettingsToggle
                    checked={settings.ytMusicEnabled}
                    onChange={(v) => onUpdate({ ytMusicEnabled: v })}
                />
            </SettingsRow>
        </SettingsSection>
    );
}

// ── User Section: per-user OAuth + quality settings ────────────────

interface YouTubeMusicSectionProps {
    settings: UserSettings;
    onUpdate: (updates: Partial<UserSettings>) => void;
}

export function YouTubeMusicSection({ settings, onUpdate }: YouTubeMusicSectionProps) {
    const [status, setStatus] = useState<{
        enabled: boolean;
        available: boolean;
        authenticated: boolean;
    } | null>(null);
    const [statusLoading, setStatusLoading] = useState(false);
    const [oauthInput, setOauthInput] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Check status on mount
    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = useCallback(async () => {
        setStatusLoading(true);
        try {
            const res = await api.getYtMusicStatus();
            setStatus(res);
        } catch (err) {
            setStatus({ enabled: false, available: false, authenticated: false });
        } finally {
            setStatusLoading(false);
        }
    }, []);

    const handleSaveOAuth = async () => {
        if (!oauthInput.trim()) {
            setError("Please paste your OAuth JSON credentials");
            return;
        }

        // Validate JSON
        try {
            JSON.parse(oauthInput.trim());
        } catch {
            setError("Invalid JSON. Make sure you copied the full OAuth JSON output.");
            return;
        }

        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            await api.saveYtMusicOAuthToken(oauthInput.trim());
            setSuccess("YouTube Music account connected successfully!");
            setOauthInput("");
            await checkStatus();
        } catch (err: any) {
            setError(err.message || "Failed to save OAuth credentials");
        } finally {
            setSaving(false);
        }
    };

    const handleClearAuth = async () => {
        try {
            await api.clearYtMusicAuth();
            setStatus(prev => prev ? { ...prev, authenticated: false } : prev);
            setSuccess(null);
            setError(null);
        } catch (err) {
            console.error("Failed to clear YouTube Music auth:", err);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            setOauthInput(content);
            setError(null);
        };
        reader.readAsText(file);
    };

    const qualityOptions = [
        { value: "LOW", label: "Low (64 kbps)" },
        { value: "MEDIUM", label: "Medium (128 kbps)" },
        { value: "HIGH", label: "High (256 kbps)" },
        { value: "LOSSLESS", label: "Lossless (best available)" },
    ];

    // If not enabled by admin, show a message
    if (status && !status.enabled) {
        return (
            <SettingsSection
                id="youtube-music"
                title="YouTube Music"
                description="Stream music from YouTube Music for tracks missing from your local library"
            >
                <div className="px-4 py-3">
                    <p className="text-sm text-gray-500">
                        YouTube Music integration is not enabled. Ask your administrator to enable it.
                    </p>
                </div>
            </SettingsSection>
        );
    }

    return (
        <SettingsSection
            id="youtube-music"
            title="YouTube Music"
            description="Connect your YouTube Music account to stream tracks not in your library"
        >
            {/* Connection Status */}
            <SettingsRow
                label="Connection Status"
                description={
                    statusLoading
                        ? "Checking..."
                        : !status?.available
                          ? "YouTube Music service is not available"
                          : status.authenticated
                            ? "Connected to YouTube Music"
                            : "Not connected"
                }
            >
                <div className="flex items-center gap-2">
                    {statusLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    ) : status?.authenticated ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className="text-sm text-gray-300">
                        {statusLoading
                            ? "Checking..."
                            : status?.authenticated
                              ? "Authenticated"
                              : "Not authenticated"}
                    </span>
                </div>
            </SettingsRow>

            {/* OAuth Setup (not authenticated) */}
            {!status?.authenticated && status?.available && (
                <div className="px-4 py-3 space-y-3">
                    <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333] space-y-3">
                        <p className="text-sm text-gray-300">
                            To connect your YouTube Music account, you need to provide OAuth credentials.
                        </p>
                        <p className="text-xs text-gray-500">
                            Run <code className="px-1 py-0.5 bg-[#252525] rounded text-gray-400">ytmusicapi oauth</code> on
                            your computer, complete the Google sign-in, then paste or upload the resulting JSON below.
                        </p>

                        <textarea
                            value={oauthInput}
                            onChange={(e) => {
                                setOauthInput(e.target.value);
                                setError(null);
                            }}
                            placeholder='Paste your OAuth JSON here (starts with { "access_token": ...})'
                            className="w-full h-24 px-3 py-2 text-xs font-mono bg-[#111] text-gray-300
                                border border-[#333] rounded-lg resize-none focus:outline-none focus:border-[#555]"
                        />

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleSaveOAuth}
                                disabled={saving || !oauthInput.trim()}
                                className="px-4 py-2 text-sm bg-red-600 text-white rounded-full
                                    hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                                    flex items-center gap-2"
                            >
                                {saving ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Upload className="w-4 h-4" />
                                )}
                                {saving ? "Connecting..." : "Connect Account"}
                            </button>

                            <label
                                className="px-4 py-2 text-sm bg-[#333] text-white rounded-full
                                    hover:bg-[#404040] transition-colors cursor-pointer"
                            >
                                Upload JSON File
                                <input
                                    type="file"
                                    accept=".json"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                            </label>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-sm text-red-400">
                                <XCircle className="w-4 h-4 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {success && (
                            <div className="flex items-center gap-2 text-sm text-green-400">
                                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                <span>{success}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Not available warning */}
            {!status?.available && !statusLoading && (
                <div className="px-4 py-2">
                    <p className="text-xs text-amber-400/70">
                        The YouTube Music streamer service is not running.
                        Make sure the ytmusic-streamer container is started.
                    </p>
                </div>
            )}

            {/* Disconnect button */}
            {status?.authenticated && (
                <div className="px-4 py-2">
                    <button
                        onClick={handleClearAuth}
                        className="px-4 py-1.5 text-sm bg-[#333] text-white rounded-full
                            hover:bg-[#404040] transition-colors flex items-center gap-2"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        Disconnect YouTube Music
                    </button>
                </div>
            )}

            {/* Quality Selection */}
            <SettingsRow
                label="Streaming Quality"
                description="Audio quality for YouTube Music streams"
            >
                <SettingsSelect
                    value={settings.ytMusicQuality}
                    onChange={(v) =>
                        onUpdate({
                            ytMusicQuality: v as UserSettings["ytMusicQuality"],
                        })
                    }
                    options={qualityOptions}
                />
            </SettingsRow>
        </SettingsSection>
    );
}
