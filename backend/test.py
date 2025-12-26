import requests
import base64
from openai import OpenAI

# ---------- 1. Download image safely ----------
url = "https://upload.wikimedia.org/wikipedia/commons/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg"

headers = {
    "User-Agent": "Mozilla/5.0"
}

resp = requests.get(url, headers=headers)
resp.raise_for_status()

content_type = resp.headers.get("Content-Type", "")
if not content_type.startswith("image/"):
    raise ValueError(f"Not an image. Content-Type: {content_type}")

img_bytes = resp.content

# Optional sanity check (JPEG magic bytes)
if not img_bytes.startswith(b"\xff\xd8"):
    raise ValueError("Downloaded data is not a valid JPEG image")

# ---------- 2. Encode as Base64 ----------
image_base64 = base64.b64encode(img_bytes).decode("utf-8")

# Wrap as data URL (required)
data_url = f"data:image/jpeg;base64,{image_base64}"

# ---------- 3. Send to OpenAI ----------
client = OpenAI()

response = client.responses.create(
    model="gpt-4.1-mini",
    input=[
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "What is in this image?"},
                {
                    "type": "input_image",
                    "image_url": data_url
                }
            ]
        }
    ]
)

print(response.output_text)
