import os
from dotenv import load_dotenv
from openai import OpenAI

# Load env
load_dotenv()

api_key = os.getenv("OPENAI_API_KEY")

print("KEY LOADED:", bool(api_key))
print("KEY PREFIX:", api_key[:10] if api_key else None)

# Create client
client = OpenAI(api_key=api_key)

# ---- Test 1: text-only (Responses API) ----
print("\nRunning text-only test...")

resp = client.responses.create(
    model="gpt-4o-mini",
    input="Explain the bias–variance tradeoff in one short paragraph."
)

print("TEXT RESPONSE:")
print(resp.output_text)

# ---- Test 2: vision test (Responses API) ----
print("\nRunning vision test...")

resp = client.responses.create(
    model="gpt-4o-mini",
    input=[
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "What is shown in this image?"},
                {
                    "type": "input_image",
                    "image_url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/640px-PNG_transparency_demonstration_1.png"
                }
            ]
        }
    ]
)

print("VISION RESPONSE:")
print(resp.output_text)
