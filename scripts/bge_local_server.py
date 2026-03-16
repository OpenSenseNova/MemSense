#!/usr/bin/env python3
import os
from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import uvicorn

MODEL_ID = os.getenv("MEMSENSE_BGE_MODEL", "BAAI/bge-large-zh-v1.5")
HOST = os.getenv("MEMSENSE_BGE_HOST", "127.0.0.1")
PORT = int(os.getenv("MEMSENSE_BGE_PORT", "8080"))

app = FastAPI(title="memsense-bge")
model = SentenceTransformer(MODEL_ID)

class EmbedReq(BaseModel):
    input: str = ""
    inputs: Optional[List[str]] = None
    model: Optional[str] = None

@app.get("/healthz")
def healthz():
    return {"ok": True, "model": MODEL_ID}

@app.post("/embed")
def embed(req: EmbedReq):
    texts = req.inputs if req.inputs else [req.input]
    if not texts:
        texts = [""]
    vecs = model.encode(texts, normalize_embeddings=True)
    return {"data": [{"embedding": vecs[0].tolist()}]}

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
