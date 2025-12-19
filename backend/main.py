from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil 
from fastapi.responses import FileResponse
import uuid
import fitz
import sqlite3

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
def extract_pdf(document_id): 
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

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    document_id = str(uuid.uuid4())

    file_path = os.path.join(UPLOAD_DIR, f"{document_id}.pdf")

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    pages = extract_pdf(document_id)
    save_pages(pages)

    return {
        "document_id" : document_id,
        "original_filename": file.filename,
        "url": f"http://localhost:8000/files/{document_id}"
    }

@app.get("/files/{document_id}")
def get_file(document_id: str):
    return FileResponse(
        path=os.path.join(UPLOAD_DIR,  f"{document_id}.pdf"),
        media_type="application/pdf"
    )

# Debug route 
@app.get("/debug/page_count")
def debug_page_count():
    cursor.execute("SELECT COUNT(*) FROM pages")
    count = cursor.fetchone()[0]
    return {"page_count": count}