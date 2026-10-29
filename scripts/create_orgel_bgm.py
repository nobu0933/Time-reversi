"""Render two original music-box arrangements and pitch-preserving variants.

Requires numpy, scipy and an FFmpeg build with Rubber Band.
Lossless intermediates live in a temporary directory, never in game assets.
"""
from pathlib import Path
import json
import subprocess
import tempfile
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'sounds'
FFMPEG = next((Path.home() / 'AppData/Local/Temp/time-reversi-audio-tools/imageio_ffmpeg/binaries').glob('ffmpeg*.exe'))
SCALE = [0, 2, 4, 5, 7, 9, 11]


def degree(root, n):
    octave, index = divmod(n, 7)
    return root + 12 * octave + SCALE[index]


def voice(midi, kind):
    freq = 440 * 2 ** ((midi - 69) / 12)
    length = 5.5 if kind == 'box' else 3.8
    t = np.arange(int(SR * length), dtype=np.float64) / SR
    y = np.zeros_like(t)
    if kind == 'box':
        modes = [(1, 1, 1.45), (2, .12, .8), (2.756, .16, .48), (4.02, .035, .3), (5.404, .035, .21)]
    else:
        modes = [(k, .7 / k ** 1.65, 1.2 / k ** .35) for k in range(1, 9)]
    for ratio, amp, decay in modes:
        if freq * ratio < SR * .45:
            y += amp * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-t / decay)
    # Smooth both endpoints; overlapping tails are mixed into one continuous master.
    y *= (1 - np.exp(-t / (.006 if kind == 'box' else .012))) ** 2
    release = int(.12 * SR)
    y[-release:] *= np.linspace(1, 0, release) ** 2
    return y.astype(np.float32)


def compose(name, root, bpm, beats, bars, chords, theme, bridge, seed):
    rng = np.random.default_rng(seed)
    beat = 60 / bpm
    seconds = bars * beats * beat + 4
    mix = np.zeros((int(seconds * SR), 2), np.float32)
    cache = {}

    def note(position, midi, gain, kind='box', pan=0):
        key = (midi, kind)
        if key not in cache:
            cache[key] = voice(*key)
        start = max(0, int((position * beat + .035 + rng.uniform(-.007, .007)) * SR))
        n = min(len(cache[key]), len(mix) - start)
        if n <= 0:
            return
        volume = gain * rng.uniform(.93, 1.07)
        stereo = np.array([np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)])
        mix[start:start+n] += cache[key][:n, None] * (volume * stereo)

    for bar in range(bars):
        # Intro and coda frame a theme, variation, contrasting middle and reprise.
        intro = bar < 4
        outro = bar >= bars - 4
        section_bar = bar - 4
        middle = bars // 2 - 2 <= bar < bars // 2 + 6
        chord_index = section_bar % len(chords)
        if intro:
            chord_index = bar % len(chords)
        chord_degrees = chords[chord_index]
        if outro:
            chord_degrees = ([3, 5, 7], [4, 6, 8], [0, 2, 4], [0, 2, 4])[bar - (bars - 4)]
        start = bar * beats
        chord = [degree(root - 24, x) for x in chord_degrees]
        note(start, chord[0] - 12, .105, 'guitar', -.12)
        # Gently picked acoustic accompaniment, with no percussion.
        for step in range(beats * 2):
            if outro and bar == bars - 1 and step > 2:
                break
            pitch = chord[[0, 1, 2, 1, 2, 1, 0, 2][step]]
            note(start + step * .5, pitch, .065, 'guitar', -.35)
        if intro:
            for j in range(2):
                note(start + j * (beats / 2), chord[j] + 12, .075, pan=.3)
            continue
        if outro:
            ending = [[3, 2], [1, -1], [0, 2], [0]]
            for j, d in enumerate(ending[bar - (bars - 4)]):
                note(start + j, degree(root, d), .19, pan=.1)
            continue
        phrase = (bridge if middle else theme)[section_bar % 8]
        for offset, d in phrase:
            note(start + offset, degree(root, d), .23, pan=.12)
        # Sparse answering notes make the reprise differ from its first statement.
        if bar >= bars - 12 and bar % 2 == 0:
            note(start + beats - .5, chord[1] + 12, .07, pan=-.25)

    # A dark, diffuse room: several continuous decaying reflections, no buffer joins.
    for channel in range(2):
        ir = np.zeros(int(SR * 1.8), np.float32)
        for delay, level in [(0.047, .16), (.083, .12), (.139, .09), (.211, .06), (.317, .04)]:
            ir[int(SR * (delay + channel * .009))] = level
        noise = rng.normal(0, 1, len(ir)).astype(np.float32)
        noise = signal.sosfilt(signal.butter(1, 3500, fs=SR, output='sos'), noise)
        t = np.arange(len(ir)) / SR
        ir += (noise * .0025 * np.exp(-t / .42) * (1 - np.exp(-t / .04))).astype(np.float32)
        mix[:, channel] += signal.oaconvolve(mix[:, channel], ir)[:len(mix)].astype(np.float32)
    mix = signal.sosfilt(signal.butter(2, [40, 8500], btype='bandpass', fs=SR, output='sos'), mix, axis=0).astype(np.float32)
    # Gently soften the bright upper partials while preserving the music-box body.
    low = signal.sosfiltfilt(signal.butter(2, 3000, fs=SR, output='sos'), mix, axis=0).astype(np.float32)
    mix = .8 * mix + .2 * low
    mix *= .76 / np.max(np.abs(mix))
    fade = int(6 * SR)
    mix[-fade:] *= (np.cos(np.linspace(0, np.pi/2, fade)) ** 2)[:, None]
    mix[:int(.02*SR)] *= np.linspace(0, 1, int(.02*SR))[:, None]
    print(f'Composed {name}: {len(mix)/SR:.2f}s, {bpm} BPM', flush=True)
    return mix


THEME_A = [
    [(0,2),(1,4),(2,1),(3,2)], [(0,1),(1.5,-1),(2,-2),(3,-1)],
    [(0,0),(1,2),(2,5),(3,4)], [(0,2),(2,1),(3,-1)],
    [(0,3),(1,2),(2,1),(3,0)], [(0,2),(1.5,4),(2,2),(3,1)],
    [(0,1),(1,3),(2,5),(3,3)], [(0,1),(1.5,-1),(2,-2),(2.5,-1),(3,1)],
]
BRIDGE_A = [
    [(0,5),(1.5,4),(2,2)],[(0,4),(1,2),(3,1)],[(0,5),(1,6),(2,7),(3,5)],[(0,4),(2,2)],
    [(0,3),(1.5,5),(2.5,3)],[(0,2),(1,1),(2,0)],[(0,1),(1,2),(2,3),(3,5)],[(0,4),(2,1),(3,-1)],
]
THEME_B = [
    [(0,4),(1,2),(2,1)],[(0,0),(1.5,2),(2,3)],[(0,2),(1,0),(2,-2)],[(0,1),(2,-1)],
    [(0,3),(1,5),(2,4)],[(0,2),(1.5,1),(2,0)],[(0,-1),(1,1),(2,2)],[(0,1),(1.5,-1),(2,0)],
]
BRIDGE_B = [
    [(0,5),(1,4),(2,3)],[(0,4),(2,2)],[(0,2),(1,3),(2,5)],[(0,4),(1.5,1),(2,2)],
    [(0,3),(1,2),(2,0)],[(0,2),(1,4),(2,6)],[(0,5),(1,3),(2,1)],[(0,4),(2,-1)],
]


def encode(wav, destination):
    subprocess.run([str(FFMPEG), '-v', 'error', '-nostdin', '-i', str(wav), '-c:a', 'libmp3lame', '-q:a', '1', '-y', str(destination)], check=True)


def trim_silence(audio):
    active = np.flatnonzero(np.max(np.abs(audio), axis=1) > 0.0001)
    if len(active):
        audio = audio[max(0, active[0]-int(.01*SR)):min(len(audio), active[-1]+int(.025*SR))].copy()
    # Bring the tiny trimmed boundary exactly to zero.
    ramp = min(int(.012*SR), len(audio)//2)
    audio[:ramp] *= np.linspace(0, 1, ramp)[:, None]
    audio[-ramp:] *= np.linspace(1, 0, ramp)[:, None]
    return audio


def main():
    specs = [
        ('komorebi_orgel', '木漏れ日の小径', 74, 63, 4, 40,
         [[0,2,4],[-1,1,4],[-2,0,2],[-3,-1,2],[-4,-2,0],[-3,0,2],[-3,-1,1],[-3,-1,4]], THEME_A, BRIDGE_A, 37),
        ('tsukikage_orgel', '月影のゆりかご', 77, 62, 3, 52,
         [[0,2,4],[-2,0,2],[-4,-2,0],[-3,-1,1],[-4,-2,1],[-3,0,2],[-3,-1,4],[0,2,4]], THEME_B, BRIDGE_B, 91),
    ]
    report = []
    with tempfile.TemporaryDirectory(prefix='time-reversi-orgel-', dir=ROOT) as temp:
        temp = Path(temp)
        assert temp.resolve().parent == ROOT.resolve()
        for name, title, root, bpm, beats, bars, chords, theme, bridge, seed in specs:
            master = compose(name, root, bpm, beats, bars, chords, theme, bridge, seed)
            master_path = temp / 'master.wav'
            wavfile.write(master_path, SR, master)
            for speed in [1, 1.5, 2]:
                if speed == 1:
                    version = master.copy()
                else:
                    stretched = temp / 'stretched.wav'
                    subprocess.run([str(FFMPEG), '-v', 'error', '-nostdin', '-y', '-i', str(master_path), '-af', f'rubberband=tempo={speed}:pitch=1:transients=crisp:channels=together', '-c:a', 'pcm_f32le', str(stretched)], check=True)
                    _, version = wavfile.read(stretched)
                version *= min(1, .78 / np.max(np.abs(version)))
                for reverse in [False, True]:
                    result = version[::-1].copy() if reverse else version.copy()
                    if reverse:
                        n = min(int(4*SR), len(result))
                        result[-n:] *= (np.cos(np.linspace(0,np.pi/2,n))**2)[:,None]
                    result = trim_silence(result)
                    suffix = '' if speed == 1 else ('_150x' if speed == 1.5 else '_200x')
                    filename = name + suffix + ('_reverse' if reverse else '') + '.mp3'
                    wav = temp / 'encode.wav'
                    wavfile.write(wav, SR, result)
                    encode(wav, OUT / filename)
                    decoded = subprocess.run([str(FFMPEG), '-v', 'error', '-i', str(OUT / filename), '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], check=True, capture_output=True)
                    pcm = np.frombuffer(decoded.stdout, np.float32).reshape(-1,2)
                    active = np.flatnonzero(np.max(np.abs(pcm), axis=1) > .0001)
                    row = dict(file=filename, title=title, speed=speed, reverse=reverse, bpm=bpm*speed, seconds=round(len(pcm)/SR,3), peak=round(float(np.max(np.abs(pcm))),5), clipped_samples=int(np.sum(np.abs(pcm)>=1)), tail_silence_seconds=round((len(pcm)-1-active[-1])/SR,4), maximum_sample_step=round(float(np.max(np.abs(np.diff(pcm,axis=0)))),5))
                    assert row['clipped_samples'] == 0
                    assert row['tail_silence_seconds'] < .1
                    report.append(row)
                    print(json.dumps(row,ensure_ascii=False),flush=True)
    (OUT / 'orgel_bgm_manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__ == '__main__':
    main()
