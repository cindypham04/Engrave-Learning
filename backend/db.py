# db.py
import sqlite3
import json

DB_PATH = "data.db"

conn = sqlite3.connect(DB_PATH, check_same_thread=False)
cursor = conn.cursor()

# ======================================================
# Pages
# ======================================================

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


# ======================================================
# Messages
# ======================================================

cursor.execute("""
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    annotation_id INTEGER,
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


def ensure_annotation_id_column():
    cursor.execute("PRAGMA table_info(messages)")
    columns = [row[1] for row in cursor.fetchall()]
    if "annotation_id" not in columns:
        cursor.execute("ALTER TABLE messages ADD COLUMN annotation_id INTEGER")
        conn.commit()


ensure_reference_column()
ensure_annotation_id_column()


def save_message(document_id, role, content, annotation_id=None, reference=None):
    cursor.execute(
        """
        INSERT INTO messages (document_id, role, content, annotation_id, reference)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            document_id,
            role,
            content,
            annotation_id,
            json.dumps(reference) if reference else None,
        )
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
            "reference": json.loads(r[2]) if r[2] else None,
        }
        for r in cursor.fetchall()
    ]


def get_messages_by_annotation(annotation_id):
    cursor.execute(
        """
        SELECT role, content
        FROM messages
        WHERE annotation_id = ?
        ORDER BY created_at ASC
        """,
        (annotation_id,)
    )
    return [{"role": r[0], "content": r[1]} for r in cursor.fetchall()]


# ======================================================
# Annotations
# ======================================================

cursor.execute("""
CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    type TEXT NOT NULL,
    geometry TEXT,
    region_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
""")
conn.commit()


def ensure_region_id_column():
    cursor.execute("PRAGMA table_info(annotations)")
    columns = [row[1] for row in cursor.fetchall()]
    if "region_id" not in columns:
        cursor.execute("ALTER TABLE annotations ADD COLUMN region_id TEXT")
        conn.commit()


ensure_region_id_column()


def create_annotation(document_id, page_number, type, geometry, region_id=None):
    cursor.execute(
        """
        INSERT INTO annotations (document_id, page_number, type, geometry, region_id)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            document_id,
            page_number,
            type,
            json.dumps(geometry) if geometry else None,
            region_id,
        )
    )
    conn.commit()
    return cursor.lastrowid


def get_annotation(annotation_id):
    cursor.execute(
        """
        SELECT id, document_id, page_number, type, geometry, region_id
        FROM annotations
        WHERE id = ?
        """,
        (annotation_id,)
    )
    row = cursor.fetchone()
    if not row:
        return None

    return {
        "id": row[0],
        "document_id": row[1],
        "page_number": row[2],
        "type": row[3],
        "geometry": json.loads(row[4]) if row[4] else None,
        "region_id": row[5],
    }


def get_annotations_by_document(document_id):
    cursor.execute(
        """
        SELECT id, page_number, type, geometry, region_id, created_at
        FROM annotations
        WHERE document_id = ?
        ORDER BY created_at ASC
        """,
        (document_id,)
    )
    return [
        {
            "id": r[0],
            "page_number": r[1],
            "type": r[2],
            "geometry": json.loads(r[3]) if r[3] else None,
            "region_id": r[4],
            "created_at": r[5],
        }
        for r in cursor.fetchall()
    ]


def get_annotations_by_page(document_id, page_number):
    cursor.execute(
        """
        SELECT id, type, geometry, region_id, created_at
        FROM annotations
        WHERE document_id = ? AND page_number = ?
        ORDER BY created_at ASC
        """,
        (document_id, page_number)
    )
    return [
        {
            "id": r[0],
            "type": r[1],
            "geometry": json.loads(r[2]) if r[2] else None,
            "region_id": r[3],
            "created_at": r[4],
        }
        for r in cursor.fetchall()
    ]
