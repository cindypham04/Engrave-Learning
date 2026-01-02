# db.py
import sqlite3
import json

DB_PATH = "data.db"

conn = sqlite3.connect(DB_PATH, check_same_thread=False)
cursor = conn.cursor()

# ---------- Pages ----------

cursor.execute("""
CREATE TABLE IF NOT EXISTS pages (
    document_id TEXT,
    page_number INTEGER,
    text TEXT,
    PRIMARY KEY (document_id, page_number)
)
""")
conn.commit()

def save_pages(pages):
    for page in pages:
        cursor.execute(
            """
            INSERT OR REPLACE INTO pages (document_id, page_number, text)
            VALUES (?, ?, ?)
            """,
            (page["document_id"], page["page_number"], page["text"])
        )
    conn.commit()

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
    return [{"page_number": r[0], "text": r[1]} for r in cursor.fetchall()]

def get_page_count():
    cursor.execute("SELECT COUNT(*) FROM pages")
    return cursor.fetchone()[0]

# ---------- Messages ----------

cursor.execute("""
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    reference TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
""")
conn.commit()

def ensure_reference_column():
    cursor.execute("PRAGMA table_info(messages)")
    columns = [row[1] for row in cursor.fetchall()]
    if "reference" not in columns:
        cursor.execute("ALTER TABLE messages ADD COLUMN reference TEXT")
        conn.commit()

ensure_reference_column()

def save_message(document_id, role, content, reference=None):
    cursor.execute(
        """
        INSERT INTO messages (document_id, role, content, reference)
        VALUES (?, ?, ?, ?)
        """,
        (document_id, role, content, json.dumps(reference) if reference else None)
    )
    conn.commit()

def get_messages(document_id):
    cursor.execute(
        """
        SELECT role, content, reference
        FROM messages
        WHERE document_id = ?
        ORDER BY created_at ASC
        """,
        (document_id,)
    )
    return [
        {
            "role": r[0],
            "content": r[1],
            "reference": json.loads(r[2]) if r[2] else None
        }
        for r in cursor.fetchall()
    ]
