/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sioaeko and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent, net } from "electron";

const MAX_CHUNK_SIZE = 10 * 1024 * 1024;

function parseAttachmentUrl(value: unknown): URL | null {
    if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;

    try {
        const parsed = new URL(value);
        if (
            parsed.protocol !== "https:"
            || parsed.username || parsed.password
            || (parsed.port && parsed.port !== "443")
            || !["cdn.discordapp.com", "media.discordapp.net"].includes(parsed.hostname)
            || !parsed.pathname.startsWith("/attachments/")
        ) return null;
        return parsed;
    } catch {
        return null;
    }
}

async function readBody(response: Response): Promise<{ data?: ArrayBuffer; error?: string; }> {
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_CHUNK_SIZE) return { error: "Chunk exceeds the 10MB limit" };

    const reader = response.body?.getReader();
    if (!reader) return { error: "Attachment response has no body" };

    const parts: Uint8Array[] = [];
    let total = 0;

    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > MAX_CHUNK_SIZE) {
                await reader.cancel();
                return { error: "Chunk exceeds the 10MB limit" };
            }
            parts.push(part.value);
        }
    } catch {
        return { error: "Attachment download failed" };
    }

    const data = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        data.set(part, offset);
        offset += part.byteLength;
    }
    return { data: data.buffer };
}

export async function fetchChunk(
    _: IpcMainInvokeEvent,
    url: unknown
): Promise<{ success: boolean; data?: ArrayBuffer; contentType?: string; error?: string; }> {
    const current = parseAttachmentUrl(url);
    if (!current) return { success: false, error: "Unsupported attachment URL" };

    let response: Response;
    try {
        response = await net.fetch(current.toString(), { redirect: "error" });
    } catch {
        return { success: false, error: "Attachment download failed; redirects are not supported" };
    }

    if (!response.ok) {
        return { success: false, error: `Attachment request failed with HTTP ${response.status}` };
    }

    const body = await readBody(response);
    if (!body.data) return { success: false, error: body.error ?? "Attachment download failed" };
    return {
        success: true,
        data: body.data,
        contentType: response.headers.get("content-type") ?? ""
    };
}
