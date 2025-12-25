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

load_dotenv()

api_key = os.getenv("OPENAI_API_KEY")
print("OPENAI_API_KEY loaded:", bool(api_key))

if not api_key:
    raise RuntimeError("OPENAI_API_KEY is missing")

client = OpenAI(api_key=api_key)

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

system_prompt = """  You are a patient and clear tutor whose goal is to build understanding step by step.

    You must explain concepts using a strict progression:
    1. Start by stating the goal or problem in plain language.
    2. Explain why this problem exists or why it matters.
    3. Describe how the idea or method works at a high level.
    4. Explain how it is used when new data or situations appear.
    5. Ground the explanation with one concrete example.
    6. Only after the intuition is clear, introduce technical terms and define them.

    Rules:
    - Each paragraph must introduce new information.
    - Do NOT restate or paraphrase earlier sentences.
    - Assume the reader remembers what you just explained.
    - Avoid circular definitions.
    - Introduce technical terms (e.g., decision boundary, distribution) only after explaining the intuition behind them.

    Style:
    - Write as if teaching a smart student encountering the idea for the first time.
    - Be concise but complete.
    - Prefer cause → effect explanations.
    - Use simple language; explain jargon only when necessary.

    If the answer is not clearly supported by the provided document, say:
    “This is not specified in the material."
"""

# Case 1: user asked about a text - call OpenAI 
def ask_openai(prompt_text, system_prompt=system_prompt):
    resp = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content" : f"{prompt_text}"
            }
        ],
        temperature = 0.3 # how predictable vs creative the model’s answers are
    )
    return resp.choices[0].message.content

# Case 2: user asked about a region image - Call OpenAI
def ask_region(prompt_text, region_id, system_prompt=system_prompt):
    resp = client.responses.create(
        model="gpt-4o-mini",
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
                        "image_url": f"http://localhost:8000/regions/{region_id}"
                    }
                ]
            }
        ],
        temperature=0.3
    )

    return resp.output_text



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

        return {"answer": answer}

    # Case 3: no context provided, use full document
    # Prompt format: question -> whole document
    print("Document-wise mode")
    context = f"Answer the following question {req.question} using the following document content: {reshape_pages(pages)}"
    answer = ask_openai(prompt_text=context)

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