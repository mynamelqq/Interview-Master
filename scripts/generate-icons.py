from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
FONT = next((font for font in [Path("C:/Windows/Fonts/segoeuib.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")] if font.exists()), None)

for size, name in [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    image = Image.new("RGB", (size, size), "#1d6c56")
    draw = ImageDraw.Draw(image)
    inset = round(size * 0.17)
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=round(size * 0.12),
        fill="#e8f2ec",
    )
    font = ImageFont.truetype(str(FONT), round(size * 0.30)) if FONT else ImageFont.load_default(size=round(size * 0.30))
    draw.text((size / 2, size / 2 - size * 0.015), "IM", font=font, anchor="mm", fill="#1d6c56")
    image.save(ROOT / "public" / name)
