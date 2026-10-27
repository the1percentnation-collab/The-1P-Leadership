#!/usr/bin/env python3
"""Transcribe a few seconds after each pause in an audiobook.

Used by publish-audiobook.js to hear where each chapter starts: the narrator
says "Chapter Seven" right after the pause that opens chapter seven, and a
section heading inside a chapter sounds different.

  python3 transcribe-snippets.py AUDIO.mp3 STARTS.json OUT.json [--model base.en] [--seconds 6]

STARTS.json is a list of start times in seconds. OUT.json gets a list of the
same length, each the transcript of [start, start + seconds). The audio is
decoded once by ffmpeg to 16 kHz mono; the model is faster-whisper on CPU.
"""
import json
import subprocess
import sys
import time

import numpy as np
from faster_whisper import WhisperModel

RATE = 16000


def arg(name, default):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def decode(path):
    raw = subprocess.run(
        ['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', str(RATE), '-'],
        check=True, stdout=subprocess.PIPE).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def main():
    audio_path, starts_path, out_path = sys.argv[1:4]
    model_name = arg('--model', 'base.en')
    seconds = float(arg('--seconds', '6'))
    starts = json.load(open(starts_path))
    t0 = time.time()
    audio = decode(audio_path)
    model = WhisperModel(model_name, device='cpu', compute_type='int8')
    out = []
    for s in starts:
        a = max(0, int(float(s) * RATE))
        clip = audio[a:a + int(seconds * RATE)]
        if len(clip) < RATE // 2:
            out.append('')
            continue
        segments, _ = model.transcribe(clip, language='en', beam_size=1, vad_filter=False,
                                       condition_on_previous_text=False, without_timestamps=True)
        out.append(' '.join(seg.text.strip() for seg in segments).strip())
    json.dump(out, open(out_path, 'w'))
    print(f'Transcribed {len(starts)} openings with {model_name} in {time.time() - t0:.0f}s', file=sys.stderr)


if __name__ == '__main__':
    main()
