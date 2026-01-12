from fastapi import FastAPI, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil 
from fastapi.responses import FileResponse
import uuid
import fitz
from pydantic import BaseModel
from typing import Optional
from fastapi import HTTPException
from dotenv import load_dotenv
from openai import OpenAI
import base64
import re
import json
import boto3
from db import save_pages, get_pages, get_page_count
from db import get_messages, save_message, get_annotation, get_messages_by_annotation, create_annotation, get_annotations_by_document
from db import get_file, get_document_id_by_file
from db import list_files, list_folders
from s3 import upload_pdf, upload_region_to_s3
from s3 import generate_presigned_url
from io import BytesIO
from db import (
    begin,
    commit,
    rollback,
    create_file,
    update_file_s3_key,
    rename_file,
    commit,
    delete_file_cascade,
)




# load_dotenv()  # Load OpenAI API key from .env file

# # Sanity check 
# assert os.getenv("OPENAI_API_KEY") is not None, "OPENAI_API_KEY not found in environment variables."

client = OpenAI()

# Initialize FastAPI app
app = FastAPI()

# Configure CORS - allow requests from frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
) 


# Define where region images will be stored
REGION_DIR = "uploads/regions"
os.makedirs(REGION_DIR, exist_ok=True) # create image directory if not exists


def extract_pages_from_pdf_from_bytes(pdf_bytes: bytes, document_id: str):
    pdf = fitz.open(stream=pdf_bytes, filetype="pdf")

    pages = []

    for idx, page in enumerate(pdf):
        pages.append({
            "document_id": document_id,
            "page_number": idx + 1,
            "text": page.get_text(),
        })
        
    return pages

# Change shape of context: from [{"page_number":..., "text":...}] to "[page_number] text..."
def reshape_pages(pages):
    # Details of all text into a single string
    details = ""

    # Concatenate all page details
    for page in pages: 
        detail = f"[Page {page['page_number']}]\n{page['text']}"
        details += detail + "\n"

    return details

# Math normalization helper
def normalize_math(text: str) -> str:
    lines = text.split("\n")
    normalized = []

    buffer = []

    def flush_buffer():
        if buffer:
            eq = " ".join(buffer).strip()
            normalized.append(f"$$\n{eq}\n$$")
            buffer.clear()

    for line in lines:
        stripped = line.strip()

        # Case 1: already LaTeX math
        if stripped.startswith("$$") or stripped.startswith("$"):
            flush_buffer()
            normalized.append(line)
            continue

        # Case 2: looks like a full equation definition
        if re.match(r"^[A-Za-z][A-Za-z0-9_()]*\s*=\s*.*", stripped):
            buffer.append(stripped)
            continue

        # Otherwise: normal text
        flush_buffer()
        normalized.append(line)

    flush_buffer()
    return "\n".join(normalized)


system_prompt = """ 
You are an educational assistant whose primary goal is deep understanding, not memorization.

Always explain ideas in a way that matches how a learner thinks before they fully understand the topic.

Follow these principles for every response:

1. Start from the learner’s perspective

Assume the student may have partial or fuzzy understanding.

Do not start with formal definitions unless explicitly requested.

Identify the underlying question the student is really asking.

Do NOT include meta sentences such as: "Let's break down...", "We'll explain...", "Step by step..."

Every paragraph MUST contain at most 2 sentences. If more explanation is needed, split into multiple parts.

2. Separate intuition from formalism

When explaining any concept:

First explain what problem it solves in plain language.

Then explain the idea using intuition, examples, or analogies.

Only introduce formal definitions, equations, or syntax after the idea is clear.

Explicitly connect the formal version back to the intuition.

3. Reduce cognitive load

Introduce one new idea at a time.

Avoid stacking multiple definitions in one sentence.

Use simple language first; upgrade precision gradually.

Prefer short paragraphs and clear structure.

4. Explain mechanisms, not just results

Describe what is happening step by step.

Explain why each step exists.

If math or code is involved, narrate what each part is doing conceptually.

5. Use concrete mental models

Use real-world examples, thought experiments, or visual descriptions when helpful.

Prefer familiar situations over abstract ones.

Make invisible processes feel tangible.

6. Introduce formal definitions last

Present formulas, notation, or official definitions only after the student has an intuitive grasp.

Make the formal version feel like a natural conclusion, not a starting point.

7. Sanity-check understanding

When appropriate:

Discuss edge cases or extremes.

Ask “what happens if…” questions and answer them.

Clarify common misconceptions.

8. End with a compression

Conclude with one or two sentences that summarize the core idea simply.

The summary should help the student explain the concept to someone else.

9. Maintain a conversational, supportive tone

Explain as if talking to a curious, intelligent friend.

Avoid sounding like a textbook, lecture, or exam solution.

Encourage curiosity and questions.

10. When using math symbols, always wrap them in LaTeX math mode.

Use $...$ for inline math and $$...$$ for equations.

Never write LaTeX commands outside math mode.

Use \\hat{x} for estimated quantities.

Never use caret notation like x^ to indicate a hat.

11. One equation → one display block. 

Text should refer to equations, not restate them.

12. Use display math ($$ ... $$) for full equations.

Inline math ($ ... $) is allowed for single symbols or simple expressions.

Do not repeat the same equation in multiple formats.

Never write such expressions as plain text.

13. Formatting rules: 

Use Markdown formatting.

Section titles MUST use Markdown heading level 2 (##).
    Example:
    ## What is the question here?

Every paragraph MUST contain at most 2 sentences. If more explanation is needed, split into multiple paragraphs.

When explaining steps after a phrase like
  "Let's unpack this piece by piece",
  you MUST use a numbered list or bullet points.

Give answer in less than 250 words.

Use bullet points as many as possible. 
For example, instead of saying: 
"There are two main types of regression: interpolation and extrapolation. Interpolation means predicting values inside the range of your known data, while extrapolation means guessing values outside that range."
You can say: 
"There are two main types of regression: 
- Interpolation: predicting values inside the range of your known data
- Extrapolation: guessing values outside that range."

Your success is measured by whether the student could re-explain the idea in their own words after reading your response.
"""

# Case 1: user asked about a text - call OpenAI 
def ask_openai(prompt_text, system_prompt=system_prompt):
    response = client.responses.create(
        model="gpt-4.1-mini",
        input=[
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": prompt_text
            }
        ],
        temperature=0.3
    )
    return response.output_text

# Case 2: user asked about a region - call OpenAI 
def ask_region(prompt_text, region_id, system_prompt=system_prompt):
    png_path = os.path.join(REGION_DIR, f"{region_id}.png")
    jpeg_path = os.path.join(REGION_DIR, f"{region_id}.jpeg")

    if os.path.exists(png_path):
        image_path = png_path
        mime = "image/png"
    elif os.path.exists(jpeg_path):
        image_path = jpeg_path
        mime = "image/jpeg"
    else:
        raise HTTPException(status_code=404, detail="Region image not found")

    with open(image_path, "rb") as f:
        img_bytes = f.read()

    image_base64 = base64.b64encode(img_bytes).decode("utf-8")
    data_url = f"data:{mime};base64,{image_base64}"

    response = client.responses.create(
        model="gpt-4.1-mini",
        input=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt_text},
                    {"type": "input_image", "image_url": data_url},
                ],
            },
        ],
        temperature=0.3,
    )

    return response.output_text

# Store annotation object
class CreateAnnotation(BaseModel):
    file_id: int
    page_number: int
    type: str
    geometry: Optional[dict] = None
    text: Optional[str] = None

# Store Ask Question objects
class AskQuestion(BaseModel):
    file_id: int
    annotation_id: Optional[int] = None
    question: str

# Change file title object
class RenameFileRequest(BaseModel):
    title: str

# Get the pdf file from frontend then write it into S3
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    document_id = str(uuid.uuid4())
    title = os.path.splitext(file.filename)[0]
    user_id = 1  # temporary

    pdf_bytes = await file.read()

    try:
        # 1. Begin transaction
        begin()

        # 2. Create DB file row (no s3_key yet)
        file_id = create_file(
            folder_id=None,
            document_id=document_id,
            title=title,
            user_id=user_id,
        )

        # 3. Upload to S3
        s3_key = upload_pdf(
            file_obj=BytesIO(pdf_bytes),
            user_id=user_id,
            file_id=file_id,
        )

        # 4. Update s3_key
        update_file_s3_key(file_id, s3_key)

        # 5. Commit transaction
        commit()

        return {
            "file_id": file_id,
            "title": title,
        }

    except Exception as e:
        # Rollback everything
        rollback()
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/annotations")
def create_text_annotation(payload: CreateAnnotation):
    document_id = get_document_id_by_file(payload.file_id)
    if not document_id:
        raise HTTPException(status_code=404, detail="File not found")

    annotation_id = create_annotation(
        document_id=document_id,
        page_number=payload.page_number,
        type=payload.type,
        geometry=payload.geometry,
        text=payload.text,
    )
    return {"annotation_id": annotation_id}

# Return “file metadata” 
@app.get("/files/{file_id}/meta")
def get_file_metadata(file_id: int):
    file = get_file(file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return file


@app.get("/files/{file_id}/state")
def get_file_state(file_id: int):
    # 1. Get file metadata
    file = get_file(file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    document_id = file["document_id"]

    # 2. Load document-scoped data
    messages = get_messages(document_id)
    annotations = get_annotations_by_document(document_id)

    # 3. Build PDF URL from S3
    if not file["s3_key"]:
        raise HTTPException(status_code=500, detail="File missing s3_key")

    pdf_url = generate_presigned_url(file["s3_key"])


    # 4. Return unified state
    return {
        "file": {
            "id": file["id"],
            "title": file["title"],
            "folder_id": file["folder_id"],
        },
        "pdf_url": pdf_url,
        "messages": messages,
        "annotations": annotations,
    }


# Get the image region from frontend
@app.post("/upload-region")
def upload_region_endpoint(
    file_id: str = Form(...),
    page_number: int = Form(...),
    geometry: Optional[str] = Form(None),          
    region: UploadFile = File(...)
):
    region_id = str(uuid.uuid4())

    document_id = get_document_id_by_file(file_id)
    if not document_id:
        raise HTTPException(status_code=404, detail="File not found")

    # Parse geometry
    try:
        normalized_geometry = json.loads(geometry)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid geometry payload")

    allowed_img_type = {"image/jpeg", "image/png"}

    if region.content_type not in allowed_img_type:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {region.content_type}."
        )

    # Decide extension based on content type
    ext = ".png" if region.content_type == "image/png" else ".jpeg"
    filename = f"{region_id}{ext}"

    ext = ".png" if region.content_type == "image/png" else ".jpeg"

    region_s3_key = upload_region_to_s3(
        file_obj=region.file,
        user_id=1,
        region_id=region_id,
        ext=ext,
    )



    # Store geometry with annotation
    annotation_id = create_annotation(
        document_id=document_id,
        page_number=page_number,
        type="region",
        geometry=normalized_geometry,
        region_id=region_id,
        region_s3_key=region_s3_key,
    )

    return {
        "annotation_id": annotation_id,
        "region_id": region_id,
        "document_id": document_id,
        "page_number": page_number,
        "url": f"http://localhost:8000/regions/{region_id}",
    }


# Get question from frontend
@app.post("/ask")
def ask_document(req: AskQuestion):

    # Example of pages = [{"page_number": ..., "text": ...}]
    document_id = get_document_id_by_file(req.file_id)
    if not document_id:
        raise HTTPException(status_code=404, detail="File not found")

    pages = get_pages(document_id)


    if not pages:
        return {"answer": "Document not found."}
    
    # Save user message first
    save_message(
        document_id = document_id,
        role = "user",
        content = req.question,
        annotation_id = req.annotation_id,
    )
    # ---------- Annotation-based mode ----------
    if req.annotation_id:
        annotation = get_annotation(req.annotation_id)
        selected_text = annotation.get("text")

        if not annotation:
            raise HTTPException(status_code=404, detail="Annotation not found")

        if annotation["document_id"] != document_id:
            raise HTTPException(status_code=400, detail="Annotation mismatch")

        page_idx = annotation["page_number"] - 1

        prev_text = pages[page_idx - 1]["text"] if page_idx - 1 >= 0 else ""
        curr_text = pages[page_idx]["text"]
        next_text = pages[page_idx + 1]["text"] if page_idx + 1 < len(pages) else ""

        history = get_messages_by_annotation(req.annotation_id)
        history_text = "\n".join(
            f"{m['role']}: {m['content']}"
            for m in history
        )

        prompt = f"""
The student selected the following exact text from the document:

\"\"\"{selected_text}\"\"\"

This text appears on page {annotation['page_number']}.

Here is surrounding context from the document (for reference only):

--- Previous context ---
{prev_text}

--- Same page ---
{curr_text}

--- Next context ---
{next_text}

Answer the question by focusing primarily on the selected text.
Only use the surrounding context if needed for clarification.

Question:
{req.question}
"""

        if annotation["type"] == "region":
            if not annotation.get("region_id"):
                raise HTTPException(status_code=500, detail="Region annotation missing region_id")
            answer = ask_region(prompt_text=prompt, region_id=annotation["region_id"])
        else:
            answer = ask_openai(prompt_text=prompt)

        answer = normalize_math(answer)

        save_message(
            document_id=document_id,
            role="assistant",
            content=answer,
            annotation_id=req.annotation_id,
        )

        return {"answer": answer}

    # ---------- Document-level fallback ----------
    prompt = f"""
    Answer the following question using the document below.

    {reshape_pages(pages)}

    Question:
    {req.question}
    """

    answer = ask_openai(prompt_text=prompt)
    answer = normalize_math(answer)

    save_message(
        document_id=document_id,
        role="assistant",
        content=answer,
        annotation_id=None,
    )

    return {"answer": answer}

# Get region image from /regions
@app.get("/regions/{region_id}")
def get_region(region_id: str):
    png_image = os.path.join(REGION_DIR, f"{region_id}.png")
    jpeg_image = os.path.join(REGION_DIR, f"{region_id}.jpeg")
    
    if os.path.exists(png_image):
        return FileResponse(path=png_image, media_type="image/png")

    if os.path.exists(jpeg_image):
        return FileResponse(path=jpeg_image, media_type="image/jpeg")
    
    raise HTTPException(
        status_code=404,
        detail=f"Region image {region_id} not found."
    )

@app.get("/chat/file/{file_id}")
def get_chat(file_id: int):
    document_id = get_document_id_by_file(file_id)
    if not document_id:
        raise HTTPException(status_code=404, detail="File not found")

    return {"messages": get_messages(document_id)}


@app.get("/chat/annotation/{annotation_id}")
def get_annotation_chat(annotation_id: int):
    return {
        "messages": get_messages_by_annotation(annotation_id)
    }

@app.get("/annotations/{annotation_id}")
def fetch_annotation(annotation_id: int):
    annotation = get_annotation(annotation_id)

    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")

    return annotation

@app.get("/annotations/file/{file_id}")
def get_document_annotations(file_id: int):
    document_id = get_document_id_by_file(file_id)
    if not document_id:
        raise HTTPException(status_code=404, detail="File not found")

    return {
        "annotations": get_annotations_by_document(document_id)
    }


@app.get("/folders")
def get_folders():
    return {"folders": list_folders(user_id=1)}

@app.get("/files")
def get_files():
    return {"files": list_files(user_id=1)}

@app.patch("/files/{file_id}/rename")
def rename_file_endpoint(file_id: int, payload: RenameFileRequest):
    success = rename_file(file_id, payload.title)

    if not success:
        raise HTTPException(status_code=404, detail="File not found")

    commit()
    return {"ok": True}

@app.delete("/files/{file_id}")
def delete_file(file_id: int):
    delete_file_cascade(file_id)
    return {"ok": True}


# Debug route 
@app.get("/debug/page_count")
def debug_page_count():
    return {"page_count": get_page_count()}


# Debug route - load OpenAI
@app.get("/debug/responses")
def debug_openai_responses():
    resp = client.responses.create(
        model="gpt-4o-mini",
        input="Say hello in one sentence"
    )
    return {"text": resp.output_text}

# Check health of the backend
@app.get("/health")
def health_check():
    return {"status": "ok"}
