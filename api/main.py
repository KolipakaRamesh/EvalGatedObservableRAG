import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import time
import uuid
import json

# Load environment variables
from dotenv import load_dotenv
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=env_path)

from rag_engine import RAGEngine
from eval_engine import EvalEngine
from metrics_utils import metrics_tracker
import math

# Helper to sanitize metrics (convert None/NaN to float)
def ensure_float(val: Optional[float], default: float = 0.0) -> float:
    if val is None or math.isnan(val):
        return default
    return float(val)

app = FastAPI(title="Eval-Gated Observable RAG API")

# Add CORS Middleware
# CORS Settings
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rag = RAGEngine()
eval_engine = EvalEngine()

class QueryRequest(BaseModel):
    query: str
    model: Optional[str] = None
    top_k: Optional[int] = None

class QueryResponse(BaseModel):
    answer: str
    context: List[str]
    ttft: float
    total_time: float
    tps: float
    p50: float
    p95: float
    citation_coverage: float
    cost: float
    failure_rate: float
    faithfulness: float
    relevance: float
    precision: float
    recall: float

class BenchmarkResponse(BaseModel):
    avg_faithfulness: float
    avg_relevance: float
    avg_precision: float
    avg_recall: float
    avg_p50: float
    avg_p95: float
    avg_cost: float
    failure_rate: float
    passed: bool
    num_test_cases: int
    gate_threshold: float
    details: List[Dict]

@app.get("/")
async def root():
    return {"message": "Eval-Gated Observable RAG API is running"}

@app.get("/config")
async def get_config():
    return {
        "live_model": str(os.getenv("DEFAULT_MODEL", "openai/gpt-3.5-turbo")),
        "eval_model": str(os.getenv("EVAL_MODEL", "openai/gpt-4o-mini"))
    }

@app.post("/query", response_model=QueryResponse)
async def query_rag(request: QueryRequest):
    try:
        # 1. Run RAG Inference
        result = rag.run_rag(query=request.query, model=request.model, top_k=request.top_k)
        
        # 2. Track global metrics
        metrics_tracker.add_request(latency=result["ttft"], was_success=True, cost=result["cost"])

        # 3. Get global stats
        stats = metrics_tracker.get_stats()
        
        return QueryResponse(
            answer=result["answer"],
            context=result["context"],
            ttft=ensure_float(result["ttft"]),
            total_time=ensure_float(result["total_time"]),
            tps=ensure_float(result["tps"]),
            p50=ensure_float(stats.get("p50")),
            p95=ensure_float(stats.get("p95")),
            citation_coverage=ensure_float(result["citation_coverage"]),
            cost=ensure_float(result["cost"]),
            failure_rate=ensure_float(stats.get("failure_rate")),
            faithfulness=0.0,
            relevance=0.0,
            precision=0.0,
            recall=0.0
        )
    except Exception as e:
        metrics_tracker.add_request(latency=0, was_success=False)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/benchmark", response_model=BenchmarkResponse)
async def run_benchmark():
    """Run RAGAS evaluation on the full test dataset."""
    try:
        # 1. Load test data
        test_data_path = os.path.join(os.path.dirname(__file__), 'test_data.json')
        with open(test_data_path, 'r') as f:
            test_data = json.load(f)
        
        # 2. Run Evaluation
        eval_payload = await eval_engine.run_evaluation(test_data)
        eval_results = eval_payload["results"]
        eval_stats = eval_payload["stats"]
        
        # 3. Calculate Aggregates
        threshold = 0.85
        avg_faith = sum(r.get("faithfulness", 0) for r in eval_results) / len(eval_results)
        avg_rel = sum(r.get("answer_relevancy", 0) for r in eval_results) / len(eval_results)
        avg_prec = sum(r.get("context_precision", 0) for r in eval_results) / len(eval_results)
        avg_rec = sum(r.get("context_recall", 0) for r in eval_results) / len(eval_results)
        
        passed = avg_faith >= threshold
        
        return BenchmarkResponse(
            avg_faithfulness=ensure_float(avg_faith),
            avg_relevance=ensure_float(avg_rel),
            avg_precision=ensure_float(avg_prec),
            avg_recall=ensure_float(avg_rec),
            avg_p50=ensure_float(eval_stats["p50"] * 1000), # MS
            avg_p95=ensure_float(eval_stats["p95"] * 1000), # MS
            avg_cost=ensure_float(eval_stats["total_cost"]),
            failure_rate=ensure_float(eval_stats["failure_rate"]),
            passed=passed,
            num_test_cases=len(eval_results),
            gate_threshold=threshold,
            details=eval_results
        )
    except Exception as e:
        print(f"Benchmark Failure: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Benchmark failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
