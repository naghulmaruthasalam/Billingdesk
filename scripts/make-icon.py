#!/usr/bin/env python3
"""Regenerates resources/icon.png (512x512) - a green rounded square with an ivory 'SK' monogram. Needs Pillow."""
from PIL import Image, ImageDraw, ImageFont
import sys, os

SIZE = 512
GREEN, IVORY, GOLD = (21, 93, 67), (245, 241, 229), (184, 145, 58)
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((16, 16, SIZE - 16, SIZE - 16), radius=96, fill=GREEN)
d.rounded_rectangle((44, 44, SIZE - 44, SIZE - 44), radius=72, outline=GOLD, width=6)
font_path = next((p for p in ["/usr/share/fonts/opentype/inter/Inter-Bold.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"] if os.path.exists(p)), None)
font = ImageFont.truetype(font_path, 230) if font_path else ImageFont.load_default()
w = d.textlength("SK", font=font)
d.text(((SIZE - w) / 2, 118), "SK", font=font, fill=IVORY)
d.rectangle((150, 372, SIZE - 150, 380), fill=GOLD)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "resources", "icon.png")
img.save(out)
print("wrote", os.path.abspath(out))
