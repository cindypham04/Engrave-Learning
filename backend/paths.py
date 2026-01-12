import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
REGION_DIR = os.path.join(UPLOAD_DIR, "regions")

os.makedirs(REGION_DIR, exist_ok=True)
