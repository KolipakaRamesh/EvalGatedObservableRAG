import numpy as np
from typing import List, Dict, Any

class GlobalMetricsTracker:
    def __init__(self):
        self.latencies: List[float] = []
        self.success_count: int = 0
        self.failure_count: int = 0
        self.total_cost: float = 0.0

    def add_request(self, latency: float, was_success: bool, cost: float = 0.0):
        if was_success:
            self.latencies.append(latency)
            self.success_count += 1
            self.total_cost += cost
        else:
            self.failure_count += 1

    def get_p50(self) -> float:
        if not self.latencies:
            return 0.0
        return float(np.percentile(self.latencies, 50))

    def get_p95(self) -> float:
        if not self.latencies:
            return 0.0
        return float(np.percentile(self.latencies, 95))

    def get_failure_rate(self) -> float:
        total = self.success_count + self.failure_count
        if total == 0:
            return 0.0
        return (self.failure_count / total) * 100

    def get_stats(self) -> Dict[str, Any]:
        return {
            "p50": self.get_p50(),
            "p95": self.get_p95(),
            "failure_rate": self.get_failure_rate(),
            "total_cost": self.total_cost
        }

# Global singleton instance
metrics_tracker = GlobalMetricsTracker()
