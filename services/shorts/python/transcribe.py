"""Whisper se audio -> transcript JSON (word timestamps ke saath).
Usage: python transcribe.py <audio.wav> <out.json> [model]
"""
import json
import sys

from faster_whisper import WhisperModel

audio, out_path = sys.argv[1], sys.argv[2]
model_name = sys.argv[3] if len(sys.argv) > 3 else "base"

model = WhisperModel(model_name, device="auto", compute_type="int8")
segments, info = model.transcribe(audio, vad_filter=True, beam_size=1, word_timestamps=True)

result = []
for seg in segments:
    words = [
        {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()}
        for w in (seg.words or [])
        if w.word.strip()
    ]
    result.append({
        "start": round(seg.start, 2),
        "end": round(seg.end, 2),
        "text": seg.text.strip(),
        "words": words,
    })
    if info.duration:
        print(f"PROGRESS {seg.end / info.duration:.3f}", flush=True)

with open(out_path, "w", encoding="utf-8") as f:
    json.dump({"language": info.language, "segments": result}, f, ensure_ascii=False)
