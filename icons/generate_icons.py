"""Генерує іконки для PWA-манiфесту Deutsch Trainer.
Запуск: python3 generate_icons.py (з директорії icons/)
"""
from PIL import Image, ImageDraw, ImageFont
import os

BG = (47, 111, 79)       # --accent з style.css
FG = (255, 255, 255)


def find_font(size):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSDisplay.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_icon(size, safe_ratio, out_path):
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)
    text = "De"
    font_size = int(size * safe_ratio * 0.55)
    font = find_font(font_size)
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1]
    draw.text((x, y), text, fill=FG, font=font)
    img.save(out_path, "PNG")
    print("wrote", out_path)


# Звичайні іконки — контент може займати майже весь квадрат
draw_icon(192, 0.9, "icon-192.png")
draw_icon(512, 0.9, "icon-512.png")

# Maskable — ОС може обрізати до кола/сквіркла, тому контент лишаємо
# у безпечній зоні ~80% від центру (safe_ratio менший)
draw_icon(192, 0.6, "icon-maskable-192.png")
draw_icon(512, 0.6, "icon-maskable-512.png")

# apple-touch-icon (iOS не використовує maskable-логіку, окремий файл 180x180)
draw_icon(180, 0.9, "apple-touch-icon.png")
