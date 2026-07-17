from __future__ import annotations

import os
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPT = ROOT / "docs" / "assets" / "evidrift-demo-transcript.txt"
OUTPUT = ROOT / "docs" / "assets" / "evidrift-demo.gif"
WIDTH, HEIGHT = 1200, 675

BG = "#070b10"
PANEL = "#0d131b"
LINE = "#263241"
INK = "#f5f7fa"
MUTED = "#8ea0b5"
GREEN = "#55d187"
RED = "#ff5d68"
AMBER = "#ffbd4a"
CYAN = "#5cc8ff"
PURPLE = "#c792ea"


def font_candidates(*names: str) -> list[Path]:
    candidates: list[Path] = []
    windir = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    for name in names:
        candidates.append(windir / name)
    candidates.extend(
        [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"),
        ]
    )
    return candidates


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = ("consolab.ttf", "CascadiaMono-Bold.ttf") if bold else ("consola.ttf", "CascadiaMono.ttf")
    for candidate in font_candidates(*names):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


F12 = load_font(18)
F14 = load_font(21)
F16 = load_font(25)
F18 = load_font(30)
F24 = load_font(40, bold=True)
F32 = load_font(56, bold=True)
F42 = load_font(72, bold=True)


def required(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.MULTILINE)
    if match is None:
        raise RuntimeError(f"Captured demo output is missing: {pattern}")
    return match.group(1)


transcript = TRANSCRIPT.read_text(encoding="utf-8")
receipt = required(r"RECORDED (sha256:[a-f0-9]{64})", transcript)
expected = required(r"Expected signature: (.+)", transcript)
current_values = re.findall(r"Current signature: (.+)", transcript)
if len(current_values) < 2:
    raise RuntimeError("Captured demo output must contain baseline and drifted signatures.")
baseline_current, drifted_current = current_values[0], current_values[-1]
affected = required(r"Affected code location: (.+)", transcript)
claim = required(r"Claim: (.+)", transcript)


def base_frame(step: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, WIDTH - 24, HEIGHT - 24), radius=24, fill=PANEL, outline=LINE, width=2)
    draw.ellipse((50, 50, 66, 66), fill=RED)
    draw.ellipse((76, 50, 92, 66), fill=AMBER)
    draw.ellipse((102, 50, 118, 66), fill=GREEN)
    draw.text((146, 47), "EVIDRIFT", font=F14, fill=INK)
    draw.text((WIDTH - 390, 49), "REAL CLI OUTPUT / LOCAL-FIRST", font=F12, fill=MUTED)
    draw.line((24, 90, WIDTH - 24, 90), fill=LINE, width=2)
    draw.text((54, HEIGHT - 62), step, font=F12, fill=MUTED)
    return image, draw


def command_frame() -> Image.Image:
    image, draw = base_frame("01 / RUN IT")
    draw.text((64, 135), "ONE COMMAND. ZERO SETUP.", font=F24, fill=CYAN)
    draw.text((64, 225), "$", font=F18, fill=GREEN)
    draw.text((104, 225), "npx --yes evidrift@latest demo", font=F18, fill=INK)
    draw.rounded_rectangle((64, 315, WIDTH - 64, 420), radius=14, outline=LINE, width=2)
    draw.text((92, 347), "No account  ·  No API key  ·  No cloud  ·  No LLM judge", font=F16, fill=MUTED)
    draw.text((64, 485), "The fixture, Receipt, PASS, and drift are created locally.", font=F14, fill=INK)
    return image


def pass_frame() -> Image.Image:
    image, draw = base_frame("02 / BASELINE")
    draw.ellipse((68, 132, 120, 184), outline=GREEN, width=5)
    draw.line((80, 158, 93, 171, 111, 145), fill=GREEN, width=6, joint="curve")
    draw.text((145, 120), "PASS", font=F42, fill=GREEN)
    draw.text((64, 215), receipt[:24] + "…", font=F14, fill=MUTED)
    draw.text((64, 292), "Expected", font=F14, fill=PURPLE)
    draw.text((230, 292), expected, font=F14, fill=INK)
    draw.text((64, 346), "Current", font=F14, fill=GREEN)
    draw.text((230, 346), baseline_current, font=F14, fill=INK)
    draw.rounded_rectangle((64, 430, 520, 500), radius=12, fill="#10251b", outline="#265d42")
    draw.text((92, 448), "1 pass   0 warnings   0 failures", font=F14, fill=GREEN)
    draw.text((64, 540), "The recorded TypeScript contract still matches.", font=F14, fill=INK)
    return image


def drift_frame() -> Image.Image:
    image, draw = base_frame("03 / DEPENDENCY CHANGES")
    draw.text((64, 128), "THE API DRIFTS.", font=F32, fill=AMBER)
    draw.text((64, 235), "options?: ParseOptions", font=F24, fill=PURPLE)
    draw.text((540, 235), "→", font=F32, fill=MUTED)
    draw.text((650, 235), "options: ParseOptions", font=F24, fill=AMBER)
    draw.line((64, 325, WIDTH - 64, 325), fill=LINE, width=2)
    draw.text((64, 378), "Your code did not change. The assumption underneath it did.", font=F18, fill=INK)
    draw.text((64, 460), "Evidrift reloads the declaration and recomputes the contract.", font=F14, fill=MUTED)
    return image


def fail_frame() -> Image.Image:
    image, draw = base_frame("04 / CAUGHT BEFORE MERGE")
    draw.ellipse((68, 126, 120, 178), outline=RED, width=5)
    draw.line((82, 140, 106, 164), fill=RED, width=6)
    draw.line((106, 140, 82, 164), fill=RED, width=6)
    draw.text((145, 118), "CONTRACT DRIFT", font=F32, fill=RED)
    draw.text((64, 205), "FAIL contract_mismatch", font=F18, fill=RED)
    draw.text((64, 264), "Expected", font=F14, fill=PURPLE)
    draw.text((230, 264), expected, font=F14, fill=INK)
    draw.text((64, 318), "Current", font=F14, fill=AMBER)
    draw.text((230, 318), drifted_current, font=F14, fill=INK)
    draw.text((64, 390), "Affected", font=F14, fill=CYAN)
    draw.text((230, 390), affected, font=F14, fill=INK)
    draw.text((64, 452), "Claim", font=F14, fill=MUTED)
    draw.text((230, 452), claim, font=F12, fill=INK)
    draw.rounded_rectangle((64, 515, WIDTH - 64, 580), radius=12, fill="#2a1116", outline="#6b2932")
    draw.text((88, 531), "Review the dependency change, then intentionally record new evidence.", font=F14, fill=RED)
    return image


def final_frame() -> Image.Image:
    image, draw = base_frame("05 / TRY IT")
    draw.text((64, 130), "CODE COMPILES.", font=F32, fill=INK)
    draw.text((64, 205), "APIs DRIFT.", font=F42, fill=RED)
    draw.text((64, 325), "Catch the stale assumption before merge.", font=F18, fill=INK)
    draw.rounded_rectangle((64, 410, WIDTH - 64, 500), radius=14, fill="#10251b", outline=GREEN, width=2)
    draw.text((96, 435), "$ npx --yes evidrift@latest demo", font=F18, fill=GREEN)
    draw.text((64, 545), "github.com/bm1016bm-svg/evidrift", font=F14, fill=MUTED)
    return image


frames = [command_frame(), pass_frame(), drift_frame(), fail_frame(), final_frame()]
palette_frames = [frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=128) for frame in frames]
palette_frames[0].save(
    OUTPUT,
    save_all=True,
    append_images=palette_frames[1:],
    duration=[1500, 1900, 2100, 2800, 2100],
    loop=0,
    optimize=True,
    disposal=2,
)
print(f"Rendered {OUTPUT.relative_to(ROOT)} from {TRANSCRIPT.relative_to(ROOT)}")
