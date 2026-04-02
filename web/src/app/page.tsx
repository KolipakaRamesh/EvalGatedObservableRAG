"use client"
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Terminal, Cpu, ShieldCheck, Activity, Database, Globe, Layers, Zap, Info, CheckCircle2, AlertTriangle } from 'lucide-react';

const format = (val: any, dec: number = 2) => {
  if (val === null || val === undefined) return '0.' + '0'.repeat(dec);
  return Number(val).toFixed(dec);
};

const HighDensityMetric = ({ title, value, unit, status, icon: Icon, trend }: any) => (
  <div className="glass-card flex-1 p-3 flex flex-col justify-between group h-full">
    <div className="flex justify-between items-start">
      <div className="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
        {Icon && <Icon size={12} className="text-slate-500" />}
        <span className="subtle-label">{title}</span>
      </div>
      <div className={`w-2 h-2 rounded-full ring-2 ring-white ${
        status === 'good' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 
        status === 'warning' ? 'bg-amber-500 animate-pulse' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
      }`} />
    </div>
    
    <div className="mt-2 flex items-baseline gap-1.5">
      <span className="text-2xl font-bold tracking-tightest leading-none text-slate-800">{value}</span>
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{unit}</span>
    </div>
    
    {trend && (
      <div className="mt-2 text-[8px] font-bold text-emerald-600 flex items-center gap-1">
        <Zap size={8} /> {trend}
      </div>
    )}
  </div>
);

type LogEntry = {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'system';
  message: string;
  timestamp: string;
};

export default function Dashboard() {
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [config, setConfig] = useState({ live_model: '---', eval_model: '---' });
  
  // Metrics: Session (Live Inference)
  const [sessionMetrics, setSessionMetrics] = useState({ 
    ttft: 0, tps: 0, cost: 0, citation: 0, p50: 0, p95: 0, failure: 0 
  });
  
  // Metrics: Evaluation (Batch Benchmarks)
  const [evalMetrics, setEvalMetrics] = useState({
    faithfulness: 0, relevance: 0, precision: 0, recall: 0,
    p50: 0, p95: 0, cost: 0, failure: 0
  });

  const [gateStatus, setGateStatus] = useState({
    passed: false,
    avgScore: 0,
    runs: 0
  });

  const [traces, setTraces] = useState<LogEntry[]>([
    { id: '1', type: 'system', message: 'RAG OPS CONSOLE INITIALIZED', timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
  ]);

  const [audits, setAudits] = useState([
    { time: 'INIT', task: 'System', status: 'READY', color: 'blue' },
  ]);

  const traceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    fetch('http://localhost:8000/config')
      .then(r => r.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch config', err));
  }, []);

  useEffect(() => {
    if (traceRef.current) {
      traceRef.current.scrollTop = traceRef.current.scrollHeight;
    }
  }, [traces]);

  const addTrace = (message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setTraces(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), type, message, timestamp }]);
  };

  const handleRunQuery = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() || loading) return;

    setLoading(true);
    addTrace(`Querying: "${query}"`, 'system');

    try {
      const response = await fetch('http://localhost:8000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      if (!response.ok) throw new Error('API Error');
      const data = await response.json();
      
      setSessionMetrics({
        ttft: +(data.ttft * 1000).toFixed(0),
        tps: +format(data.tps, 1),
        cost: data.cost,
        citation: data.citation_coverage,
        p50: data.p50 || 0,
        p95: data.p95 || 0,
        failure: data.failure_rate || 0
      });

      if (data.faithfulness !== undefined) {
        setEvalMetrics(prev => ({
          ...prev,
          faithfulness: +format(data.faithfulness, 2),
          relevance: +format(data.relevance, 2),
          precision: +format(data.precision, 2),
          recall: +format(data.recall, 2)
        }));
      }

      addTrace(`PERF: TTFT ${ (data.ttft * 1000).toFixed(0) }ms | TPS ${format(data.tps, 1)}`, 'success');
      addTrace(`EVAL: ${format(data.faithfulness, 2)} Faithfulness | ${format(data.relevance, 2)} Relevancy`, 'success');
      
    } catch (err) {
      addTrace('Inference failed. Check backend connection.', 'error');
    } finally {
      setLoading(false);
      setQuery('');
    }
  };

  const handleRunBenchmark = async () => {
    if (benchmarking) return;
    setBenchmarking(true);
    addTrace('BATCH BENCHMARK TRIGGERED...', 'system');

    try {
      const response = await fetch('http://localhost:8000/benchmark', { method: 'POST' });
      const data = await response.json();
      
      setEvalMetrics({
        faithfulness: +format(data.avg_faithfulness, 2),
        relevance: +format(data.avg_relevance, 2),
        precision: +format(data.avg_precision, 2),
        recall: +format(data.avg_recall, 2),
        p50: +format(data.avg_p50, 0),
        p95: +format(data.avg_p95, 0),
        cost: data.avg_cost,
        failure: data.failure_rate,
      });

      setGateStatus({
        passed: data.passed,
        avgScore: data.avg_faithfulness,
        runs: gateStatus.runs + 1
      });

      const entry = {
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        task: 'Benchmark',
        status: data.passed ? 'PASS' : 'BLOCKED',
        color: data.passed ? 'emerald' : 'red'
      };
      setAudits(prev => [entry, ...prev].slice(0, 5));
      addTrace(`GATE STATUS: ${data.passed ? 'VERIFIED ✓' : 'BLOCKED ✗'}`, data.passed ? 'success' : 'error');

    } catch (err) {
      addTrace('Benchmark failed.', 'error');
    } finally {
      setBenchmarking(false);
    }
  };

  const handlePromote = () => {
    if (!gateStatus.passed) {
        addTrace('DEPLOYMENT REFUSED: Gate blocked.', 'error');
        return;
    }
    addTrace('CONFIG PROMOTED TO STAGING.', 'success');
    alert("Build promoted!");
  };

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 flex flex-col h-full w-full p-0 gap-0 overflow-hidden bg-[#020617]">
      
      {/* Main Grid Layout */}
      <main className="flex-1 grid grid-cols-12 gap-1 min-h-0">
        
        {/* Left Side: Stats & Metrics */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-1 overflow-hidden">
          
          {/* Top Metric Rows */}
          <div className="flex flex-col gap-1 shrink-0">
            
            {/* Live Performance Group */}
            <div className="glass-card group-live p-1.5 flex flex-col">
              <div className="flex justify-between items-center mb-2 px-3 pt-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center shadow-md">
                    <Layers className="text-white" size={12} />
                  </div>
                  <h1 className="text-xs font-bold text-slate-800 tracking-tightest">RAG Ops: Session Inference [Live]</h1>
                </div>
                <div className="flex items-center gap-2">
                  <span className="status-pill bg-blue-50 text-blue-600 border border-blue-100">
                    { (config?.live_model || '---').split('/').pop() }
                  </span>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                </div>
              </div>
              <div className="flex gap-2 overflow-hidden px-2 pb-2 h-20">
                <HighDensityMetric title="TTFT" value={sessionMetrics.ttft || '--'} unit="ms" status={sessionMetrics.ttft > 200 ? 'warning' : 'good'} icon={Cpu} />
                <HighDensityMetric title="Throughput" value={sessionMetrics.tps || '--'} unit="tps" status="good" icon={Activity} />
                <HighDensityMetric title="Cost/Req" value={sessionMetrics.cost !== undefined ? `$${format(sessionMetrics.cost, 4)}` : '0.00' } unit="usd" icon={Activity} />
                <HighDensityMetric title="Global p95" value={format(sessionMetrics.p95 || 0, 0)} unit="ms" status="good" icon={Activity} />
              </div>
            </div>

            {/* Quality Evaluation Group */}
            <div className="glass-card group-eval p-1.5 flex flex-col">
              <div className="flex justify-between items-center mb-2 px-3 pt-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={12} className="text-emerald-600" />
                  <h2 className="text-[9px] font-bold text-emerald-800 uppercase tracking-widest">Quality Benchmarking [Batch]</h2>
                </div>
                <span className="status-pill bg-emerald-50 text-emerald-600 border border-emerald-100">
                  { (config?.eval_model || '---').split('/').pop() }
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 px-2 h-20">
                <HighDensityMetric title="Faithful" value={format(evalMetrics.faithfulness, 2)} unit="rag" status="good" icon={ShieldCheck} />
                <HighDensityMetric title="Relevance" value={format(evalMetrics.relevance, 2)} unit="rag" status="good" icon={Terminal} />
                <HighDensityMetric title="p95 Latency" value={evalMetrics.p95 || '--'} unit="ms" status="warning" icon={Activity} />
                <HighDensityMetric title="Failure Rate" value={format(evalMetrics.failure, 1)} unit="%" status={evalMetrics.failure > 5 ? 'error' : 'good'} icon={ShieldCheck} />
              </div>
            </div>
          </div>

          {/* Large Console Window */}
          <div className="flex-1 console-bg flex flex-col overflow-hidden relative group">
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-blue-400" />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Live Inference Trace Log</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-tighter">
                  <div className={`w-2 h-2 rounded-full ${loading ? 'bg-blue-500 animate-ping' : 'bg-slate-700'}`} />
                  {loading ? 'Processing Stream' : 'Ready'}
                </span>
                <Info size={14} className="text-slate-600 hover:text-slate-400 cursor-help transition-colors" />
              </div>
            </div>
            
            <div ref={traceRef} className="flex-1 overflow-y-auto p-6 space-y-3 no-scrollbar console-text">
              <AnimatePresence initial={false}>
                {traces.map((log) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    key={log.id} 
                    className="flex gap-4 group/item"
                  >
                    <span className="text-slate-600 shrink-0 select-none opacity-50 font-mono">[{log.timestamp}]</span>
                    <span className={`
                      flex-1 leading-relaxed
                      ${log.type === 'success' ? 'text-emerald-400' : ''}
                      ${log.type === 'error' ? 'text-rose-500 font-bold' : ''}
                      ${log.type === 'system' ? 'text-blue-400' : ''}
                      ${log.type === 'info' ? 'text-slate-300' : ''}
                    `}>
                      <span className="opacity-60 mr-2">❯</span>
                      {log.message}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {loading && (
                <div className="flex gap-2">
                  <span className="text-blue-500 animate-pulse">▋</span>
                  <span className="text-slate-500 italic">Capturing evaluation signals...</span>
                </div>
              )}
            </div>
            
            {/* Command Bar Hooked to Bottom of Console */}
            <div className="px-3 py-2 bg-slate-900/50 border-t border-slate-800 shrink-0">
              <form onSubmit={handleRunQuery} className="relative">
                <input 
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Enter evaluation query..."
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pr-24 pl-10 py-2 text-[10px] text-white focus:outline-none focus:border-blue-500 transition-all font-mono"
                />
                <Cpu size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <button 
                  type="submit"
                  disabled={loading || !query.trim()}
                  className={`absolute right-1 top-1 bottom-1 px-4 rounded-md flex items-center gap-2 text-[8px] font-bold uppercase tracking-widest transition-all ${
                    loading || !query.trim() 
                      ? "bg-slate-800 text-slate-500" 
                      : "bg-blue-600 text-white hover:bg-blue-500"
                  }`}
                >
                  <Send size={10} />
                  Run
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Right Side: Deployment Controls */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-1 overflow-hidden">
          
          {/* Gating Logic Card */}
          <div className="glass-card p-3 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={14} className="text-slate-500" />
              <h2 className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">Automated Deployment Gate</h2>
            </div>
            
            <div className="space-y-2 mb-4">
              <div className="p-3 bg-slate-50/50 rounded-xl border border-slate-100/50">
                <div className="flex justify-between items-center mb-2">
                  <span className="subtle-label">Production Threshold</span>
                  <span className="text-[10px] font-bold text-slate-900">0.85</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-slate-400 w-[85%]" />
                </div>
              </div>

              <div className="p-3 bg-blue-50/30 rounded-xl border border-blue-100/50">
                <div className="flex justify-between items-center mb-2">
                  <span className="subtle-label">Last Benchmark Mean</span>
                  <span className={`text-[12px] font-bold ${gateStatus.passed ? 'text-emerald-600' : 'text-blue-600'}`}>
                    {format(gateStatus.avgScore, 2)}
                  </span>
                </div>
                <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }} 
                    animate={{ width: `${(gateStatus.avgScore || 0) * 100}%` }} 
                    className={`h-full ${gateStatus.passed ? 'bg-emerald-500' : 'bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.4)]'}`} 
                  />
                </div>
              </div>
            </div>

              <div className="flex-1 overflow-y-auto no-scrollbar pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Activity size={12} className="text-slate-400" />
                    <h3 className="subtle-label">Continuous Audit Logs</h3>
                </div>
                <div className={`px-2 py-0.5 rounded text-[8px] font-bold border ${
                    gateStatus.passed ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-blue-50 text-blue-600 border-blue-100'
                }`}>
                    {gateStatus.passed ? 'VERIFIED' : 'PENDING'}
                </div>
              </div>
              <div className="space-y-3">
                {audits.map((item, i) => (
                  <div key={i} className="flex justify-between items-center p-2 rounded-lg hover:bg-slate-50 transition-colors cursor-default">
                    <span className="text-[9px] font-mono text-slate-400">{item.time}</span>
                    <span className="text-[10px] font-bold text-slate-600">{item.task}</span>
                    <div className="flex items-center gap-1.5">
                      {item.status === 'PASS' ? <CheckCircle2 size={10} className="text-emerald-500" /> : <AlertTriangle size={10} className="text-rose-500" />}
                      <span className={`font-bold text-[8px] uppercase tracking-widest ${item.status === 'PASS' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <button 
                onClick={handleRunBenchmark}
                disabled={benchmarking}
                className={`py-3.5 px-6 font-bold text-[10px] uppercase tracking-widest rounded-xl transition-all border shadow-sm flex items-center justify-center gap-2 ${
                    benchmarking 
                    ? 'bg-slate-50 text-slate-400 border-slate-100' 
                    : 'bg-white text-blue-600 border-blue-200 hover:border-blue-500 hover:bg-blue-50/30'
                }`}
              >
                {benchmarking ? <Activity size={12} className="animate-spin text-blue-300" /> : <Cpu size={12} />}
                {benchmarking ? 'Finalizing Evaluation...' : 'Initiate Benchmark'}
              </button>
              
              <button 
                onClick={handlePromote}
                className={`py-3.5 px-6 text-white font-bold text-[10px] uppercase tracking-widest rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 ${
                    gateStatus.passed 
                    ? 'bg-slate-900 hover:bg-emerald-600 hover:shadow-emerald-200' 
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Zap size={12} className={gateStatus.passed ? 'text-emerald-400' : 'text-slate-300'} />
                Promote Verified Build
              </button>
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}
