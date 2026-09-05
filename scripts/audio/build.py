"""Build the generated naval sound set without another paid generation.

Python standard library; decoding requires ffmpeg or macOS afconvert.
Sources/prompts are retained in assets/audio/naval. Only published clips become game assets.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'assets/audio/naval'
OUTPUT = ROOT / 'public/audio/naval'
STAGING = ROOT / '.build/audio'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stats(samples):
    return {'peakDbfs': round(20 * math.log10(max(1e-8, max(abs(n) for n in samples))), 2),
            'rmsDbfs': round(20 * math.log10(max(1e-8, math.sqrt(sum(n*n for n in samples) / len(samples)))), 2)}


def build():
    recipe = json.loads((ASSETS / 'recipe.json').read_text())
    OUTPUT.mkdir(parents=True, exist_ok=True)
    STAGING.mkdir(parents=True, exist_ok=True)
    report = []
    for clip in recipe['clips']:
        name = clip['id']
        if clip.get('publish', True) is False:
            (OUTPUT / f'{name}.wav').unlink(missing_ok=True)
            continue
        sources = list((ASSETS / 'originals' / name).glob('*.mp3'))
        if len(sources) != 1:
            raise RuntimeError(f'{name}: expected one selected original MP3, found {len(sources)}')
        source, decoded = sources[0], STAGING / f'{name}.wav'
        if shutil.which('ffmpeg'):
            command = ['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-ar', '44100', '-c:a', 'pcm_s16le', str(decoded)]
        elif shutil.which('afconvert'):
            command = ['afconvert', '-f', 'WAVE', '-d', 'LEI16', str(source), str(decoded)]
        else:
            raise RuntimeError('Install ffmpeg to decode originals (macOS afconvert is also supported).')
        subprocess.run(command, check=True)
        with wave.open(str(decoded)) as audio:
            rate, channels = audio.getframerate(), audio.getnchannels()
            pcm = array.array('h', audio.readframes(audio.getnframes()))
        if sys.byteorder != 'little':
            pcm.byteswap()
        samples = [n / 32768 for n in pcm]
        original_stats = stats(samples)
        if not clip['loop']:
            # Positional effects are mono; environmental beds retain their stereo image.
            samples = [sum(samples[i:i+channels]) / channels for i in range(0, len(samples), channels)]
            channels = 1
            # Remove silent pre-roll, retaining 3 ms of attack room.
            threshold = max(abs(n) for n in samples) * .015
            onset = next((i for i, n in enumerate(samples) if abs(n) > threshold), 0)
            samples = samples[max(0, onset - round(rate * .003)):]
            for i in range(min(round(rate * .002), len(samples))):
                samples[i] *= i / (rate * .002)
            for i in range(min(round(rate * .03), len(samples))):
                samples[-1-i] *= i / (rate * .03)
        else:
            # Circular equal-power overlap; the last sample flows into the first.
            overlap = round(rate * .1) * channels
            seam = []
            for i in range(overlap):
                fraction = (i // channels) / (overlap // channels - 1)
                seam.append(samples[-overlap+i] * math.cos(fraction * math.pi / 2) + samples[i] * math.sin(fraction * math.pi / 2))
            samples = samples[overlap:-overlap] + seam
        rms = math.sqrt(sum(n*n for n in samples) / len(samples))
        target = -22 if clip['loop'] else -20
        gain = min(10 ** (target / 20) / max(rms, 1e-8), 10 ** (-3 / 20) / max(max(abs(n) for n in samples), 1e-8))
        samples = [n * gain for n in samples]
        output = OUTPUT / f'{name}.wav'
        encoded = array.array('h', [round(n * 32767) for n in samples])
        if sys.byteorder != 'little':
            encoded.byteswap()
        with wave.open(str(output), 'wb') as audio:
            audio.setnchannels(channels); audio.setsampwidth(2); audio.setframerate(rate); audio.writeframes(encoded.tobytes())
        report.append({'id': name, 'source': str(source.relative_to(ROOT)), 'sourceSha256': digest(source),
                       'runtime': str(output.relative_to(ROOT)), 'runtimeSha256': digest(output), 'bytes': output.stat().st_size,
                       'durationSeconds': round(len(samples) / channels / rate, 4), 'channels': channels, 'sampleRate': rate,
                       'loop': clip['loop'], 'original': original_stats, 'processed': stats(samples)})
        print(f'{name}: {report[-1]["durationSeconds"]} s, {report[-1]["processed"]}')
    manifest = {'version': 1, 'provider': 'ElevenLabs', 'recipeSha256': digest(ASSETS / 'recipe.json'),
                'buildRecipeSha256': digest(Path(__file__)), 'clips': report}
    (ASSETS / 'build.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    build()
