// dashboard/src/components/LogsViewer.jsx

import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Search, RefreshCw, ArrowDownCircle } from 'lucide-react';
import { dashboardApi } from '../services/api';

export default function LogsViewer({ selectedJobId, theme = 'dark' }) {
  const isLight = theme === 'light';
  const [logs, setLogs] = useState([]);
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [jobIdFilter, setJobIdFilter] = useState(selectedJobId || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(false);

  const logsEndRef = useRef(null);

  useEffect(() => {
    if (selectedJobId) {
      setJobIdFilter(selectedJobId);
    }
  }, [selectedJobId]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await dashboardApi.getLogs({
        level: levelFilter,
        jobId: jobIdFilter,
        search: searchQuery,
        limit: 100,
      });
      setLogs(data || []);
    } catch (err) {
      console.error('Failed to fetch logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [levelFilter, jobIdFilter, searchQuery]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  return (
    <div className={`border rounded-lg p-5 transition flex flex-col h-[620px] ${
      isLight
        ? 'bg-white border-slate-200 text-slate-800 light-card-shadow'
        : 'bg-[#131924] border-slate-800 text-slate-100 dark-card-shadow'
    }`}>
      
      {/* Header & Control Bar */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b shrink-0 ${
        isLight ? 'border-slate-100' : 'border-slate-800'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded flex items-center justify-center ${
            isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'
          }`}>
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h2 className={`text-sm font-medium ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
              Backup Log Inspector
            </h2>
            <p className={`text-xs font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Application & backup execution Winston log stream
            </p>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search log text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`pl-8 pr-3 py-1.5 rounded border focus:outline-none w-36 sm:w-44 ${
                isLight ? 'bg-slate-50 text-slate-800 border-slate-200' : 'bg-slate-950/60 text-slate-200 border-slate-800'
              }`}
            />
          </div>

          {/* Job ID Filter */}
          <input
            type="text"
            placeholder="Filter by Job ID..."
            value={jobIdFilter}
            onChange={(e) => setJobIdFilter(e.target.value)}
            className={`px-3 py-1.5 rounded border focus:outline-none font-mono w-36 ${
              isLight ? 'bg-slate-50 text-slate-800 border-slate-200' : 'bg-slate-950/60 text-slate-200 border-slate-800'
            }`}
          />

          {/* Log Level Filter */}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className={`px-3 py-1.5 rounded border focus:outline-none ${
              isLight ? 'bg-slate-50 text-slate-800 border-slate-200' : 'bg-slate-950/60 text-slate-300 border-slate-800'
            }`}
          >
            <option value="ALL">All Levels</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
            <option value="DEBUG">DEBUG</option>
          </select>

          {/* Auto Scroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-3 py-1.5 rounded border font-normal flex items-center gap-1.5 transition ${
              autoScroll
                ? isLight
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-800 text-slate-100 border-slate-700'
                : isLight
                ? 'bg-slate-100 text-slate-600 border-slate-200'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            <ArrowDownCircle className="w-3.5 h-3.5" />
            <span>Auto-scroll</span>
          </button>

          {/* Refresh */}
          <button
            onClick={fetchLogs}
            disabled={loading}
            className={`p-2 rounded border transition ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-slate-400' : ''}`} />
          </button>

        </div>
      </div>

      {/* Console Stream Box */}
      <div className={`mt-4 flex-1 rounded-lg p-4 font-mono text-xs overflow-y-auto space-y-2 select-text border ${
        isLight
          ? 'bg-slate-900 text-slate-200 border-slate-800'
          : 'bg-[#0B0F17] text-slate-300 border-slate-800/80'
      }`}>
        {logs.length === 0 ? (
          <div className="py-12 text-center text-slate-500 font-sans">
            <Terminal className="w-7 h-7 mx-auto mb-2 opacity-30 text-slate-400" />
            <p>No log records match current filters.</p>
          </div>
        ) : (
          logs.map((logItem) => (
            <div
              key={logItem.id}
              className="flex flex-col sm:flex-row sm:items-start gap-2 hover:bg-slate-800/40 p-1.5 rounded transition"
            >
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-slate-400">
                  {new Date(logItem.timestamp).toLocaleTimeString()}
                </span>
                <span className="px-1.5 py-0.5 text-[10px] rounded border uppercase bg-slate-800 text-slate-300 border-slate-700">
                  {logItem.level}
                </span>
              </div>
              <div className="flex-1 text-slate-200 break-all">
                <span>{logItem.message}</span>
                {logItem.details && (
                  <span className="text-slate-400 text-[11px] block mt-0.5">
                    Details: {logItem.details}
                  </span>
                )}
                {logItem.backupJobId && (
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Job: {logItem.backupJobId}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Footer Status Bar */}
      <div className={`mt-3 pt-2 text-[11px] font-mono flex justify-between items-center shrink-0 ${
        isLight ? 'text-slate-500' : 'text-slate-400'
      }`}>
        <span>Displaying latest {logs.length} log entries</span>
        {jobIdFilter && (
          <button
            onClick={() => setJobIdFilter('')}
            className="text-slate-500 hover:text-slate-300 underline font-sans"
          >
            Clear Job ID Filter
          </button>
        )}
      </div>

    </div>
  );
}
