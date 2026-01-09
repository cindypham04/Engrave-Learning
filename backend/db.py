# db.py
import sqlite3
import json

DB_PATH = "data.db"


# One shared connection, many cursors (this is OK)
conn = sqlite3.connect(DB_PATH, check_same_thread=False)

conn.execute("PRAGMA foreign_keys = ON")

def get_cursor():
    return conn.cursor()


# ======================================================
# Pages
# ======================================================

def init_pages():
    cur = get_cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS pages (
        document_id TEXT,
        page_number INTEGER,
        text TEXT,
        PRIMARY KEY (document_id, page_number)
    )
    """)


def save_pages(pages):
    cur = get_cursor()
    for page in pages:
        cur.execute(
            """
            INSERT OR REPLACE INTO pages (document_id, page_number, text)
            VALUES (?, ?, ?)
            """,
            (page["document_id"], page["page_number"], page["text"])
        )


def get_pages(document_id):
    cur = get_cursor()
    cur.execute(
        """
        SELECT page_number, text
        FROM pages
        WHERE document_id = ?
        ORDER BY page_number ASC
        """,
        (document_id,)
    )
    return [{"page_number": r[0], "text": r[1]} for r in cur.fetchall()]


def get_page_count():
    cur = get_cursor()
    cur.execute("SELECT COUNT(*) FROM pages")
    return cur.fetchone()[0]


# ======================================================
# Messages
# ======================================================

def init_messages():
    cur = get_cursor()
    cur.execute("""
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


def save_message(document_id, role, content, annotation_id=None, reference=None):
    cur = get_cursor()
    cur.execute(
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


def get_messages(document_id):
    cur = get_cursor()
    cur.execute(
        """
        SELECT role, content, annotation_id, reference
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
            "annotation_id": r[2],
            "reference": json.loads(r[3]) if r[3] else None,
        }
        for r in cur.fetchall()
    ]


def get_messages_by_annotation(annotation_id):
    cur = get_cursor()
    cur.execute(
        """
        SELECT role, content, annotation_id
        FROM messages
        WHERE annotation_id = ?
        ORDER BY created_at ASC
        """,
        (annotation_id,)
    )
    return [
        {"role": r[0], "content": r[1], "annotation_id": r[2]}
        for r in cur.fetchall()
    ]


# ======================================================
# Annotations
# ======================================================

def init_annotations():
    cur = get_cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        page_number INTEGER NOT NULL,
        type TEXT NOT NULL,
        geometry TEXT,
        text TEXT,
        region_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)


def create_annotation(document_id, page_number, type, geometry, text=None, region_id=None):
    cur = get_cursor()
    cur.execute(
        """
        INSERT INTO annotations (
            document_id, page_number, type, geometry, text, region_id
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            document_id,
            page_number,
            type,
            json.dumps(geometry) if geometry else None,
            text,
            region_id,
        )
    )
    return cur.lastrowid


def get_annotation(annotation_id):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, document_id, page_number, type, geometry, text, region_id
        FROM annotations
        WHERE id = ?
        """,
        (annotation_id,)
    )
    row = cur.fetchone()
    if not row:
        return None

    return {
        "id": row[0],
        "document_id": row[1],
        "page_number": row[2],
        "type": row[3],
        "geometry": json.loads(row[4]) if row[4] else None,
        "text": row[5],
        "region_id": row[6],
    }


def get_annotations_by_document(document_id):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, page_number, type, geometry, text, region_id, created_at
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
            "text": r[4],
            "region_id": r[5],
            "created_at": r[6],
        }
        for r in cur.fetchall()
    ]


# ======================================================
# Users, Folders, Files
# ======================================================

def init_users():
    cur = get_cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # seed user 1
    cur.execute("SELECT id FROM users WHERE id = 1")
    if not cur.fetchone():
        cur.execute("INSERT INTO users (id, email) VALUES (1, 'demo@local')")


def init_folders():
    cur = get_cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)


def init_files():
    cur = get_cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER,
        document_id TEXT NOT NULL UNIQUE,
        title TEXT,
        s3_key TEXT,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (folder_id) REFERENCES folders(id)
    )
    """)


def create_folder(name: str, user_id: int):
    cur = get_cursor()
    cur.execute(
        "INSERT INTO folders (name, user_id) VALUES (?, ?)",
        (name, user_id)
    )
    return cur.lastrowid


def list_folders(user_id=1):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, name, created_at
        FROM folders
        WHERE user_id = ?
        ORDER BY created_at ASC
        """,
        (user_id,)
    )
    return [{"id": r[0], "name": r[1], "created_at": r[2]} for r in cur.fetchall()]


def create_file(folder_id, document_id, title, user_id):
    cur = get_cursor()
    cur.execute(
        """
        INSERT INTO files (folder_id, document_id, title, user_id)
        VALUES (?, ?, ?, ?)
        """,
        (folder_id, document_id, title, user_id)
    )
    return cur.lastrowid


def get_file(file_id):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, folder_id, document_id, title, s3_key, created_at
        FROM files
        WHERE id = ?
        """,
        (file_id,)
    )
    row = cur.fetchone()
    if not row:
        return None

    return {
        "id": row[0],
        "folder_id": row[1],
        "document_id": row[2],
        "title": row[3],
        "s3_key": row[4],
        "created_at": row[5],
    }


def list_files(user_id=1):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, folder_id, title, s3_key, created_at
        FROM files
        WHERE user_id = ?
        ORDER BY created_at DESC
        """,
        (user_id,)
    )
    return [{"id": r[0], "folder_id": r[1], "title": r[2], "created_at": r[4]} for r in cur.fetchall()]


def update_file_s3_key(file_id, s3_key):
    cur = get_cursor()
    cur.execute(
        "UPDATE files SET s3_key = ? WHERE id = ?",
        (s3_key, file_id)
    )


def get_document_id_by_file(file_id):
    cur = get_cursor()
    cur.execute("SELECT document_id FROM files WHERE id = ?", (file_id,))
    row = cur.fetchone()
    return row[0] if row else None

def rename_file(file_id: int, new_title: str):
    cur = get_cursor()
    cur.execute(
        """
        UPDATE files
        SET title = ?
        WHERE id = ?
        """,
        (new_title, file_id),
    )

    if cur.rowcount == 0:
        return False

    return True



# ======================================================
# Init everything ONCE
# ======================================================

init_pages()
init_messages()
init_annotations()
init_users()
init_folders()
init_files()

def begin():
    cursor = get_cursor()
    cursor.execute("BEGIN")

def rollback():
    conn.rollback()

def commit():
    conn.commit()
