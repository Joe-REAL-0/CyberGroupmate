/**
 * llm/openai.ts — OpenAI 兼容 API 调用
 */

import type { LLMConfig } from "../config.js";
import type { ChatMessage, LLMResponse, LLMStreamResult, LLMStreamChunk } from "./types.js";

/**
 * 调用 OpenAI 兼容 API
 */
export async function callOpenAI(
    messages: ChatMessage[],
    config: LLMConfig,
    model: string,
    temperature: number,
    maxTokens: number,
    thinkingLevel?: string,
    prefill?: string,
    stop?: string[],
    signal?: AbortSignal,
): Promise<LLMResponse> {
    const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(config.customHeaders ?? {}),
    };
    if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    // 组装 API 消息列表（含可选 prefill）
    const apiMessages = messages.map(m => {
        // 有 imageParts 时组装为多模态 content parts
        if (m.imageParts && m.imageParts.length > 0 && m.role === "user") {
            const parts: Array<Record<string, unknown>> = [
                { type: "text", text: m.content },
            ];
            for (const img of m.imageParts) {
                parts.push({
                    type: "image_url",
                    image_url: {
                        url: img.url,
                        ...(img.detail ? { detail: img.detail } : {}),
                    },
                });
            }
            return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
    });

    // Prefill: 追加 assistant 消息作为生成起点
    if (prefill) {
        apiMessages.push({ role: "assistant", content: prefill });
    }

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model,
            messages: apiMessages,
            temperature,
            max_tokens: maxTokens,
            // Gemini thinking 参数（OpenAI 兼容格式：reasoning_effort）
            ...(thinkingLevel && thinkingLevel !== "none" ? {
                reasoning_effort: thinkingLevel,
            } : {}),
            // Stop sequences
            ...(stop && stop.length > 0 ? { stop } : {}),
            // Extra body（用户自定义额外字段）
            ...(config.extraBody ?? {}),
        }),
        signal,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `OpenAI API error ${response.status}: ${response.statusText} — ${body}`
        );
    }

    const data = (await response.json()) as {
        choices: Array<{
            message: {
                content: string | null;
                /** 部分模型（DeepSeek-R1、QwQ 等）将思考过程放在此字段，必须与正式回复分离 */
                reasoning_content?: string | null;
            };
        }>;
        usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            prompt_tokens_details?: {
                cached_tokens?: number;
            };
        };
    };

    const message = data.choices?.[0]?.message;
    // reasoning_content 是模型内部推理，绝不混入回复内容
    const content = message?.content ?? "";

    if (!content) {
        throw new Error(`LLM returned empty response (0 chars) from model ${model}`);
    }

    return {
        content,
        usage: data.usage
            ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
                cachedTokens: data.usage.prompt_tokens_details?.cached_tokens,
            }
            : undefined,
    };
}

/**
 * 调用 OpenAI 兼容 API（流式）
 *
 * 使用 SSE stream 模式逐块返回 token，减少首 token 延迟感知。
 * 返回一个 AsyncIterable<LLMStreamChunk>，调用方可逐块消费。
 */
export async function callOpenAIStream(
    messages: ChatMessage[],
    config: LLMConfig,
    model: string,
    temperature: number,
    maxTokens: number,
    thinkingLevel?: string,
    prefill?: string,
    stop?: string[],
    signal?: AbortSignal,
): Promise<LLMStreamResult> {
    const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(config.customHeaders ?? {}),
    };
    if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    // 组装 API 消息列表（含可选 prefill）—与非流式路径完全一致
    const apiMessages = messages.map(m => {
        if (m.imageParts && m.imageParts.length > 0 && m.role === "user") {
            const parts: Array<Record<string, unknown>> = [
                { type: "text", text: m.content },
            ];
            for (const img of m.imageParts) {
                parts.push({
                    type: "image_url",
                    image_url: {
                        url: img.url,
                        ...(img.detail ? { detail: img.detail } : {}),
                    },
                });
            }
            return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
    });

    if (prefill) {
        apiMessages.push({ role: "assistant", content: prefill });
    }

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model,
            messages: apiMessages,
            temperature,
            max_tokens: maxTokens,
            stream: true,
            stream_options: { include_usage: true },
            ...(thinkingLevel && thinkingLevel !== "none" ? {
                reasoning_effort: thinkingLevel,
            } : {}),
            ...(stop && stop.length > 0 ? { stop } : {}),
            ...(config.extraBody ?? {}),
        }),
        signal,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `OpenAI API error ${response.status}: ${response.statusText} — ${body}`
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

                // SSE: 每条消息以 "data: " 开头，以 "\n\n" 分隔
                const lines = buffer.split("\n");
                // 保留最后一行（可能不完整）
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith("data: ")) continue;

                    const data = trimmed.slice(6);
                    if (data === "[DONE]") {
                        yield { type: "usage", usage };
                        yield { type: "done", content: fullContent };
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data) as {
                            choices?: Array<{
                                delta?: {
                                    content?: string | null;
                                    reasoning_content?: string | null;
                                };
                            }>;
                            usage?: {
                                prompt_tokens?: number;
                                completion_tokens?: number;
                                total_tokens?: number;
                                prompt_tokens_details?: {
                                    cached_tokens?: number;
                                };
                            };
                        };

                        const delta = parsed.choices?.[0]?.delta;
                        // reasoning_content 是模型内部推理，不混入回复内容
                        const text = delta?.content ?? "";
                        if (text) {
                            fullContent += text;
                            yield { type: "delta", content: text };
                        }

                        if (parsed.usage) {
                            usage = {
                                promptTokens: parsed.usage.prompt_tokens,
                                completionTokens: parsed.usage.completion_tokens,
                                totalTokens: parsed.usage.total_tokens,
                                cachedTokens: parsed.usage.prompt_tokens_details?.cached_tokens,
                            };
                        }
                    } catch {
                        // 跳过无法解析的 SSE 行
                    }
                }
            }
            // 流正常结束但未收到 [DONE]
            yield { type: "usage", usage };
            yield { type: "done", content: fullContent };
        } finally {
            streamReader.releaseLock();
        }
    }

    return streamGenerator();
}
