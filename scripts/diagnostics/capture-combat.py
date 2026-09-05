"""Capture the real renderer through Orca after opening combat-effects.html.

python3 scripts/diagnostics/capture-combat.py broadside 0.05 output.png
python3 scripts/diagnostics/capture-combat.py video output.webm
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import struct
import sys

cli = os.environ.get('ORCA_CLI_COMMAND') or ('orca-dev' if os.environ.get('ORCA_DEV_REPO_ROOT') else 'orca')


def webm_from_ivf(data):
    """Remux VP9 packets into a finite-duration WebM, without re-encoding pixels."""
    def integer(value):
        return value.to_bytes(max(1, (value.bit_length() + 7) // 8), 'big')

    def element(tag, value):
        payload = integer(value) if isinstance(value, int) else value
        length = len(payload)
        size = next(n for n in range(1, 9) if length < (1 << (7 * n)) - 1)
        return integer(tag) + ((1 << (7 * size)) | length).to_bytes(size, 'big') + payload

    width, height, rate, scale, count = struct.unpack_from('<HHIII', data, 12)
    if data[8:12] != b'VP90':
        raise ValueError('Expected VP9 capture')
    packets = []
    offset = 32
    for _ in range(count):
        length, timestamp = struct.unpack_from('<IQ', data, offset)
        offset += 12
        milliseconds = round(timestamp * scale / rate * 1000)
        packets.append((milliseconds, data[offset:offset + length]))
        offset += length
    if offset != len(data) or not packets:
        raise ValueError('Incomplete capture')
    duration = packets[-1][0] + (packets[-1][0] - packets[-2][0] if count > 1 else 33)
    header = element(0x1A45DFA3, b''.join([
        element(0x4286, 1), element(0x42F7, 1), element(0x42F2, 4), element(0x42F3, 8),
        element(0x4282, b'webm'), element(0x4287, 4), element(0x4285, 2)]))
    info = element(0x1549A966, element(0x2AD7B1, 1000000) + element(0x4489, struct.pack('>d', duration))
        + element(0x4D80, b'Sea trials capture') + element(0x5741, b'Sea trials capture'))
    video = element(0xE0, element(0xB0, width) + element(0xBA, height))
    tracks = element(0x1654AE6B, element(0xAE, element(0xD7, 1) + element(0x73C5, 1)
        + element(0x83, 1) + element(0x86, b'V_VP9') + video))
    clusters = []
    for index, (milliseconds, packet) in enumerate(packets):
        # One timestamped cluster per packet keeps seeking independent of signed
        # block-time limits. VP9 keyframe flag is read from its uncompressed header.
        keyframe = (packet[0] & 4) == 0
        block = b'\x81\x00\x00' + (b'\x80' if keyframe else b'\x00') + packet
        clusters.append(element(0x1F43B675, element(0xE7, milliseconds) + element(0xA3, block)))
    return header + element(0x18538067, info + tracks + b''.join(clusters))


def evaluate(expression):
    page = os.environ.get('NAVAL_REVIEW_PAGE')
    target = ['--page', page] if page else []
    response = subprocess.run([cli, 'eval', *target, '--expression', expression, '--json'], check=True, capture_output=True, text=True)
    envelope = json.loads(response.stdout)
    if not envelope.get('ok'):
        raise RuntimeError(envelope)
    result = envelope['result']['result']
    try:
        return json.loads(result)
    except (TypeError, json.JSONDecodeError):
        return result


if sys.argv[1] == 'video':
    output = Path(sys.argv[2])
    data = evaluate('window.reviewVideo')
    diagnostics = evaluate('window.reviewRecordingResult')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.with_suffix('.capture.json').write_text(json.dumps(diagnostics, indent=2) + '\n')
else:
    scene, at, destination = sys.argv[1:4]
    output = Path(destination)
    diagnostics = evaluate(f'window.review.still({json.dumps(scene)}, {float(at)})')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.with_suffix('.json').write_text(json.dumps(diagnostics, indent=2) + '\n')
    data = evaluate('window.review.capture()')
if not isinstance(data, str) or not data.startswith('data:'):
    raise RuntimeError('Capture is not ready')
output.parent.mkdir(parents=True, exist_ok=True)
pixels = base64.b64decode(data.split(',', 1)[1])
output.write_bytes(webm_from_ivf(pixels) if pixels.startswith(b'DKIF') else pixels)
print(f'{output}: {output.stat().st_size} bytes')
