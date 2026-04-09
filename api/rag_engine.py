import os
import time
from typing import List, Dict, Optional, Any
from openai import OpenAI
from pinecone import Pinecone
from langchain_openai import OpenAIEmbeddings
import tiktoken
from dotenv import load_dotenv
from langsmith import wrappers
from langfuse.openai import OpenAI as LangfuseOpenAI
from opik.integrations.openai import track_openai

# Load env from root
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=env_path)

class RAGEngine:
    def __init__(self):
        self.openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
        self.pinecone_api_key = os.getenv("PINECONE_API_KEY")
        self.pinecone_index_name = os.getenv("PINECONE_INDEX", "rag-eval-index")
        self.base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        self.default_model = os.getenv("DEFAULT_MODEL", "openai/gpt-3.5-turbo")
        self.embedding_model = os.getenv("EMBEDDING_MODEL", "openai/text-embedding-3-small")
        
        # Initialize Pinecone
        if self.pinecone_api_key:
            self.pc = Pinecone(api_key=self.pinecone_api_key)
            self.index = self.pc.Index(self.pinecone_index_name)
        else:
            self.index = None
            
        # Initialize Clients
        self.raw_client = OpenAI(
            base_url=self.base_url,
            api_key=self.openrouter_api_key,
        )
        
        # 1. LangChain Client
        if os.getenv("LANGCHAIN_TRACING_V2") == "true":
            self.langchain_client = wrappers.wrap_openai(self.raw_client)
        else:
            self.langchain_client = self.raw_client
            
        # 2. Langfuse Client
        self.langfuse_client = LangfuseOpenAI(
            base_url=self.base_url,
            api_key=self.openrouter_api_key
        )

        # 3. Opik Client
        self.opik_client = track_openai(
            self.raw_client,
            project_name=os.getenv("OPIK_PROJECT_NAME", "eval-gated-rag")
        )
        
        # Initialize Embeddings via OpenRouter
        self.embeddings = OpenAIEmbeddings(
            model=self.embedding_model,
            openai_api_key=self.openrouter_api_key,
            base_url=self.base_url
        )
        
        # Initialize Tokenizer
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

    def retrieve(self, query: str, top_k: Optional[int] = None) -> List[str]:
        """Retrieve relevant contexts from Pinecone using real embeddings."""
        if top_k is None:
            top_k = int(os.getenv("DEFAULT_TOP_K", 5))
            
        if not self.index:
            return ["Pinecone index not initialized."]
            
        try:
            # 1. Embed query
            query_vector = self.embeddings.embed_query(query)
            
            # 2. Query Pinecone
            results = self.index.query(
                vector=query_vector, 
                top_k=top_k, 
                include_metadata=True
            )
            
            return [res['metadata']['text'] for res in results['matches']]
        except Exception as e:
            print(f"Error in retrieval: {e}")
            return [f"Error retrieving facts: {e}"]

    def calculate_citation_coverage(self, answer: str, context: List[str]) -> float:
        """Calculates percentage of context chunks cited in the answer."""
        if not context:
            return 0.0
        
        cites_found = 0
        for i, _ in enumerate(context, 1):
            # Check for various citation formats: "Context 1", "[1]", "(1)"
            if f"Context {i}" in answer or f"[{i}]" in answer or f"({i})" in answer:
                cites_found += 1
        
        return (cites_found / len(context)) * 100

    def estimate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        """Estimates cost based on OpenRouter/OpenAI pricing tiers."""
        # Prices per 1M tokens ($)
        pricing = {
            "openai/gpt-3.5-turbo": {"in": 0.50, "out": 1.50},
            "openai/gpt-4o": {"in": 5.00, "out": 15.00},
            "anthropic/claude-3-haiku": {"in": 0.25, "out": 1.25},
            "default": {"in": 1.00, "out": 2.00}
        }
        
        tier = pricing.get(model, pricing["default"])
        cost = (input_tokens * tier["in"] + output_tokens * tier["out"]) / 1_000_000
        return cost

    def generate(self, query: str, context: List[str], model: Optional[str] = None, orchestrator: str = "langchain") -> Dict[str, Any]:
        """Generate response using OpenRouter with metrics tracking."""
        if model is None:
            model = self.default_model
            
        formatted_context = "\n".join([f"[{i+1}] {c}" for i, c in enumerate(context)])
        prompt = f"System: Use the following context to answer the user query. You MUST cite your facts using the bracketed numbers like [1] or [2] whenever you use information from a context chunk.\n\nContext:\n{formatted_context}\n\nQuery: {query}\nAnswer:"
        
        start_time = time.time()
        ttft = 0
        response_text = ""
        
        # Select Client
        print(f"DEBUG: Using orchestrator: {orchestrator}")
        if orchestrator == "opik":
            active_client = self.opik_client
        elif orchestrator == "langfuse":
            active_client = self.langfuse_client
        else:
            active_client = self.langchain_client
            
        print(f"DEBUG: Selected client type: {type(active_client)}")
        
        # Stream to get TTFT
        stream = active_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            extra_headers={
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Eval-Gated RAG Demo",
            }
        )
        
        for chunk in stream:
            if ttft == 0:
                ttft = time.time() - start_time
            
            if chunk.choices[0].delta.content:
                response_text += chunk.choices[0].delta.content
                
        total_time = time.time() - start_time
        
        # Real token counting
        input_tokens = len(self.tokenizer.encode(prompt))
        output_tokens = len(self.tokenizer.encode(response_text))
        
        tps = output_tokens / (total_time - ttft) if (total_time - ttft) > 0 else 0
        citation_cov = self.calculate_citation_coverage(response_text, context)
        cost = self.estimate_cost(model, input_tokens, output_tokens)
        
        return {
            "answer": response_text,
            "ttft": ttft,
            "total_time": total_time,
            "tps": tps,
            "citation_coverage": citation_cov,
            "cost": cost,
            "tokens": input_tokens + output_tokens
        }

    def run_rag(self, query: str, model: Optional[str] = None, top_k: Optional[int] = None, orchestrator: str = "langchain") -> Dict[str, Any]:
        """Complete RAG pipeline."""
        if model is None:
            model = self.default_model
        if top_k is None:
            top_k = int(os.getenv("DEFAULT_TOP_K", 5))
            
        context = self.retrieve(query, top_k)
        result = self.generate(query, context, model, orchestrator)
        result["context"] = context
        return result
