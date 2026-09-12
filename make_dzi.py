"""Generate a Deep Zoom Image (DZI) tile pyramid from the sri yantra scan.

Run from anywhere:  python app/make_dzi.py
Reads ../sri-yantra-v4.jpg (the folder above app/), writes tiles.dzi and
tiles_files/ next to this script.
"""
import math, os, shutil
from PIL import Image

Image.MAX_IMAGE_PIXELS = None          # the scan is ~147 MP; silence the bomb warning

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "sri-yantra-v4.jpg")
OUT_DIR = HERE
NAME = "tiles"
TILE = 254
OVERLAP = 1
QUALITY = 88

os.makedirs(OUT_DIR, exist_ok=True)
img = Image.open(SRC).convert("RGB")
W, H = img.size
max_level = math.ceil(math.log2(max(W, H)))
files_dir = os.path.join(OUT_DIR, NAME + "_files")
if os.path.exists(files_dir):
    # ignore_errors: Google Drive / Explorer can hold a handle on a folder for a
    # moment; leftover empty level dirs are harmless (tiles are overwritten).
    shutil.rmtree(files_dir, ignore_errors=True)

level_img = img
lw, lh = W, H
total = 0
for level in range(max_level, -1, -1):
    ldir = os.path.join(files_dir, str(level))
    os.makedirs(ldir, exist_ok=True)
    cols = math.ceil(lw / TILE)
    rows = math.ceil(lh / TILE)
    for row in range(rows):
        for col in range(cols):
            x0 = col * TILE - (OVERLAP if col > 0 else 0)
            y0 = row * TILE - (OVERLAP if row > 0 else 0)
            x1 = min((col + 1) * TILE + OVERLAP, lw)
            y1 = min((row + 1) * TILE + OVERLAP, lh)
            level_img.crop((x0, y0, x1, y1)).save(
                os.path.join(ldir, f"{col}_{row}.jpg"), "JPEG", quality=QUALITY)
    total += cols * rows
    print(f"level {level}: {lw}x{lh}, {cols * rows} tiles", flush=True)
    if level > 0:
        lw, lh = max(1, math.ceil(lw / 2)), max(1, math.ceil(lh / 2))
        level_img = level_img.resize((lw, lh), Image.LANCZOS)

with open(os.path.join(OUT_DIR, NAME + ".dzi"), "w", encoding="utf-8") as f:
    f.write(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" '
        f'Format="jpg" Overlap="{OVERLAP}" TileSize="{TILE}">\n'
        f'  <Size Width="{W}" Height="{H}"/>\n'
        '</Image>\n'
    )
print(f"done: {total} tiles, source {W}x{H}, max level {max_level}")
