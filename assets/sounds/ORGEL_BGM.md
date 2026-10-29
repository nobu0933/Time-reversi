# Original music-box BGM

Two original instrumental arrangements, using synthesized music-box tines and soft plucked-string accompaniment. The approximately 63 BPM tempo of `monochrome_orgel_075x.mp3` was used as a tempo reference; its audio and melody are not sampled.

| File stem | Title | Tempo | Meter | Key | Approximate base length |
| --- | --- | --- | --- | --- | --- |
| `komorebi_orgel` | 木漏れ日の小径 | 63 BPM | 4/4 | D major | 2:34 |
| `tsukikage_orgel` | 月影のゆりかご | 62 BPM | 3/4 | F major | 2:34 |

For each stem, six MP3 files are provided:

- `.mp3`: original speed
- `_150x.mp3`: 1.5× speed, pitch preserved
- `_200x.mp3`: 2× speed, pitch preserved
- `_reverse.mp3`: original speed, reversed
- `_150x_reverse.mp3`: 1.5× speed, reversed
- `_200x_reverse.mp3`: 2× speed, reversed

Speed changes use Rubber Band on the lossless master before MP3 encoding. Faster versions are correspondingly shorter. All versions fade out, with near-silent padding trimmed. Reversed tracks have an additional terminal fade, so their ending is not an unmodified sample-for-sample reversal.

The render uses continuous overlapping note tails, smooth note envelopes and diffuse room reflections to avoid joins and abrupt sample boundaries. Upper frequencies are gently reduced above roughly 3 kHz before the speed and reverse variants are made. `orgel_bgm_manifest.json` records decoded duration, peak level, clipping count, trailing silence and maximum adjacent-sample difference. These are automated checks, not a substitute for listening.

Generation source: `scripts/create_orgel_bgm.py` (NumPy, SciPy, FFmpeg with Rubber Band). Existing `monochrome_orgel.mp3` and `monochrome_orgel_075x.mp3` remain unchanged. The game uses the original, 1.5× reverse, 1.5× forward, 2× reverse and 2× forward versions in that order as time reversals occur.
