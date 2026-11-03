from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)
SIZE = 1024

image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.rounded_rectangle((105, 105, 919, 919), radius=205, fill=(165, 255, 55, 115))
image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(62)))

tile = Image.new("RGBA", image.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(tile)
draw.rounded_rectangle((112, 112, 912, 912), radius=196, fill=(9, 14, 19, 255), outline=(186, 255, 74, 205), width=11)
draw.rounded_rectangle((137, 137, 887, 887), radius=174, outline=(186, 255, 74, 38), width=5)

for offset in range(230, 850, 104):
    draw.line((170, offset, 855, offset), fill=(255, 255, 255, 10), width=2)
    draw.line((offset, 170, offset, 855), fill=(255, 255, 255, 10), width=2)

image.alpha_composite(tile)

mark_shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
shadow = ImageDraw.Draw(mark_shadow)
shadow.line([(315, 338), (712, 338), (315, 686), (712, 686)], fill=(96, 140, 30, 155), width=104, joint="curve")
image.alpha_composite(mark_shadow.filter(ImageFilter.GaussianBlur(20)))

mark = Image.new("RGBA", image.size, (0, 0, 0, 0))
mark_draw = ImageDraw.Draw(mark)
mark_draw.line([(315, 325), (712, 325), (315, 673), (712, 673)], fill=(186, 255, 74, 255), width=92, joint="curve")
mark_draw.rectangle((790, 196, 830, 236), fill=(112, 230, 189, 255))
image.alpha_composite(mark)

image.save(BUILD / "icon.png", optimize=True)
image.save(BUILD / "icon.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("Generated Zenith Control Panel icons")
