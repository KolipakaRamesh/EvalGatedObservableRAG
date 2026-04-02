import os
import time
from typing import List
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import CharacterTextSplitter
from pinecone import Pinecone
from dotenv import load_dotenv

# Load env
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=env_path)

def ingest():
    print("Starting ingestion pipeline...")
    
    # 1. Load data
    kb_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'sample_kb.txt')
    with open(kb_path, 'r') as f:
        text = f.read()
    
    # 2. Chunk data
    text_splitter = CharacterTextSplitter(
        separator="\n\n",
        chunk_size=500,
        chunk_overlap=50,
        length_function=len,
    )
    chunks = text_splitter.split_text(text)
    print(f"Split knowledge base into {len(chunks)} chunks.")
    
    # 3. Initialize OpenAI & Pinecone (via OpenRouter)
    embeddings = OpenAIEmbeddings(
        model=os.getenv("EMBEDDING_MODEL", "openai/text-embedding-3-small"),
        openai_api_key=os.getenv("OPENROUTER_API_KEY"),
        base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    )
    
    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    index_name = os.getenv("PINECONE_INDEX", "evalgatedrag")
    index = pc.Index(index_name)
    
    # 4. Generate & Upsert
    vectors = []
    print("Generating embeddings and preparing vectors...")
    for i, chunk in enumerate(chunks):
        embedding = embeddings.embed_query(chunk)
        vectors.append({
            "id": f"chunk_{i}",
            "values": embedding,
            "metadata": {"text": chunk}
        })
    
    print(f"Upserting {len(vectors)} vectors to Pinecone...")
    index.upsert(vectors=vectors)
    print("Ingestion complete!")

if __name__ == "__main__":
    ingest()
