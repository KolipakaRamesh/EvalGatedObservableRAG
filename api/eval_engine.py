import os
import asyncio
from typing import List, Dict, Any
from datasets import Dataset
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall,
)
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from rag_engine import RAGEngine
from metrics_utils import GlobalMetricsTracker
from dotenv import load_dotenv
# Load environment variables
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=env_path)

class EvalEngine:
    def __init__(self):
        self.rag = RAGEngine()
        self.openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
        self.base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        self.eval_model = os.getenv("EVAL_MODEL", "openai/gpt-4o-mini")
        self.embedding_model = os.getenv("EMBEDDING_MODEL", "openai/text-embedding-3-small")
        
        # Initialize LLM for RAGAS evaluation
        self.eval_llm = ChatOpenAI(
            model=self.eval_model,
            openai_api_key=self.openrouter_api_key,
            base_url=self.base_url
        )
        # Initialize Embeddings for RAGAS evaluation
        self.eval_embeddings = OpenAIEmbeddings(
            model=self.embedding_model,
            openai_api_key=self.openrouter_api_key,
            base_url=self.base_url
        )

    async def run_evaluation(self, test_data: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        Runs RAGAS evaluation on a set of test queries.
        test_data format: [{"question": "...", "ground_truth": "..."}]
        """
        questions = [item["question"] for item in test_data]
        ground_truths = [item["ground_truth"] for item in test_data]
        
        answers = []
        contexts = []
        batch_tracker = GlobalMetricsTracker()
        
        for q in questions:
            try:
                result = self.rag.run_rag(q)
                answers.append(result["answer"])
                contexts.append(result["context"])
                batch_tracker.add_request(result["ttft"], True, result["cost"])
            except Exception as e:
                print(f"Benchmark query failed: {e}")
                answers.append("")
                contexts.append([])
                batch_tracker.add_request(0.0, False)
            
        # Convert to RAGAS dataset format
        data = {
            "question": questions,
            "answer": answers,
            "contexts": contexts,
            "ground_truth": ground_truths
        }
        
        dataset = Dataset.from_dict(data)
        
        # Run evaluation
        result = evaluate(
            dataset,
            metrics=[
                faithfulness,
                answer_relevancy,
                context_precision,
            ],
            llm=self.eval_llm,
            embeddings=self.eval_embeddings
        )
        
        # Combine RAGAS results with performance stats
        eval_dict = result.to_pandas().to_dict(orient="records")
        return {
            "results": eval_dict,
            "stats": batch_tracker.get_stats()
        }

    def check_gate(self, eval_results: List[Dict[str, Any]], thresholds: Dict[str, float]) -> Dict[str, Any]:
        """
        Checks if the evaluation results pass the deployment thresholds.
        """
        summary = {
            "passed": True,
            "failures": [],
            "avg_scores": {}
        }
        
        # Calculate averages
        for metric in thresholds.keys():
            avg_score = sum(r[metric] for r in eval_results) / len(eval_results)
            summary["avg_scores"][metric] = avg_score
            
            if avg_score < thresholds[metric]:
                summary["passed"] = False
                summary["failures"].append(f"{metric} score {avg_score:.2f} is below threshold {thresholds[metric]:.2f}")
                
        return summary

if __name__ == "__main__":
    # Simple test run
    engine = EvalEngine()
    test_queries = [
        {"question": "What is the capital of France?", "ground_truth": "The capital of France is Paris."},
    ]
    # In a real scenario, this would be an async call
    # results = asyncio.run(engine.run_evaluation(test_queries))
    # print(results)
