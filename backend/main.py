from fastapi import FastAPI, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil 
from fastapi.responses import FileResponse
import uuid
import fitz
import sqlite3
from pydantic import BaseModel
from typing import Optional
from fastapi import HTTPException
from dotenv import load_dotenv
from openai import OpenAI
import base64
import re

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

# Initialize SQLite database connection
DB_PATH = "data.db"

conn = sqlite3.connect(DB_PATH, check_same_thread=False) # conn is the database connection
cursor = conn.cursor() # cursor is used to execute SQL commands

# Create the table
cursor.execute("""
CREATE TABLE IF NOT EXISTS pages (
    document_id TEXT,
    page_number INTEGER,
    text TEXT,
    PRIMARY KEY (document_id, page_number)
)
""")
conn.commit()

# Define where uploaded files will be stored
UPLOAD_DIR = "uploads/documents"
os.makedirs(UPLOAD_DIR, exist_ok=True) # create upload directory if not exists

# Define where region images will be stored
REGION_DIR = "uploads/regions"
os.makedirs(REGION_DIR, exist_ok=True) # create image directory if not exists

# Load PDF document and extract text from each page
def extract_pages_from_pdf(document_id): 
    file_path = os.path.join(UPLOAD_DIR, f"{document_id}.pdf")

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Document {document_id} not found.")

    pdf = fitz.open(file_path) # a PDF object is a list-like container of pages

    pdf_cache = []

    for idx, page in enumerate(pdf):
        text = page.get_text() # extract text from each page
        pdf_cache.append({
            "document_id": document_id,
            "page_number": idx + 1,
            "text": text,
        })

    return pdf_cache

# Save extracted page to SQLite
def save_pages(pages):
    for page in pages: 
        cursor.execute(
            """
            INSERT OR REPLACE INTO pages (document_id, page_number, text)
            VALUES (?, ?, ?)
            """,
            (
                page["document_id"],
                page["page_number"],
                page["text"]
            )
        )
    conn.commit()

# Get pages from SQLite by document_id 
def get_pages(document_id):
    cursor.execute(
        """
        SELECT page_number, text 
        FROM pages
        WHERE document_id = ?
        ORDER BY page_number ASC
        """,
        (document_id,)
    )

    # fetch all pages from the document
    rows = cursor.fetchall()

    pages = []

    for row in rows:
        pages.append({
            "page_number": row[0],
            "text": row[1]
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

# Case 2: user asked about a region image - call OpenAI
def ask_region(prompt_text, region_id, system_prompt=system_prompt):
    # Resolve image path
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

    # Load image bytes
    with open(image_path, "rb") as f:
        img_bytes = f.read()

    # Encode as Base64 and wrap as data URL
    image_base64 = base64.b64encode(img_bytes).decode("utf-8")
    data_url = f"data:{mime};base64,{image_base64}"

    # Call OpenAI
    response = client.responses.create(
        model="gpt-4.1-mini",
        input=[
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt_text},
                    {
                        "type": "input_image",
                        "image_url": data_url
                    }
                ]
            }
        ],
        temperature=0.3
    )

    return response.output_text


# Store Context objects
class Context(BaseModel):
    text: str
    page: Optional[int] = None

class Region(BaseModel):
    region_id: str
    document_id:str
    page_number: int

# Store Ask Question objects
class AskQuestion(BaseModel):
    document_id: str
    question: str
    context: Optional[Context] = None
    region: Optional[Region] = None

# Get the pdf file from frontend then write it into uploads
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    document_id = str(uuid.uuid4())

    file_path = os.path.join(UPLOAD_DIR, f"{document_id}.pdf")

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    pages = extract_pages_from_pdf(document_id)
    save_pages(pages)

    return {
        "document_id" : document_id,
        "original_filename": file.filename,
        "url": f"http://localhost:8000/files/{document_id}"
    }


# Return document to frontend
@app.get("/files/{document_id}")
def get_file(document_id: str):
    return FileResponse(
        path=os.path.join(UPLOAD_DIR,  f"{document_id}.pdf"),
        media_type="application/pdf"
    )

# Get the image region from frontend
@app.post("/upload-region")
def upload_region(document_id: str = Form(...), page_number: int = Form(...), region: UploadFile = File(...)):
    region_id = str(uuid.uuid4())

    allowed_img_type = {"image/jpeg", "image/png"}

    if region.content_type not in allowed_img_type:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {region.content_type}."
        )
    
    # Decide extension based on content type
    ext = ".png" if region.content_type == "image/png" else ".jpeg"
    filename = f"{region_id}{ext}"

    # Save region image to disk
    file_path = os.path.join(REGION_DIR, filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(region.file, buffer)

    return {
        "region_id": region_id,
        "document_id": document_id,
        "page_number": page_number,
        "content_type": region.content_type,
        "url": f"http://localhost:8000/regions/{region_id}"
    }


# Get question from frontend
@app.post("/ask")
def ask_document(req: AskQuestion):
    # Example of pages = [{"page_number": ..., "text": ...}]
    pages = get_pages(req.document_id)

    if not pages:
        return {"answer": "Document not found."}

    # Case 1: user provided context (selected text)
    # Prompt format: context (selected text) -> rule -> question -> reference pages 
    if req.context:
        print("Context mode")
        print("Text:", req.context.text)

        # Get reference page number, also the previous and following pages
        current_idx = req.context.page - 1

        previous_page_context = pages[current_idx - 1]['text'] if current_idx - 1 >= 0 else ""
        current_page_context = pages[current_idx]['text']
        next_page_context = pages[current_idx + 1]['text'] if current_idx + 1 < len(pages) else ""

        # Use context as primary signal
        context = f"""
        The student selected the following text from the document:

        \"\"\"{req.context.text}\"\"\"

        If the question uses “this”, “it”, or “that”, they refer to the highlighted text above.
        Question: {req.question}.

        Supporting document content: 
        {current_page_context}.
        {previous_page_context}.
        {next_page_context}.
        """

        print("FINAL PROMPT:\n", context)

        answer = ask_openai(prompt_text=context)
        answer = normalize_math(answer)

        return {"answer": answer}

    
    # Case 2: user provided region image
    # Prompt format: question -> region image -> reference pages
    elif req.region:
        print("Region mode")

        if req.region.document_id != req.document_id:
            raise HTTPException(
                status_code=400,
                detail="Region image does not belong to the specified document."
            )
        
        # Get reference page number, also the previous and following pages
        current_idx = req.region.page_number - 1

        previous_page_context = pages[current_idx - 1]["text"] if current_idx - 1 >= 0 else ""
        current_page_context = pages[current_idx]["text"]
        next_page_context = pages[current_idx + 1]["text"] if current_idx + 1 < len(pages) else ""

        region_context = f""" The student has attached a cropped image taken from page {req.region.page_number} of the document.
        
        The image may contain a diagram, equation, or visual explanation.
        Use the image as the primary source of information.

        The text below comes from the surrounding slide and is provided only to clarify context.
        Do not assume meanings for symbols or relationships that are not visible or explained.

        Question: {req.question}.

        Supporting text from the document:
        {current_page_context}.
        {previous_page_context}.
        {next_page_context}.
        """

        answer = ask_region(prompt_text=region_context, region_id=req.region.region_id)
        answer = normalize_math(answer)

        return {"answer": answer}


    # Case 3: no context provided, use full document
    # Prompt format: question -> whole document
    print("Document-wise mode")
    context = f"Answer the following question {req.question} using the following document content: {reshape_pages(pages)}"
    answer = ask_openai(prompt_text=context)
    answer = normalize_math(answer)

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

# Debug route 
@app.get("/debug/page_count")
def debug_page_count():
    cursor.execute("SELECT COUNT(*) FROM pages")
    count = cursor.fetchone()[0]
    return {"page_count": count}

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