"""
Fish Aquarium: Python back-end.

What this server does:
  1. Serves the web page (index.html) at http://localhost:8000
  2. Receives a photo of a fish drawing from the browser (POST /api/make-fish)
  3. Turns the photo into a fish PNG with a TRANSPARENT background
       - REAL mode: asks OpenAI's image model to do it
       - MOCK mode: no key needed, a simple "make the white paper transparent" trick
  4. Sends the PNG back to the browser

Why do we need a back-end at all?  Your OpenAI API key is a secret. If it were in
the browser's JavaScript, anyone could open "View Source" and steal it.
So the browser talks to THIS server, and only this server knows the key.
"""

import base64
import io
import os
import time

from dotenv import load_dotenv          # reads the .env file (where your secret key lives)
from flask import Flask, jsonify, request, send_from_directory
from PIL import Image, ImageDraw, ImageFilter

# ---------------------------------------------------------------------------
# SETTINGS: change these to experiment
# ---------------------------------------------------------------------------
IMAGE_MODEL = "gpt-image-2.5-sunburst"   # OpenAI image model. Students can change this.
IMAGE_QUALITY = "medium"                 # "low" is cheaper/faster, "high" is nicer
IMAGE_SIZE = "1024x1024"                 # size of the picture OpenAI sends back

# The instruction we give the AI. Try rewording it! (e.g. "keep the pencil texture")
PROMPT = (
    "This is a photo of a fish drawing on paper. Cut out ONLY the fish, exactly as drawn "
    "(keep its shape, colors and details), and remove the paper, table, shadows and "
    "anything else. The result must have a fully transparent background."
)

# Mock-mode cutout: how different from the corner color a pixel can be and still
# count as "background". Raise it if paper shadows are left behind.
MOCK_TOLERANCE = 60

PORT = 8000   # the page is at http://localhost:8000
# ---------------------------------------------------------------------------

load_dotenv()  # loads OPENAI_API_KEY from the .env file, if there is one
API_KEY = os.getenv("OPENAI_API_KEY", "")
# Use mock mode if the student asked for it, OR if there is no real key yet.
MOCK_MODE = os.getenv("MOCK_MODE", "").lower() in ("1", "true", "yes") or API_KEY in (
    "",
    "your-key-here",
)

app = Flask(__name__)


# ---------------------------------------------------------------------------
# Console messages: print what the back-end is doing, with the time of day.
# (Never log the API key. Add more log("...") lines anywhere you are curious.)
# ---------------------------------------------------------------------------
def log(message):
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


# ---------------------------------------------------------------------------
# Image helpers (these use the Pillow library, imported as PIL)
# ---------------------------------------------------------------------------
def has_transparency(img):
    """True if at least some pixels of the image are see-through."""
    alpha = img.convert("RGBA").getchannel("A")   # "alpha" = the see-through channel
    return alpha.getextrema()[0] < 255            # smallest alpha value < 255


def remove_background(img):
    """
    Simple cutout WITHOUT AI: flood-fill the background from each corner, like the
    paint-bucket tool, but painting with "transparent". Works best on a drawing
    on plain white paper.
    """
    img = img.convert("RGBA")
    w, h = img.size
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(img, corner, (255, 255, 255, 0), thresh=MOCK_TOLERANCE)
    return img


def crop_to_fish(img):
    """Trim the empty transparent border so the fish image is only as big as the fish."""
    alpha = img.getchannel("A")
    # A median filter wipes out tiny stray specks, so they don't stretch the crop box.
    # (We only use it to find the box; the fish itself is not changed.)
    box = alpha.filter(ImageFilter.MedianFilter(5)).getbbox()   # box around non-transparent pixels
    return img.crop(box) if box else img


def to_png_data_url(img):
    """Turn a Pillow image into text the browser can use as <img src="...">."""
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


# ---------------------------------------------------------------------------
# The OpenAI call
# ---------------------------------------------------------------------------
def make_fish_with_openai(photo_bytes):
    """Send the photo to OpenAI and return the result as a Pillow image."""
    from openai import OpenAI              # imported here so mock mode works without a key

    client = OpenAI(api_key=API_KEY)       # (it would also find OPENAI_API_KEY by itself)

    # The "files" for the API are (filename, bytes, mime-type) tuples.
    photo_file = ("fish.jpg", photo_bytes, "image/jpeg")

    log(f"Sending photo to OpenAI (model={IMAGE_MODEL}, quality={IMAGE_QUALITY}, size={IMAGE_SIZE})")
    log("Waiting for OpenAI to answer... (this is the slow part, often 10-60 seconds)")
    started = time.perf_counter()
    result = client.images.edit(
        model=IMAGE_MODEL,
        image=photo_file,
        prompt=PROMPT,
        background="transparent",   # ask for see-through pixels...
        output_format="png",        # ...which needs PNG (JPEG can't be transparent)
        quality=IMAGE_QUALITY,
        size=IMAGE_SIZE,
    )

    # OpenAI sends the picture back as base64 text. Decode it into real image bytes.
    png_bytes = base64.b64decode(result.data[0].b64_json)
    log(f"OpenAI answered in {time.perf_counter() - started:.1f}s ({len(png_bytes) // 1024} KB image)")
    return Image.open(io.BytesIO(png_bytes))


# ---------------------------------------------------------------------------
# Web routes
# ---------------------------------------------------------------------------
@app.get("/")
def home():
    """Serve the web page."""
    return send_from_directory(app.root_path, "index.html")


@app.get("/api/status")
def status():
    """Lets the page show whether we are in mock mode."""
    return jsonify(mock=MOCK_MODE, model=None if MOCK_MODE else IMAGE_MODEL)


@app.post("/api/make-fish")
def make_fish():
    """
    The browser sends:  {"image": "data:image/jpeg;base64,...."}   (the captured photo)
    We send back:       {"image": "data:image/png;base64,...."}    (fish, transparent background)
    """
    request_started = time.perf_counter()
    data = request.get_json(silent=True) or {}
    photo_url = data.get("image", "")
    if "," not in photo_url:
        log("Request had no image, replying with an error")
        return jsonify(error="No image received."), 400

    # A "data URL" looks like  data:image/jpeg;base64,AAAA...  . Keep the part after the comma.
    photo_bytes = base64.b64decode(photo_url.split(",", 1)[1])
    log(f"Received photo from the browser ({len(photo_bytes) // 1024} KB)")

    try:
        if MOCK_MODE:
            log("MOCK mode: removing the white background locally (no OpenAI call)")
            fish = remove_background(Image.open(io.BytesIO(photo_bytes)))
        else:
            fish = make_fish_with_openai(photo_bytes)
            # Safety net: not every model honors "transparent". If the AI gave us
            # an opaque picture, fall back to the simple cutout above.
            if has_transparency(fish):
                log("Result has a transparent background, using it as is")
            else:
                log("Result has NO transparency, using the simple cutout instead")
                fish = remove_background(fish)
    except Exception as err:  # keep it simple: report any problem to the page
        log(f"ERROR ({type(err).__name__}): {err}")
        return jsonify(error=f"Could not make the fish: {err}"), 500

    fish = crop_to_fish(fish)
    reply = to_png_data_url(fish)
    log(f"Cropped fish to {fish.width}x{fish.height}px, sending it back to the browser "
        f"(total {time.perf_counter() - request_started:.1f}s)")
    return jsonify(image=reply)


if __name__ == "__main__":
    print("MOCK mode (no OpenAI)" if MOCK_MODE else f"REAL mode, model: {IMAGE_MODEL}")
    # Port 8000, not Flask's default 5000: macOS uses 5000 for AirPlay.
    # After editing app.py, stop the server (Ctrl+C) and run it again.
    app.run(port=PORT)
