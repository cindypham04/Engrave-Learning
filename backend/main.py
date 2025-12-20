from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil 
from fastapi.responses import FileResponse
import uuid
import fitz
import sqlite3
from pydantic import BaseModel
from openai import OpenAI

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
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True) # create upload directory if not exists

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

# LLM helper
def ask_openai(question: str, context: str):
    resp = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {
                "role": "system",
                "content": """ 
You are a patient and friendly tutor.

Rules you must follow:
- Use ONLY the provided document content. Do not use external knowledge.
- If the answer is not clearly stated in the material, say:
  "This is not specified in the material."

How to structure your answer:
1. Start with 1-2 sentences that give a high-level, intuitive summary.
2. Then explain in more detail using bullet points when helpful.
   - Use simple language, as if explaining to a 12-year-old.
   - Avoid jargon when possible. If jargon is necessary, explain it clearly.
3. Keep the explanation concise (a 2-3 short paragraphs).

Tone:
- Friendly, calm, encouraging.
- End with one gentle follow-up question.
"""
            },
            {
                "role": "user",
                "content" : f"Document:\n{context}\n\nQuestion:\n{question}"
            }
        ],
        temperature = 0.3 # how predictable vs creative the model’s answers are
    )
    return resp.choices[0].message.content

# Store Ask Question objects
class AskQuestion(BaseModel):
    document_id: str
    question: str

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


# Get question from frontend
@app.post("/ask")
def ask_document(req: AskQuestion):
    pages = get_pages(req.document_id)

    # Edge case: document not found
    if not pages:
        return {
            "answer": "Document not found.",
        }
    
    page_context = reshape_pages(pages)

    answer = ask_openai(req.question, page_context)

    return {
        "answer": answer
    }

# Debug route 
@app.get("/debug/page_count")
def debug_page_count():
    cursor.execute("SELECT COUNT(*) FROM pages")
    count = cursor.fetchone()[0]
    return {"page_count": count}

# Check health of the backend
@app.get("/health")
def health_check():
    return {"status": "ok"}