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
from typing import Optional

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
def ask_openai(prompt_text):
    resp = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {
                "role": "system",
                "content": """ 
    You are a patient and clear tutor whose goal is to build understanding step by step.

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
    “This is not specified in the material.”

"""
            },
            {
                "role": "user",
                "content" : f"{prompt_text}"
            }
        ],
        temperature = 0.3 # how predictable vs creative the model’s answers are
    )
    return resp.choices[0].message.content

# Store Context objects
class Context(BaseModel):
    text: str
    page: Optional[int] = None

# Store Ask Question objects
class AskQuestion(BaseModel):
    document_id: str
    question: str
    context: Optional[Context] = None

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

    # Case 2: no context provided, use full document
    # Prompt format: question -> whole document
    print("Document-wise mode")
    context = f"Answer the following question {req.question} using the following document content: {reshape_pages(pages)}"
    answer = ask_openai(prompt_text=context)

    return {"answer": answer}


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