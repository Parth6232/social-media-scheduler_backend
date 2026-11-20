// FFmpeg se ek clip banata hai: cut -> 9:16 (1080x1920) -> captions + credit -> audio mix -> MP4
const fs = require("fs");
const path = require("path");
const cfg = require("../../config/shortsConfig");
const { run } = require("./runCommand");

const pad = (n, l = 2) => String(n).padStart(l, "0");
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

function assTime(sec) {
    const cs = Math.max(0, Math.round(sec * 100));
    return `${Math.floor(cs / 360000)}:${pad(Math.floor((cs % 360000) / 6000))}:${pad(Math.floor((cs % 6000) / 100))}.${pad(cs % 100)}`;
}
const assText = (t) => String(t).replace(/[{}]/g, "").replace(/\r?\n/g, " ").trim();

// Transcript ke words se chhote caption blocks (3-4 words) banata hai
function buildCaptionLines(transcript, start, end) {
    const words = [];
    for (const seg of transcript.segments) {
        if (seg.end < start || seg.start > end) continue;
        if (seg.words && seg.words.length) {
            seg.words.forEach((w) => {
                if (w.start >= start - 0.05 && w.start < end) words.push({ s: w.start, e: Math.min(w.end, end), t: w.word });
            });
        } else {
            // word timing nahi hai => segment ko barabar baant do
            const parts = seg.text.split(/\s+/).filter(Boolean);
            const step = (seg.end - seg.start) / Math.max(1, parts.length);
            parts.forEach((t, i) => {
                const s = seg.start + i * step;
                if (s >= start - 0.05 && s < end) words.push({ s, e: s + step, t });
            });
        }
    }
    const lines = [];
    let cur = [];
    const flush = () => {
        if (!cur.length) return;
        lines.push({ s: cur[0].s - start, e: cur[cur.length - 1].e - start, text: cur.map((w) => w.t).join(" ") });
        cur = [];
    };
    for (const w of words) {
        if (cur.length && (cur.length >= 4 || w.s - cur[cur.length - 1].e > 0.7 || w.e - cur[0].s > 2.4)) flush();
        cur.push(w);
    }
    flush();
    // line tab tak dikhe jab tak agla shuru na ho (flicker kam)
    lines.forEach((l, i) => {
        const next = lines[i + 1];
        l.e = Math.max(l.e, l.s + 0.4);
        if (next && next.s - l.e < 0.35) l.e = next.s;
    });
    return lines;
}

function buildAss({ captionLines, credit, duration }) {
    const font = cfg.CAPTION_FONT;
    const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${cfg.OUT_W}
PlayResY: ${cfg.OUT_H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${font},68,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,5,1,2,70,70,430,1
Style: Credit,${font},36,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,8,60,60,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const rows = [];
    if (credit) rows.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Credit,,0,0,0,,${assText(credit)}`);
    captionLines.forEach((l) => rows.push(`Dialogue: 1,${assTime(l.s)},${assTime(l.e)},Caption,,0,0,0,,${assText(l.text)}`));
    return head + rows.join("\n") + "\n";
}

// Layout decide: facecam option ON + face mila => split/follow, warna center
function chooseLayout(options, meta, face) {
    if (!options.facecamCrop || !face || meta.width <= meta.height) return { type: "center" };
    return face.kind === "overlay" ? { type: "facecam_split", face } : { type: "follow_face", face };
}

function videoGraph(layout, meta) {
    const W = cfg.OUT_W, H = cfg.OUT_H;
    const iw = meta.width, ih = meta.height;
    const centerGraph = `[0:v]fps=30,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[vcomp]`;

    if (layout.type === "follow_face") {
        const cw = even((ih * 9) / 16);
        if (cw >= iw) return { graph: centerGraph, used: "center" };
        const x = Math.round(clamp(layout.face.face.cx * iw - cw / 2, 0, iw - cw));
        return { graph: `[0:v]fps=30,crop=${cw}:${ih}:${x}:0,scale=${W}:${H}:flags=lanczos,setsar=1[vcomp]`, used: "follow_face" };
    }

    if (layout.type === "facecam_split") {
        const topH = 640, botH = H - topH; // 640 + 1280
        const f = layout.face.face;
        let bw = f.w * iw * 2.2;
        const aspect = W / topH;
        if ((bw / aspect) < f.h * ih * 1.7) bw = f.h * ih * 1.7 * aspect;
        bw = Math.min(bw, iw);
        let bh = bw / aspect;
        if (bh > ih) { bh = ih; bw = bh * aspect; }
        const BW = even(bw), BH = even(bh);
        const bx = Math.round(clamp(f.cx * iw - BW / 2, 0, iw - BW));
        const by = Math.round(clamp(f.cy * ih - BH / 2, 0, ih - BH));
        const cw = even(ih * (W / botH));
        if (cw >= iw) return { graph: centerGraph, used: "center" };
        const cx = Math.round((iw - cw) / 2);
        return {
            graph:
                `[0:v]fps=30,split=2[s1][s2];` +
                `[s1]crop=${BW}:${BH}:${bx}:${by},scale=${W}:${topH}:flags=lanczos,setsar=1[top];` +
                `[s2]crop=${cw}:${ih}:${cx}:0,scale=${W}:${botH}:flags=lanczos,setsar=1[bot];` +
                `[top][bot]vstack=inputs=2[vcomp]`,
            used: "facecam_split",
        };
    }
    return { graph: centerGraph, used: "center" };
}

// Audio: original voice ON/OFF + music (volume) + voiceover
function audioGraph({ options, meta, hasMusic, hasVoice, duration }) {
    const parts = [];
    const labels = [];
    let nextInput = 1;

    if (options.originalAudio && meta.hasAudio) {
        parts.push(`[0:a]volume=1.0[a0]`);
        labels.push("a0");
    }
    if (hasMusic) {
        const i = nextInput++;
        const vol = clamp(Number(options.musicVolume) / 100, 0, 1.5);
        parts.push(`[${i}:a]atrim=0:${duration.toFixed(2)},asetpts=PTS-STARTPTS,volume=${vol.toFixed(2)},afade=t=out:st=${Math.max(0, duration - 1.5).toFixed(2)}:d=1.5[a1]`);
        labels.push("a1");
    }
    if (hasVoice) {
        const i = nextInput++;
        const vol = clamp(Number(options.voiceoverVolume ?? 100) / 100, 0, 2);
        parts.push(`[${i}:a]volume=${vol.toFixed(2)}[a2]`);
        labels.push("a2");
    }
    if (!labels.length) return { graph: "", label: null };

    if (labels.length === 1) {
        parts.push(`[${labels[0]}]alimiter=limit=0.95[aout]`);
    } else {
        parts.push(`${labels.map((l) => `[${l}]`).join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`);
    }
    return { graph: parts.join(";"), label: "aout" };
}

async function renderClip({ sourceVideo, meta, clip, outDir, index, options, credit, transcript, musicFile, voiceFile, face, timeOffset = 0 }) {
    const duration = clip.end - clip.start;
    const base = `clip_${index}`;
    const outName = `${base}.mp4`;

    const layout = chooseLayout(options, meta, face);
    const v = videoGraph(layout, meta);

    const captionLines = options.captions ? buildCaptionLines(transcript, clip.start, clip.end) : [];
    fs.writeFileSync(path.join(outDir, `${base}.ass`), buildAss({ captionLines, credit, duration }), "utf8");

    const a = audioGraph({ options, meta, hasMusic: !!musicFile, hasVoice: !!voiceFile, duration });

    const graph = [v.graph, `[vcomp]ass=${base}.ass[vout]`, a.graph].filter(Boolean).join(";");

    const args = ["-y", "-hide_banner", "-loglevel", "error", "-ss", (clip.start + timeOffset).toFixed(2), "-t", duration.toFixed(2), "-i", sourceVideo]; // timeOffset: range wali poori file me seek
    if (musicFile) args.push("-stream_loop", "-1", "-i", musicFile);
    if (voiceFile) args.push("-i", voiceFile);
    args.push("-filter_complex", graph, "-map", "[vout]");
    if (a.label) args.push("-map", `[${a.label}]`, "-c:a", "aac", "-b:a", "160k");
    else args.push("-an");
    args.push("-t", duration.toFixed(2), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outName);

    // cwd = outDir => ass file ka relative naam use hota hai (Windows path escaping ka jhanjhat nahi)
    await run(cfg.FFMPEG, args, { cwd: outDir });

    const thumbName = `${base}.jpg`;
    await run(cfg.FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-ss", "1", "-i", outName, "-frames:v", "1", "-vf", "scale=360:-1", thumbName], { cwd: outDir });
    fs.unlinkSync(path.join(outDir, `${base}.ass`));

    return { file: outName, thumb: thumbName, layout: v.used, sizeBytes: fs.statSync(path.join(outDir, outName)).size };
}

module.exports = { renderClip, buildCaptionLines, buildAss };
