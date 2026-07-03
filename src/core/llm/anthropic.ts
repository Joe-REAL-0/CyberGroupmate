/**
 * llm/anthropic.ts — Anthropic Claude API 调用
 */

import type { LLMConfig } from "../config.js";
import type { ChatMessage, LLMResponse, LLMStreamResult, LLMStreamChunk } from "./types.js";

/**
 * 调用 Anthropic Claude API
 */
export async function callAnthropic(
    messages: ChatMessage[],
    config: LLMConfig,
    model: string,
    temperature: number,
    maxTokens: number,
    _thinkingLevel?: string,
    prefill?: string,
    stop?: string[],
    signal?: AbortSignal,
): Promise<LLMResponse> {
    const url = `${config.baseUrl.replace(/\/$/, "")}/messages`;

    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        ...(config.customHeaders ?? {}),
    };

    // 组装 API 消息列表
    const apiMessages = nonSystemMsgs.map((m) => {
        const hasCacheBreakpoint = !!m.cacheBreakpoint;

        // 有 imageParts 时组装为 Anthropic 多模态格式
        if (m.imageParts && m.imageParts.length > 0 && m.role === "user") {
            const parts: Array<Record<string, unknown>> = [
                { type: "text", text: m.content },
            ];
            for (const img of m.imageParts) {
                // Anthropic 需要 base64 source 格式
                const dataMatch = img.url.match(/^data:([^;]+);base64,(.+)$/);
                if (dataMatch) {
                    parts.push({
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: dataMatch[1],
                            data: dataMatch[2],
                        },
                    });
                } else {
                    // URL 格式（Anthropic 也支持）
                    parts.push({
                        type: "image",
                        source: {
                            type: "url",
                            url: img.url,
                        },
                    });
                }
            }
            if (hasCacheBreakpoint && parts.length > 0) {
                const lastPart = parts[parts.length - 1] as Record<string, unknown>;
                lastPart.cache_control = { type: "ephemeral" };
            }
            return { role: m.role, content: parts };
        }

        if (hasCacheBreakpoint) {
            return {
                role: m.role,
                content: [{
                    type: "text",
                    text: m.content,
                    cache_control: { type: "ephemeral" },
                }],
            };
        }

        return { role: m.role, content: m.content };
    });

    // Prefill: 追加 assistant 消息作为生成起点
    if (prefill) {
        apiMessages.push({ role: "assistant", content: prefill });
    }

    const body: Record<string, unknown> = {
        model,
        messages: apiMessages,
        temperature,
        max_tokens: maxTokens,
        // Stop sequences（Anthropic 使用 stop_sequences 字段）
        ...(stop && stop.length > 0 ? { stop_sequences: stop } : {}),
        // Extra body（用户自定义额外字段）
        ...(config.extraBody ?? {}),
    };

    if (systemMsg) {
        body.system = [{
            type: "text",
            text: systemMsg.content,
            cache_control: { type: "ephemeral" },
        }];
    }

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        throw new Error(
            `Anthropic API error ${response.status}: ${response.statusText} — ${responseBody}`
        );
    }

    const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
        usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        };
    };

    const text = data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");

    if (!text) {
        throw new Error(`LLM returned empty response (0 chars) from model ${model}`);
    }

    return {
        content: text,
        usage: data.usage
            ? {
                promptTokens: data.usage.input_tokens,
                completionTokens: data.usage.output_tokens,
                totalTokens:
                    (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
                cachedTokens: data.usage.cache_read_input_tokens,
                cacheCreationTokens: data.usage.cache_creation_input_tokens,
            }
            : undefined,
    };
}

/**
 * 调用 Anthropic Claude API（流式）
 *
 * 使用 SSE stream 模式逐块返回 token。
 * Anthropic SSE 事件类型：
 *   - message_start: 包含 message 元信息
 *   - content_block_start / content_block_delta: 增量内容
 *   - message_delta: usage 更新
 *   - message_stop: 完成
 */
export async function callAnthropicStream(
    messages: ChatMessage[],
    config: LLMConfig,
    model: string,
    temperature: number,
    maxTokens: number,
    _thinkingLevel?: string,
    prefill?: string,
    stop?: string[],
    signal?: AbortSignal,
): Promise<LLMStreamResult> {
    const url = `${config.baseUrl.replace(/\/$/, "")}/messages`;

    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        ...(config.customHeaders ?? {}),
    };

    // 复用与非流式完全相同的消息组装逻辑
    const apiMessages = nonSystemMsgs.map((m) => {
        const hasCacheBreakpoint = !!m.cacheBreakpoint;

        if (m.imageParts && m.imageParts.length > 0 && m.role === "user") {
            const parts: Array<Record<string, unknown>> = [
                { type: "text", text: m.content },
            ];
            for (const img of m.imageParts) {
                const dataMatch = img.url.match(/^data:([^;]+);base64,(.+)$/);
                if (dataMatch) {
                    parts.push({
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: dataMatch[1],
                            data: dataMatch[2],
                        },
                    });
                } else {
                    parts.push({
                        type: "image",
                        source: { type: "url", url: img.url },
                    });
                }
            }
            if (hasCacheBreakpoint && parts.length > 0) {
                (parts[parts.length - 1] as Record<string, unknown>).cache_control = { type: "ephemeral" };
            }
            return { role: m.role, content: parts };
        }

        if (hasCacheBreakpoint) {
            return {
                role: m.role,
                content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }],
            };
        }

        return { role: m.role, content: m.content };
    });

    if (prefill) {
        apiMessages.push({ role: "assistant", content: prefill });
    }

    const body: Record<string, unknown> = {
        model,
        messages: apiMessages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
        ...(stop && stop.length > 0 ? { stop_sequences: stop } : {}),
        ...(config.extraBody ?? {}),
    };

    if (systemMsg) {
        body.system = [{
            type: "text",
            text: systemMsg.content,
            cache_control: { type: "ephemeral" },
        }];
    }

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        throw new Error(
            `Anthropic API error ${response.status}: ${response.statusText} — ${responseBody}`
        );
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("Response body is not readable");
    }

    const streamReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let usage: LLMResponse["usage"] | undefined;

    async function* streamGenerator(): AsyncGenerator<LLMStreamChunk> {
        try {
            while (true) {
                const { done, value } = await streamReader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith("data: ")) continue;

                    const data = trimmed.slice(6);
                    try {
                        const parsed = JSON.parse(data) as {
                            type: string;
                            delta?: {
                                type?: string;
                                text?: string;
                            };
                            message?: {
                                usage?: {
                                    input_tokens?: number;
                                    output_tokens?: number;
                                    cache_read_input_tokens?: number;
                                    cache_creation_input_tokens?: number;
                                };
                            };
                            usage?: {
                                input_tokens?: number;
                                output_tokens?: number;
                            };
                        };

                        // content_block_delta 包含增量文本
                        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                            fullContent += parsed.delta.text;
                            yield { type: "delta", content: parsed.delta.text };
                        }

                        // message_delta / message_start 包含 usage
                        if (parsed.type === "message_start" && parsed.message?.usage) {
                            const u = parsed.message.usage;
                            usage = {
                                promptTokens: u.input_tokens,
                                completionTokens: u.output_tokens,
                                cachedTokens: u.cache_read_input_tokens,
                                cacheCreationTokens: u.cache_creation_input_tokens,
                            };
                        }
                        if (parsed.type === "message_delta" && parsed.usage) {
                            // message_delta 携带最终的 output_tokens
                            usage = {
                                ...(usage ?? {}),
                                completionTokens: parsed.usage.output_tokens,
                                totalTokens: (usage?.promptTokens ?? 0) + (parsed.usage.output_tokens ?? 0),
                            };
                        }

                        if (parsed.type === "message_stop") {
                            yield { type: "usage", usage };
                            yield { type: "done", content: fullContent };
                            return;
                        }
                    } catch {
                        // 跳过无法解析的 SSE 行
                    }
                }
            }
            // 流正常结束但未收到 message_stop
            yield { type: "usage", usage };
            yield { type: "done", content: fullContent };
        } finally {
            streamReader.releaseLock();
        }
    }

    return streamGenerator();
}
