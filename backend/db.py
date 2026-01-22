# SQLite helpers and cascade rules for files, chats, annotations, and highlights.
# db.py
import sqlite3
import json
import os
from typing import Optional

DB_PATH = "data.db"


# One shared connection, many cursors (this is OK)
conn = sqlite3.connect(DB_PATH, check_same_thread=False)

conn.execute("PRAGMA foreign_keys = ON")

def get_cursor():
    return conn.cursor()

def cleanup_math_blocks(text: str) -> str:
    if not text:
        return text

    while "$$\n$$" in text:
        text = text.replace("$$\n$$", "$$")

    lines = text.split("\n")
    cleaned = []
    i = 0
    while i < len(lines):
        if (
            lines[i].strip() == "$$"
            and i + 2 < len(lines)
            and lines[i + 2].strip() == "$$"
            and "$" in lines[i + 1]
        ):
            cleaned.append(lines[i + 1])
            i += 3
            continue

        cleaned.append(lines[i])
        i += 1

    return "\n".join(cleaned)


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
        document_id TEXT,
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
        SELECT id, role, content, annotation_id, reference
        FROM messages
        WHERE document_id = ?
        ORDER BY created_at ASC
        """,
        (document_id,)
    )
    return [
        {
            "id": r[0],
            "role": r[1],
            "content": cleanup_math_blocks(r[2]),
            "annotation_id": r[3],
            "reference": json.loads(r[4]) if r[4] else None,
        }
        for r in cur.fetchall()
    ]


def get_messages_by_annotation(annotation_id):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, role, content, annotation_id
        FROM messages
        WHERE annotation_id = ?
        ORDER BY created_at ASC
        """,
        (annotation_id,)
    )
    return [
        {
            "id": r[0],
            "role": r[1],
            "content": cleanup_math_blocks(r[2]),
            "annotation_id": r[3],
        }
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
        region_s3_key TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)


def create_annotation(document_id, page_number, type, geometry, text=None, region_id=None, region_s3_key=None,):
    cur = get_cursor()
    cur.execute(
        """
        INSERT INTO annotations (
            document_id, page_number, type, geometry, text, region_id, region_s3_key
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            document_id,
            page_number,
            type,
            json.dumps(geometry) if geometry else None,
            text,
            region_id,
            region_s3_key,
        )
    )
    return cur.lastrowid


def get_annotation(annotation_id):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, document_id, page_number, type, geometry, text, region_id, region_s3_key
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
        "region_s3_key": row[7],
    }


def get_annotations_by_document(document_id):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, page_number, type, geometry, text, region_id, created_at, region_s3_key
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
            "region_s3_key": r[7],
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
        parent_id INTEGER,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES folders(id)
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


def create_folder(name: str, user_id: int, parent_id: Optional[int] = None):
    cur = get_cursor()
    cur.execute(
        """
        INSERT INTO folders (name, user_id, parent_id)
        VALUES (?, ?, ?)
        """,
        (name, user_id, parent_id)
    )
    return cur.lastrowid


def list_folders(user_id: int, parent_id: Optional[int] = None):
    cur = get_cursor()

    if parent_id is None:
        cur.execute(
            """
            SELECT id, name, parent_id
            FROM folders
            WHERE user_id = ? AND parent_id IS NULL
            ORDER BY created_at ASC
            """,
            (user_id,)
        )
    else:
        cur.execute(
            """
            SELECT id, name, parent_id
            FROM folders
            WHERE user_id = ? AND parent_id = ?
            ORDER BY created_at ASC
            """,
            (user_id, parent_id)
        )

    return {
        "folders": [
            {"id": r[0], "name": r[1], "parent_id": r[2]}
            for r in cur.fetchall()
        ]
    }



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
        SELECT
            f.id,
            f.folder_id,
            f.title,
            f.s3_key,
            f.created_at,
            pf.id AS parent_file_id
        FROM files f
        LEFT JOIN chat_threads ct
            ON ct.file_id = f.id
            AND ct.source_annotation_id IS NOT NULL
            AND f.s3_key IS NULL
        LEFT JOIN annotations a ON a.id = ct.source_annotation_id
        LEFT JOIN files pf ON pf.document_id = a.document_id
        WHERE f.user_id = ?
        ORDER BY f.created_at DESC
        """,
        (user_id,)
    )
    return [
        {
            "id": r[0],
            "folder_id": r[1],
            "title": r[2],
            "s3_key": r[3],
            "created_at": r[4],
            "parent_file_id": r[5],
        }
        for r in cur.fetchall()
    ]


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

def rename_folder(folder_id: int, new_name: str):
    cur = get_cursor()
    cur.execute(
        """
        UPDATE folders
        SET name = ?
        WHERE id = ?
        """,
        (new_name, folder_id),
    )

    if cur.rowcount == 0:
        return False

    return True


def delete_file_cascade(file_id: int):
    cur = get_cursor()

    # Remove a file and all related chat threads, annotations, messages, and highlights.
    document_id = get_document_id_by_file(file_id)
    if not document_id:
        raise Exception("File not found")

    # 0. Delete child chats created from highlights in this file
    cur.execute(
        """
        SELECT id, file_id
        FROM chat_threads
        WHERE source_annotation_id IN (
            SELECT id FROM annotations WHERE document_id = ?
        )
        """,
        (document_id,),
    )
    child_threads = cur.fetchall()
    for thread_id, child_file_id in child_threads:
        if child_file_id and child_file_id != file_id:
            delete_file_cascade(child_file_id)
        else:
            cur.execute(
                """
                DELETE FROM chat_highlights
                WHERE message_id IN (
                    SELECT id FROM messages WHERE chat_thread_id = ?
                )
                """,
                (thread_id,),
            )
            cur.execute(
                "DELETE FROM messages WHERE chat_thread_id = ?",
                (thread_id,),
            )
            cur.execute(
                "DELETE FROM chat_threads WHERE id = ?",
                (thread_id,),
            )

    # 0. Delete chat highlights referencing messages from this document
    cur.execute(
        """
        DELETE FROM chat_highlights
        WHERE message_id IN (
            SELECT id FROM messages WHERE document_id = ?
        )
        """,
        (document_id,),
    )

    # 1. Delete messages
    cur.execute(
        "DELETE FROM messages WHERE document_id = ?",
        (document_id,)
    )

    # 2. Delete chat threads (IMPORTANT)
    cur.execute(
        "DELETE FROM chat_threads WHERE file_id = ?",
        (file_id,)
    )

    # 3. Delete chat highlights
    cur.execute(
        """
        DELETE FROM chat_highlights
        WHERE annotation_id IN (
            SELECT id FROM annotations WHERE document_id = ?
        )
        """,
        (document_id,),
    )

    # 4. Delete annotations
    cur.execute(
        "DELETE FROM annotations WHERE document_id = ?",
        (document_id,)
    )

    # 5. Delete file
    cur.execute(
        "DELETE FROM files WHERE id = ?",
        (file_id,)
    )


def delete_annotation(annotation_id: int):
    cur = get_cursor()

    # Remove an annotation and any child chats spawned from it.
    # If this annotation spawned a standalone chat, delete that chat file too
    cur.execute(
        """
        SELECT id, file_id
        FROM chat_threads
        WHERE source_annotation_id = ?
        """,
        (annotation_id,),
    )
    child_threads = cur.fetchall()
    for thread_id, file_id in child_threads:
        if file_id:
            delete_file_cascade(file_id)
        else:
            cur.execute(
                "DELETE FROM messages WHERE chat_thread_id = ?",
                (thread_id,),
            )
            cur.execute(
                "DELETE FROM chat_threads WHERE id = ?",
                (thread_id,),
            )

    # Get annotation (needed for region_s3_key)
    cur.execute(
        """
        SELECT document_id, region_s3_key
        FROM annotations
        WHERE id = ?
        """,
        (annotation_id,)
    )
    row = cur.fetchone()
    if not row:
        return None

    document_id, region_s3_key = row

    # Delete annotation messages
    cur.execute(
        "DELETE FROM messages WHERE annotation_id = ?",
        (annotation_id,)
    )

    # Delete chat highlight entries
    cur.execute(
        "DELETE FROM chat_highlights WHERE annotation_id = ?",
        (annotation_id,),
    )

    # Delete annotation itself
    cur.execute(
        "DELETE FROM annotations WHERE id = ?",
        (annotation_id,)
    )

    return {
        "document_id": document_id,
        "region_s3_key": region_s3_key,
    }

def set_folder_parent(folder_id: int, parent_id: Optional[int]):
    cur = get_cursor()
    cur.execute(
        "UPDATE folders SET parent_id = ? WHERE id = ?",
        (parent_id, folder_id)
    )

# ======================================================
# Chat
# ======================================================

def migrate_add_chat_thread_id_to_messages():
    cur = get_cursor()

    # Check if column already exists
    cur.execute("PRAGMA table_info(messages)")
    columns = [row[1] for row in cur.fetchall()]

    if "chat_thread_id" not in columns:
        cur.execute(
            "ALTER TABLE messages ADD COLUMN chat_thread_id INTEGER"
        )

def init_chat_threads():
    cur = get_cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS chat_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NULL,
        source_annotation_id INTEGER NULL,
        title TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files(id),
        FOREIGN KEY (source_annotation_id) REFERENCES annotations(id)
    )
    """)

def create_chat_thread(
    file_id: Optional[int] = None,
    source_annotation_id: Optional[int] = None,
    title: Optional[str] = None,
):
    cur = get_cursor()
    cur.execute(
        """
        INSERT INTO chat_threads (file_id, source_annotation_id, title)
        VALUES (?, ?, ?)
        """,
        (file_id, source_annotation_id, title),
    )
    return cur.lastrowid

def get_chat_threads_by_file(file_id: int):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, source_annotation_id, title
        FROM chat_threads
        WHERE file_id = ?
        ORDER BY created_at ASC
        """,
        (file_id,),
    )
    return [
        {
            "id": r[0],
            "source_annotation_id": r[1],
            "title": r[2],
        }
        for r in cur.fetchall()
    ]

def save_message_to_thread(
    chat_thread_id: int,
    document_id: str,
    role: str,
    content: str,
    annotation_id: Optional[int] = None,
    reference: Optional[dict] = None,
):
    cur = get_cursor()
    cur.execute(
        """
        INSERT INTO messages (
            chat_thread_id,
            document_id,
            role,
            content,
            annotation_id,
            reference
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            chat_thread_id,
            document_id,
            role,
            content,
            annotation_id,
            json.dumps(reference) if reference else None,
        ),
    )
    return cur.lastrowid

def get_messages_by_thread(chat_thread_id: int):
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, role, content, annotation_id, reference
        FROM messages
        WHERE chat_thread_id = ?
        ORDER BY created_at ASC
        """,
        (chat_thread_id,),
    )
    return [
        {
            "id": r[0],
            "role": r[1],
            "content": cleanup_math_blocks(r[2]),
            "annotation_id": r[3],
            "reference": json.loads(r[4]) if r[4] else None,
        }
        for r in cur.fetchall()
    ]


# ======================================================
# Chat highlights
# ======================================================

def init_chat_highlights():
    cur = get_cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_highlights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            annotation_id INTEGER NOT NULL,
            message_id INTEGER NOT NULL,
            start INTEGER NOT NULL,
            end INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (annotation_id) REFERENCES annotations(id),
            FOREIGN KEY (message_id) REFERENCES messages(id)
        )
        """
    )


def save_chat_highlight(
    annotation_id: int,
    message_id: int,
    start: int,
    end: int,
):
    cur = get_cursor()
    cur.execute(
        """
        INSERT INTO chat_highlights (annotation_id, message_id, start, end)
        VALUES (?, ?, ?, ?)
        """,
        (annotation_id, message_id, start, end),
    )


def get_chat_highlights_by_document(document_id: str):
    cur = get_cursor()
    cur.execute(
        """
        SELECT ch.annotation_id, ch.message_id, ch.start, ch.end
        FROM chat_highlights ch
        JOIN annotations a ON a.id = ch.annotation_id
        WHERE a.document_id = ?
        ORDER BY ch.created_at ASC
        """,
        (document_id,),
    )
    return [
        {
            "annotation_id": r[0],
            "message_id": r[1],
            "start": r[2],
            "end": r[3],
        }
        for r in cur.fetchall()
    ]

def migrate_create_chat_threads_from_existing_data():
    cur = get_cursor()

    # 1. Document-level chats (one per file)
    cur.execute("SELECT id, document_id, title FROM files")
    files = cur.fetchall()

    file_thread_map = {}

    for file_id, document_id, title in files:
        thread_id = create_chat_thread(
            file_id=file_id,
            source_annotation_id=None,
            title=title or "Document chat",
        )
        file_thread_map[document_id] = thread_id

    # 2. Annotation-level chats
    cur.execute("SELECT id, document_id, page_number FROM annotations")
    annotations = cur.fetchall()

    annotation_thread_map = {}

    for annotation_id, document_id, page_number in annotations:
        thread_id = create_chat_thread(
            file_id=None,
            source_annotation_id=annotation_id,
            title=f"Highlight p.{page_number}",
        )
        annotation_thread_map[annotation_id] = thread_id

    # 3. Attach messages to threads
    cur.execute(
        "SELECT id, document_id, annotation_id FROM messages"
    )
    messages = cur.fetchall()

    for msg_id, document_id, annotation_id in messages:
        if annotation_id and annotation_id in annotation_thread_map:
            thread_id = annotation_thread_map[annotation_id]
        else:
            thread_id = file_thread_map.get(document_id)

        cur.execute(
            """
            UPDATE messages
            SET chat_thread_id = ?
            WHERE id = ?
            """,
            (thread_id, msg_id),
        )

def migrate_backfill_child_chat_threads():
    cur = get_cursor()
    cur.execute(
        """
        SELECT id, file_id
        FROM chat_threads
        WHERE source_annotation_id IS NULL
          AND file_id IS NOT NULL
        """
    )
    threads = cur.fetchall()

    for thread_id, file_id in threads:
        cur.execute(
            """
            SELECT annotation_id
            FROM messages
            WHERE chat_thread_id = ?
              AND annotation_id IS NOT NULL
            ORDER BY created_at ASC
            LIMIT 1
            """,
            (thread_id,),
        )
        row = cur.fetchone()
        if not row:
            continue

        annotation_id = row[0]
        cur.execute(
            "SELECT document_id FROM annotations WHERE id = ?",
            (annotation_id,),
        )
        ann_row = cur.fetchone()
        if not ann_row:
            continue

        cur.execute(
            "SELECT document_id FROM files WHERE id = ?",
            (file_id,),
        )
        file_row = cur.fetchone()
        if not file_row:
            continue

        if ann_row[0] != file_row[0]:
            cur.execute(
                """
                UPDATE chat_threads
                SET source_annotation_id = ?
                WHERE id = ?
                """,
                (annotation_id, thread_id),
            )

def get_child_folders(folder_id: int):
    cur = get_cursor()
    cur.execute(
        "SELECT id FROM folders WHERE parent_id = ?",
        (folder_id,)
    )
    return [r[0] for r in cur.fetchall()]

def get_files_in_folder(folder_id: int):
    cur = get_cursor()
    cur.execute(
        "SELECT id FROM files WHERE folder_id = ?",
        (folder_id,)
    )
    return [r[0] for r in cur.fetchall()]

def delete_folder_cascade(folder_id: int):
    cur = get_cursor()

    # 1. Delete files in this folder
    file_ids = get_files_in_folder(folder_id)
    for file_id in file_ids:
        if not get_document_id_by_file(file_id):
            continue
        delete_file_cascade(file_id)

    # 2. Delete child folders (recursive)
    child_folders = get_child_folders(folder_id)
    for child_id in child_folders:
        delete_folder_cascade(child_id)

    # 3. Delete the folder itself
    cur.execute(
        "DELETE FROM folders WHERE id = ?",
        (folder_id,)
    )

def get_next_chat_title(user_id: int) -> str:
    cur = get_cursor()
    cur.execute(
        """
        SELECT COUNT(*)
        FROM files
        WHERE user_id = ? AND s3_key IS NULL
        """,
        (user_id,),
    )
    count = cur.fetchone()[0]
    return f"Chat_{count + 1}"

# Create standalone chat file + thread
def create_standalone_chat(
    user_id: int,
    folder_id: Optional[int] = None,
    title: Optional[str] = None,
    source_annotation_id: Optional[int] = None,
):
    """
    Creates:
    - a file entry representing the chat
    - a document-level chat thread
    Returns file + thread info
    """

    if not title:
        title = get_next_chat_title(user_id)

    # Use a synthetic document_id for chats
    document_id = f"chat_{os.urandom(6).hex()}"

    cur = get_cursor()

    # 1. Create file (chat)
    cur.execute(
        """
        INSERT INTO files (folder_id, document_id, title, user_id)
        VALUES (?, ?, ?, ?)
        """,
        (folder_id, document_id, title, user_id),
    )
    file_id = cur.lastrowid

    # 2. Create document-level chat thread
    cur.execute(
        """
        INSERT INTO chat_threads (file_id, source_annotation_id, title)
        VALUES (?, ?, ?)
        """,
        (file_id, source_annotation_id, title),
    )
    thread_id = cur.lastrowid

    return {
        "file_id": file_id,
        "document_id": document_id,
        "thread_id": thread_id,
        "title": title,
    }

def get_chat_thread_by_annotation(annotation_id: int):
    cur = get_cursor()
    cur.execute(
        """
        SELECT ct.id, ct.file_id, ct.source_annotation_id, ct.title, f.title
        FROM chat_threads ct
        JOIN files f ON f.id = ct.file_id
        WHERE ct.source_annotation_id = ?
        LIMIT 1
        """,
        (annotation_id,),
    )
    row = cur.fetchone()
    if not row:
        return None

    return {
        "id": row[0],
        "file_id": row[1],
        "source_annotation_id": row[2],
        "title": row[3],
        "file_title": row[4],
    }


# ======================================================
# Init everything ONCE
# ======================================================

init_pages()
init_messages()
init_annotations()
init_users()
init_folders()
init_files()
migrate_add_chat_thread_id_to_messages()
init_chat_threads()
init_chat_highlights()
migrate_backfill_child_chat_threads()

def rollback():
    conn.rollback()

def commit():
    conn.commit()
