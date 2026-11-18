"""Renderiza o stinger-transition.html em quadros PNG com alpha (1920x1080, 60 fps).

Reproduz a mesma geometria, cores e curvas do CSS para gerar o vídeo usado em
OBS → Transições de cena → Stinger. Uso:

    python3 tools/render-stinger.py <pasta-de-saida> [duracao_ms]
"""
import math
import os
import sys

from PIL import Image

WIDTH, HEIGHT, FPS = 1920, 1080, 60
PINK, ORANGE, PURPLE, CYAN, INK = (255, 46, 136), (255, 138, 61), (107, 47, 214), (34, 227, 227), (11, 11, 20)

# .band{inset:-30%} → caixa do elemento antes da transformação.
BOX_LEFT, BOX_TOP = -0.3 * WIDTH, -0.3 * HEIGHT
BOX_WIDTH, BOX_HEIGHT = 1.6 * WIDTH, 1.6 * HEIGHT
ORIGIN_X, ORIGIN_Y = WIDTH / 2, HEIGHT / 2
SKEW = math.tan(math.radians(-22))
GRADIENT_SCALE = 8
LOGO_WIDTH = 560


def cubic_bezier(x1, y1, x2, y2):
    def sample(t, a, b):
        return 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3

    def solve(progress):
        low, high = 0.0, 1.0
        for _ in range(40):
            mid = (low + high) / 2
            if sample(mid, x1, x2) < progress:
                low = mid
            else:
                high = mid
        return sample((low + high) / 2, y1, y2)

    return solve


BAND_EASE = cubic_bezier(.72, 0, .28, 1)
LOGO_EASE = cubic_bezier(0, 0, .58, 1)


def keyframes(progress, frames, ease):
    """Interpola [(posição 0..1, valor)] aplicando a curva em cada segmento, como o CSS."""
    if progress <= frames[0][0]:
        return frames[0][1]
    for (start, start_value), (end, end_value) in zip(frames, frames[1:]):
        if progress <= end:
            local = ease((progress - start) / (end - start)) if end > start else 1
            if isinstance(start_value, tuple):
                return tuple(a + (b - a) * local for a, b in zip(start_value, end_value))
            return start_value + (end_value - start_value) * local
    return frames[-1][1]


def gradient_image(stops):
    """linear-gradient(110deg, ...) na caixa do elemento, renderizado em baixa resolução e ampliado."""
    width, height = int(BOX_WIDTH / GRADIENT_SCALE), int(BOX_HEIGHT / GRADIENT_SCALE)
    angle = math.radians(110)
    direction_x, direction_y = math.sin(angle), -math.cos(angle)
    length = abs(BOX_WIDTH * direction_x) + abs(BOX_HEIGHT * direction_y)
    image = Image.new('RGBA', (width, height))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            relative_x = x * GRADIENT_SCALE - BOX_WIDTH / 2
            relative_y = y * GRADIENT_SCALE - BOX_HEIGHT / 2
            position = min(1, max(0, (relative_x * direction_x + relative_y * direction_y) / length + .5))
            segment = min(len(stops) - 2, int(position * (len(stops) - 1)))
            local = position * (len(stops) - 1) - segment
            color = tuple(round(a + (b - a) * local) for a, b in zip(stops[segment], stops[segment + 1]))
            pixels[x, y] = color + (255,)
    return image.resize((int(BOX_WIDTH), int(BOX_HEIGHT)), Image.BILINEAR)


def band_layer(source, offset_percent):
    """translate3d(offset) skewX(-22deg) com origem no centro, invertido para Image.transform."""
    translate_x = offset_percent * BOX_WIDTH
    # tela (X, Y) → caixa local (u, v): u = X - tx - skew*(Y - origem_y) - left
    data = (1, -SKEW, -translate_x + SKEW * ORIGIN_Y - BOX_LEFT, 0, 1, -BOX_TOP)
    return source.transform((WIDTH, HEIGHT), Image.AFFINE, data, resample=Image.BILINEAR, fillcolor=(0, 0, 0, 0))


def main():
    output = sys.argv[1]
    duration = int(sys.argv[2]) if len(sys.argv) > 2 else 1200
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(output, exist_ok=True)

    band_duration = duration * .85
    bands = [
        (gradient_image([PINK, ORANGE]), 0),
        (gradient_image([PURPLE, PINK, CYAN]), duration * .075),
        (Image.new('RGBA', (int(BOX_WIDTH), int(BOX_HEIGHT)), INK + (255,)), duration * .15),
    ]
    cross = [(0, -1.3), (.45, 0), (.60, 0), (1, 1.3)]
    logo_source = Image.open(os.path.join(root, 'assets', 'img', 'logo-gta6.png')).convert('RGBA')
    logo_frames = [(0, (0.0, .7)), (.38, (0.0, .7)), (.46, (1.0, 1.0)), (.58, (1.0, 1.0)), (.66, (0.0, 1.15)), (1, (0.0, 1.15))]

    total_frames = round(duration / 1000 * FPS)
    for index in range(total_frames + 1):
        time = index * 1000 / FPS
        frame = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
        for source, delay in bands:
            progress = min(1, max(0, (time - delay) / band_duration))
            frame.alpha_composite(band_layer(source, keyframes(progress, cross, BAND_EASE)))

        opacity, scale = keyframes(min(1, time / duration), logo_frames, LOGO_EASE)
        if opacity > 0:
            width = round(LOGO_WIDTH * scale)
            height = round(logo_source.height * width / logo_source.width)
            logo = logo_source.resize((width, height), Image.LANCZOS)
            alpha = logo.getchannel('A').point(lambda value: round(value * opacity))
            logo.putalpha(alpha)
            frame.alpha_composite(logo, ((WIDTH - width) // 2, (HEIGHT - height) // 2))

        frame.save(os.path.join(output, f'frame_{index:03d}.png'))
    print(f'{total_frames + 1} quadros em {output}')


if __name__ == '__main__':
    main()
