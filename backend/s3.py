# s3.py
import os
import boto3
from dotenv import load_dotenv

# Load .env variables
load_dotenv()

# Required env vars
AWS_REGION = os.getenv("AWS_REGION")
BUCKET = os.getenv("AWS_S3_BUCKET")

if not AWS_REGION:
    raise RuntimeError("AWS_REGION is not set")

if not BUCKET:
    raise RuntimeError("AWS_S3_BUCKET is not set")

# Create S3 client
# Let boto3 automatically pick up credentials from env
s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
)


def upload_pdf(file_obj, user_id: int, file_id: int) -> str:
    """
    Upload a PDF to S3 and return the object key
    """
    key = f"users/user_{user_id}/files/{file_id}.pdf"

    s3.upload_fileobj(
        Fileobj=file_obj,
        Bucket=BUCKET,
        Key=key,
        ExtraArgs={"ContentType": "application/pdf"},
    )

    return key


def generate_presigned_url(s3_key: str, expires_in: int = 3600) -> str:
    """
    Generate a temporary download URL for a PDF
    """
    return s3.generate_presigned_url(
        ClientMethod="get_object",
        Params={
            "Bucket": BUCKET,
            "Key": s3_key,
        },
        ExpiresIn=expires_in,
    )
