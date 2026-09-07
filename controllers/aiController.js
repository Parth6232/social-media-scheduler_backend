const axios = require("axios");
const sharp = require("sharp");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ---- Auto-resolve a working Gemini model (self-healing, cost-aware) ----
// Google keeps discontinuing model versions (e.g. gemini-2.0-flash -> gemini-3.6-flash),
// and sometimes the /models list still shows a model as "usable" when it's actually
// dead for this API key. So instead of picking just one model and hoping, we build a
// ranked list — cheapest/free-tier-friendly models first, heavier ones as fallback —
// and walk down the list until one actually responds.
let cachedModelName = null;
let cachedAt = 0;
let cachedRankedList = null;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Models we've personally confirmed are dead for this API key, even if Google's
// /models list still lists them as "usable". Never pick these again.
const deadModels = new Set();

// Google's error messages for a discontinued model usually say something like:
// "...is no longer available to new users. Please update your code to use
// models/gemini-3.6-flash for the latest features..."
// Useful as a hint, but we no longer blindly trust it as the ONLY next try —
// we still rank it against the rest of the live list.
function extractSuggestedModel(message) {
    const match = /models\/([a-zA-Z0-9._-]+)/g.exec(message);
    return match ? match[1] : null;
}

// Lower score = try first. "flash-lite" is the cheapest/fastest free-tier model,
// then "flash", then "pro" (heaviest, usually paid-tier only) as last resort.
// Anything with "vision"/"embedding"/"tts"/"image" in the name isn't a text
// chat model, so it's excluded entirely.
function rankModel(name) {
    const n = name.toLowerCase();
    if (n.includes("vision") || n.includes("embedding") || n.includes("tts") || n.includes("image")) {
        return null; // not usable for text generation
    }
    if (n.includes("flash-lite") || n.includes("flash8b") || n.includes("flash-8b")) return 0;
    if (n.includes("flash")) return 1;
    if (n.includes("pro")) return 2;
    return 3; // unknown family — try last
}

// Fetches the live model list and returns it sorted cheapest-first, excluding
// anything already confirmed dead and anything not usable for text generation.
async function fetchRankedModels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedRankedList && now - cachedAt < MODEL_CACHE_TTL_MS) {
        return cachedRankedList;
    }

    const { data } = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
    );
    const models = data.models || [];

    const ranked = models
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => ({ name: m.name.replace("models/", ""), score: rankModel(m.name) }))
        .filter((m) => m.score !== null && !deadModels.has(m.name))
        .sort((a, b) => a.score - b.score)
        .map((m) => m.name);

    if (!ranked.length) {
        throw new Error("No usable Gemini text models found for this API key.");
    }

    cachedRankedList = ranked;
    cachedAt = now;
    console.log(`[Gemini] Ranked candidates (cheapest first): ${ranked.join(", ")}`);
    return ranked;
}

function isModelGoneError(message) {
    const msg = (message || "").toLowerCase();
    return (
        msg.includes("is no longer available") ||
        msg.includes("404") ||
        msg.includes("not found")
    );
}

// Transient errors — Google's servers being briefly overloaded/unavailable
// or a temporary rate limit — are NOT the model's fault, so we shouldn't mark
// it dead. Retrying after a short wait usually succeeds.
function isTransientError(message) {
    const msg = (message || "").toLowerCase();
    return (
        msg.includes("503") ||
        msg.includes("service unavailable") ||
        msg.includes("500") ||
        msg.includes("internal error") ||
        msg.includes("429") ||
        msg.includes("too many requests") ||
        msg.includes("overloaded")
    );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callModel(modelName, prompt) {
    const model = genAI.getGenerativeModel({ model: modelName });

    // Up to 3 attempts with short backoff, but only for transient errors —
    // a "model gone"/404 error fails fast so the caller can move to the next model.
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            lastError = error;
            const msg = error.message || "";
            if (!isTransientError(msg) || attempt === 3) throw error;
            const waitMs = attempt * 1500;
            console.warn(`[Gemini] Transient error on "${modelName}" (attempt ${attempt}/3), retrying in ${waitMs}ms...`);
            await sleep(waitMs);
        }
    }
    throw lastError;
}

// Tries the last known-good model first (fast path, no list fetch needed).
// If that fails because it's discontinued, walks down the ranked candidate
// list (cheapest/free-tier first, heavier models as fallback) until one
// actually responds, and caches whichever one worked.
async function generateWithAutoModel(prompt) {
    if (cachedModelName && !deadModels.has(cachedModelName)) {
        try {
            return await callModel(cachedModelName, prompt);
        } catch (error) {
            const msg = error.message || "";
            if (!isModelGoneError(msg)) throw error;
            console.warn(`[Gemini] Model "${cachedModelName}" unavailable, marking it dead and downgrading...`);
            deadModels.add(cachedModelName);
        }
    }

    // Build the candidate list fresh (excludes anything just marked dead).
    let candidates = await fetchRankedModels(true);

    // If Google's error hinted at a specific replacement, and it's not already
    // dead/in the list, try it first — but we still fall through to the rest
    // of the ranked list if even that one is gone.
    let lastError = null;
    for (const modelName of candidates) {
        try {
            const text = await callModel(modelName, prompt);
            cachedModelName = modelName;
            cachedAt = Date.now();
            console.log(`[Gemini] Using model: ${modelName}`);
            return text;
        } catch (error) {
            const msg = error.message || "";
            lastError = error;
            if (!isModelGoneError(msg)) throw error; // real error (bad key, quota, etc) — don't mask it

            console.warn(`[Gemini] Model "${modelName}" unavailable, trying next cheapest option...`);
            deadModels.add(modelName);
        }
    }

    throw lastError || new Error("No Gemini model could be reached.");
}

// POST /api/ai/generate-caption
exports.generateCaption = async (req, res) => {
    try {
        const {
            topic,
            platforms = [],
            includeCaption = true,
            includeHashtags = true,
        } = req.body;

        if (!topic || !topic.trim()) {
            return res.status(400).json({ message: "Topic/idea is required" });
        }
        if (!includeCaption && !includeHashtags) {
            return res.status(400).json({ message: "Select at least caption or hashtags to generate" });
        }

        const platformText = platforms.length ? platforms.join(", ") : "social media";

        const wantedKeys = [];
        if (includeCaption) {
            wantedKeys.push(
                `"caption": an engaging, natural-sounding, ready-to-post caption for ${platformText} about "${topic}". Use emojis sparingly, keep it human and not robotic.`
            );
        }
        if (includeHashtags) {
            wantedKeys.push(
                `"hashtags": an array of 8-12 relevant hashtags (plain words, no # symbol) related to the topic and platform.`
            );
        }

        const prompt = `You are a social media content expert. Based on this topic/idea: "${topic}", generate content for posting on ${platformText}.

Respond ONLY with a single valid JSON object — no markdown, no code fences, no explanation before or after — with exactly these keys:
{
${wantedKeys.map((k) => "  " + k).join(",\n")}
}`;

        const rawText = await generateWithAutoModel(prompt);
        const cleaned = rawText.replace(/```json|```/g, "").trim();

        let parsed;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            parsed = { caption: cleaned, hashtags: [] };
        }

        res.json({
            caption: includeCaption ? parsed.caption || "" : "",
            hashtags: includeHashtags ? parsed.hashtags || [] : [],
        });
    } catch (error) {
        console.error("AI caption generation failed:", error.message);
        res.status(500).json({ message: "AI content generation failed. Please try again." });
    }
};

// ---- Native Gemini image generation ("Nano Banana") ----
// Google's Gemini image-capable models (nano-banana*) are trained specifically
// to render legible text/typography inside generated images — unlike diffusion
// models like Pollinations/Flux, which only "approximate" letter shapes and
// garble names/words. This is exactly what powers image generation inside
// Gemini's own chat UI and gives clean results from a single plain-language
// prompt, no separate text-overlay step needed.
const IMAGE_MODEL_CANDIDATES = ["nano-banana-pro-preview", "nano-banana-preview", "gemini-2.5-flash-image"];

// We call the REST API directly with axios instead of going through the
// @google/generative-ai SDK. That SDK (v0.21) predates image-output support
// (responseModalities) and silently mishandles it — calling the endpoint
// directly is the reliable way to get image bytes back regardless of SDK version.
async function generateWithGeminiImageModel(prompt) {
    let lastError = null;
    for (const modelName of IMAGE_MODEL_CANDIDATES) {
        try {
            const { data } = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
                },
                { timeout: 60000 }
            );

            const parts = data?.candidates?.[0]?.content?.parts || [];
            const imagePart = parts.find((p) => p.inlineData?.data);

            if (imagePart) {
                console.log(`[Image] Generated with Gemini model: ${modelName}`);
                return {
                    base64: imagePart.inlineData.data,
                    mimeType: imagePart.inlineData.mimeType || "image/png",
                };
            }
            throw new Error("Response contained no image data.");
        } catch (error) {
            lastError = error;
            const apiMessage = error.response?.data?.error?.message;
            console.warn(`[Image] Gemini model "${modelName}" failed: ${apiMessage || error.message}`);
        }
    }
    throw lastError || new Error("All Gemini image models failed.");
}

// ---- Hugging Face Inference API (FLUX.1-dev) ----
// A free tier, no billing required — just a free HF account + read token.
// Quality is noticeably better than Pollinations for composition/detail, and
// the free rate limit comfortably covers a handful of images a day. Text
// rendering is still not as reliable as Gemini's native image models, so we
// keep the same "describe scene only, overlay real text after" approach.
const HF_IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell";

async function generateWithHuggingFace(prompt) {
    if (!process.env.HF_API_TOKEN) {
        throw new Error("HF_API_TOKEN not set — skipping Hugging Face.");
    }

    const response = await axios.post(
        `https://router.huggingface.co/hf-inference/models/${HF_IMAGE_MODEL}`,
        { inputs: prompt },
        {
            headers: {
                Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
                "Content-Type": "application/json",
            },
            responseType: "arraybuffer",
            timeout: 60000,
        }
    );

    // HF sometimes returns JSON (e.g. "model is loading, retry in Ns") instead
    // of image bytes — detect that and surface it as a proper error.
    const contentType = response.headers["content-type"] || "";
    if (contentType.includes("json")) {
        const message = JSON.parse(Buffer.from(response.data).toString("utf-8"));
        throw new Error(message?.error || "Hugging Face returned an unexpected response.");
    }

    console.log("[Image] Generated with Hugging Face FLUX.1-dev");
    return {
        base64: Buffer.from(response.data).toString("base64"),
        mimeType: contentType || "image/jpeg",
    };
}

// Fallback path if every Gemini image model is unavailable: Pollinations
// (Flux), with an expanded, text-free prompt + a real font overlay for any
// name/subtitle, since Flux can't be trusted to spell text correctly.
async function expandImagePrompt(topic) {
    const instruction = `You are an expert prompt engineer for AI image generators (like Midjourney/Flux).
Turn this short idea into ONE detailed, vivid image-generation prompt: "${topic}"

Describe: subject, setting, lighting, mood, color palette, composition, and art style (e.g. "cinematic photography", "digital art", "3D render") — whatever best fits the idea.
CRITICAL: Do NOT include any request for text, words, letters, names, or typography to appear in the image — describe only the visual scene. Leave clear empty space (e.g. lower third, or a banner-like area) where text could be overlaid later.
Keep it under 60 words. Respond with ONLY the prompt text, no quotes, no labels, no explanation.`;

    try {
        const expanded = await generateWithAutoModel(instruction);
        const cleaned = expanded.replace(/^["']|["']$/g, "").trim();
        return cleaned || topic;
    } catch (error) {
        console.warn("Prompt expansion failed, using raw topic instead:", error.message);
        return `${topic}, professional social media graphic, vibrant colors, high detail, empty space at the bottom for text`;
    }
}

// Escapes text so it's safe to drop into an SVG <text> element.
function escapeXml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

// Overlays real, crisp text onto the generated image using Sharp + an SVG
// layer — actual font rendering, always perfectly legible. Used only in the
// Pollinations fallback path (the Gemini path renders text natively).
async function overlayText(imageBuffer, lines, { width, height }) {
    if (!lines || !lines.length) return imageBuffer;

    const fontSize = Math.round(width * 0.055);
    const lineHeight = fontSize * 1.3;
    const startY = height - lineHeight * lines.length - height * 0.06;

    const textElements = lines
        .map((line, i) => {
            const y = startY + i * lineHeight;
            return `
        <text x="50%" y="${y}" font-family="Georgia, 'Times New Roman', serif"
              font-size="${fontSize}" font-weight="700" fill="#ffffff"
              text-anchor="middle" stroke="#00000099" stroke-width="${fontSize * 0.06}"
              paint-order="stroke">${escapeXml(line)}</text>`;
        })
        .join("");

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000000" stop-opacity="0" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.55" />
          </linearGradient>
        </defs>
        <rect x="0" y="${height * 0.62}" width="${width}" height="${height * 0.38}" fill="url(#fade)" />
        ${textElements}
      </svg>`;

    return sharp(imageBuffer)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 92 })
        .toBuffer();
}

async function generateImageViaHuggingFace(richPrompt, name, subtitle) {
    const raw = await generateWithHuggingFace(richPrompt);
    let imageBuffer = Buffer.from(raw.base64, "base64");

    const overlayLines = [name, subtitle].filter((l) => l && l.trim());
    if (overlayLines.length) {
        imageBuffer = await overlayText(imageBuffer, overlayLines, { width: 1024, height: 1024 });
    }

    return {
        base64: imageBuffer.toString("base64"),
        mimeType: overlayLines.length ? "image/jpeg" : raw.mimeType,
    };
}

async function generateImageViaPollinationsFallback(richPrompt, name, subtitle) {
    console.log(`[Image] (Pollinations) prompt: ${richPrompt}`);

    const encodedPrompt = encodeURIComponent(richPrompt);
    const seed = Math.floor(Math.random() * 1000000);
    const width = 1024;
    const height = 1024;
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux&enhance=true`;

    const response = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 60000 });
    let imageBuffer = Buffer.from(response.data, "binary");
    const contentType = response.headers["content-type"] || "image/jpeg";

    const overlayLines = [name, subtitle].filter((l) => l && l.trim());
    if (overlayLines.length) {
        imageBuffer = await overlayText(imageBuffer, overlayLines, { width, height });
    }

    return {
        base64: imageBuffer.toString("base64"),
        mimeType: overlayLines.length ? "image/jpeg" : contentType,
    };
}

// POST /api/ai/generate-image
// Body: { topic: string, name?: string, subtitle?: string }
// Tries three tiers in order, falling through on any failure:
//  1. Gemini native image models — best text rendering, but only attempted if
//     GEMINI_IMAGE_MODELS_ENABLED=true (needs a billing-enabled Google AI
//     Studio account; free tier currently gives these models 0 quota).
//  2. Hugging Face FLUX.1-dev — free (just needs HF_API_TOKEN), noticeably
//     better composition/detail than Pollinations, good for a handful of
//     images a day within the free rate limit.
//  3. Pollinations (Flux) — always available, no token needed, unlimited.
// Tiers 2 & 3 never ask the image model to render text (diffusion models
// can't spell reliably) — any name/subtitle is overlaid afterward with Sharp,
// which is guaranteed legible since it's real font rendering.
const GEMINI_IMAGE_MODELS_ENABLED = process.env.GEMINI_IMAGE_MODELS_ENABLED === "true";

exports.generateImage = async (req, res) => {
    try {
        const { topic, name, subtitle } = req.body;
        if (!topic || !topic.trim()) {
            return res.status(400).json({ message: "Topic/idea is required" });
        }
        const trimmedTopic = topic.trim();

        let image;

        // Tier 1: Gemini native (text-in-image capable), opt-in only.
        if (GEMINI_IMAGE_MODELS_ENABLED) {
            const extras = [name && `Include the name "${name}" prominently in the design.`, subtitle && `Include this line too: "${subtitle}"`]
                .filter(Boolean)
                .join(" ");
            const geminiPrompt = `Create a polished, professional social media graphic for: ${trimmedTopic}. ${extras} Make any text large, clean, and perfectly legible. High quality, vibrant, professional design.`;
            try {
                image = await generateWithGeminiImageModel(geminiPrompt);
            } catch (geminiError) {
                console.warn("[Image] Gemini image models failed, trying next tier:", geminiError.message);
            }
        }

        // Shared, text-free descriptive prompt for tiers 2 & 3.
        const richPrompt = image ? null : await expandImagePrompt(trimmedTopic);

        // Tier 2: Hugging Face FLUX.1-dev, if a token is configured.
        if (!image) {
            try {
                image = await generateImageViaHuggingFace(richPrompt, name, subtitle);
            } catch (hfError) {
                console.warn("[Image] Hugging Face failed, trying next tier:", hfError.message);
            }
        }

        // Tier 3: Pollinations — always works.
        if (!image) {
            image = await generateImageViaPollinationsFallback(richPrompt, name, subtitle);
        }

        res.json({ image: `data:${image.mimeType};base64,${image.base64}` });
    } catch (error) {
        console.error("AI image generation failed:", error.message);
        res.status(500).json({ message: "AI image generation failed. Please try again." });
    }
};