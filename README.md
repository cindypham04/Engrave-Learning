# Tutoring AI Chatbot

An AI tutoring app that lets users upload PDFs, ask questions, and store chats/annotations tied to document pages and regions.

## Features
- Upload PDFs and extract per-page text for context.
- Create annotations and region highlights tied to files.
- Chat threads per file or annotation, powered by OpenAI.
- S3-backed storage for PDFs and region images.

## Demo
- Video: https://youtu.be/jSPLiHsQnW8
- Screenshots:
  - ![Screenshot 1](Screenshot%202026-01-21%20at%209.09.57%E2%80%AFPM.png)
  - ![Screenshot 2](Screenshot%202026-01-21%20at%209.09.34%E2%80%AFPM.png)

## Tech stack
- Backend: FastAPI, SQLite, PyMuPDF, OpenAI SDK, boto3
- Frontend: Next.js (React), Tailwind, react-pdf, KaTeX

## Setup
### Backend
```bash
python -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements.txt
```

Create a `.env` file in `backend/`:
```bash
OPENAI_API_KEY=your_openai_key
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your_bucket_name
```

Run the API:
```bash
uvicorn backend.main:app --reload
```

### Frontend
```bash
cd frontend/my-app
npm install
npm run dev
```

## Development URLs
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Health check: `http://localhost:8000/health`

## Notes
- The backend uses a local SQLite database at `backend/data.db`.
- File uploads and region images are stored in S3; the app expects valid AWS credentials.
