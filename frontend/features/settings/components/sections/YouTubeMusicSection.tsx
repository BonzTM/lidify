"use client";

import { useState, useEffect, useCallback } from "react";
import { SettingsSection, SettingsRow, SettingsToggle, SettingsSelect, SettingsInput } from "../ui";
import { UserSettings, SystemSettings } from "../../types";
import { api } from "@/lib/api";
import { CheckCircle, XCircle, Loader2, ExternalLink, Trash2, Copy } from "lucide-react";

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

            {settings.ytMusicEnabled && (
                <>
                    <SettingsRow
                        label="Client ID"
                        description={
                            <>
                                Google OAuth client ID (
                                <a
                                    href="https://console.cloud.google.com/apis/credentials"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:underline"
                                >
                                    create one here
                                </a>
                                {" "}— select &quot;TVs and Limited Input devices&quot;)
                            </>
                        }
                    >
                        <SettingsInput
                            value={settings.ytMusicClientId || ""}
                            onChange={(v) => onUpdate({ ytMusicClientId: v })}
                            placeholder="Enter Client ID"
                            className="w-64"
                        />
                    </SettingsRow>

                    <SettingsRow
                        label="Client Secret"
                        description="Corresponding client secret for the OAuth app"
                    >
                        <SettingsInput
                            type="password"
                            value={settings.ytMusicClientSecret || ""}
                            onChange={(v) => onUpdate({ ytMusicClientSecret: v })}
                            placeholder="Enter Client Secret"
                            className="w-64"
                        />
                    </SettingsRow>
                </>
            )}
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
        credentialsConfigured: boolean;
    } | null>(null);
    const [statusLoading, setStatusLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Device code flow state
    const [deviceCode, setDeviceCode] = useState<string | null>(null);
    const [userCode, setUserCode] = useState<string | null>(null);
    const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
    const [linking, setLinking] = useState(false);
    const [polling, setPolling] = useState(false);
    const [copied, setCopied] = useState(false);

    // Check status on mount
    useEffect(() => {
        checkStatus();
    }, []);

    // Polling effect
    useEffect(() => {
        if (!polling || !deviceCode) return;

        const interval = setInterval(async () => {
            try {
                const result = await api.pollYtMusicAuth(deviceCode);

                if (result.status === "success") {
                    setPolling(false);
                    setDeviceCode(null);
                    setUserCode(null);
                    setVerificationUrl(null);
                    setSuccess("YouTube Music account connected successfully!");
                    setError(null);
                    await checkStatus();
                } else if (result.status === "error") {
                    setPolling(false);
                    setDeviceCode(null);
                    setUserCode(null);
                    setVerificationUrl(null);
                    setError(result.error || "Authorization failed. Please try again.");
                }
                // "pending" — keep polling
            } catch (err: any) {
                // Don't stop polling on transient errors
                console.debug("Poll error (retrying):", err);
            }
        }, 5000); // Poll every 5 seconds

        return () => clearInterval(interval);
    }, [polling, deviceCode]);

    const checkStatus = useCallback(async () => {
        setStatusLoading(true);
        try {
            const res = await api.getYtMusicStatus();
            setStatus(res);
        } catch (err) {
            setStatus({ enabled: false, available: false, authenticated: false, credentialsConfigured: false });
        } finally {
            setStatusLoading(false);
        }
    }, []);

    const handleLinkAccount = async () => {
        setLinking(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await api.initiateYtMusicAuth();
            setDeviceCode(result.device_code);
            setUserCode(result.user_code);
            setVerificationUrl(result.verification_url);
            setPolling(true);
        } catch (err: any) {
            setError(err.message || "Failed to start authentication. Check admin credentials.");
        } finally {
            setLinking(false);
        }
    };

    const handleCancelLink = () => {
        setPolling(false);
        setDeviceCode(null);
        setUserCode(null);
        setVerificationUrl(null);
        setError(null);
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

    const handleCopyCode = async () => {
        if (!userCode) return;
        try {
            await navigator.clipboard.writeText(userCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback for non-secure contexts
            const textarea = document.createElement("textarea");
            textarea.value = userCode;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
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

            {/* Device Code Auth Flow (not authenticated) */}
            {!status?.authenticated && status?.available && (
                <div className="px-4 py-3 space-y-3">
                    {/* Not in linking flow — show Link Account button */}
                    {!userCode && !polling && (
                        <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333] space-y-3">
                            {!status.credentialsConfigured ? (
                                <p className="text-sm text-amber-400/70">
                                    An administrator needs to configure YouTube Music OAuth credentials before you can connect.
                                </p>
                            ) : (
                                <>
                                    <p className="text-sm text-gray-300">
                                        Click below to link your YouTube Music account. You&apos;ll be given a code to enter on Google&apos;s website.
                                    </p>
                                    <button
                                        onClick={handleLinkAccount}
                                        disabled={linking}
                                        className="px-4 py-2 text-sm bg-red-600 text-white rounded-full
                                            hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                                            flex items-center gap-2"
                                    >
                                        {linking ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <ExternalLink className="w-4 h-4" />
                                        )}
                                        {linking ? "Starting..." : "Link YouTube Music Account"}
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* In linking flow — show device code + verification URL */}
                    {userCode && verificationUrl && polling && (
                        <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333] space-y-4">
                            <div className="space-y-2">
                                <p className="text-sm text-gray-300">
                                    Go to the link below and enter this code:
                                </p>
                                <div className="flex items-center gap-3">
                                    <code className="px-4 py-2 text-lg font-mono font-bold tracking-wider bg-[#252525] text-white rounded-lg border border-[#444]">
                                        {userCode}
                                    </code>
                                    <button
                                        onClick={handleCopyCode}
                                        className="p-2 text-gray-400 hover:text-white transition-colors"
                                        title="Copy code"
                                    >
                                        {copied ? (
                                            <CheckCircle className="w-4 h-4 text-green-400" />
                                        ) : (
                                            <Copy className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            <a
                                href={`${verificationUrl}?user_code=${userCode}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-full
                                    hover:bg-blue-700 transition-colors"
                            >
                                <ExternalLink className="w-4 h-4" />
                                Open Google Sign-In
                            </a>

                            <div className="flex items-center gap-2 text-sm text-gray-400">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>Waiting for you to complete sign-in...</span>
                            </div>

                            <button
                                onClick={handleCancelLink}
                                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    )}

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

            {/* Success message (shown when already authenticated) */}
            {status?.authenticated && success && (
                <div className="px-4 py-2">
                    <div className="flex items-center gap-2 text-sm text-green-400">
                        <CheckCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{success}</span>
                    </div>
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
