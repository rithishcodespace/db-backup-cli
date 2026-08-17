// dashboard/src/components/ErrorDiagnosticsDrawer.jsx

import React, { useState } from 'react';
import { X, AlertTriangle, Terminal, Code, Database, Clock, HardDrive, FileText, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

export default function ErrorDiagnosticsDrawer({ job, onClose }) {
  const [showTechnical, setShowTechnical] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!job) return null;

  const isFailed = job.status?.toUpperCase() === 'FAILED';

  const handleCopyTech = () => {
    const textToCopy = `Job ID: ${job.id}\nEngine: ${job.dbType}/${job.dbName}\nStatus: ${job.status}\nError: ${job.error || 'N/A'}\nMetadata: ${JSON.stringify(job.metadata || {}, null, 2)}`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full overflow-y-auto flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-start justify-between bg-slate-950/60 sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-full uppercase tracking-wider ${
                  isFailed
                    ? 'bg-red-950 text-red-400 border border-red-800'
                    : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                }`}
              >
                {job.status}
              </span>
              <span className="text-xs font-mono text-slate-400">ID: {job.id}</span>
            </div>
            <h2 className="text-lg font-bold text-slate-100 mt-2">
              {job.dbName} ({job.dbType?.toUpperCase()}) Execution Details
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 flex-1">
          
          {/* Level 1: Non-IT Friendly Root Cause Summary (For Failed Jobs) */}
          {isFailed && (
            <div className="bg-red-950/50 border border-red-800/80 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-red-200">Operational Root Cause Explanation</h3>
                  <p className="text-xs text-red-300/90 mt-1 leading-relaxed">
                    {job.humanError || 'The backup operation encountered an error during execution.'}
                  </p>
                  <div className="mt-3 pt-3 border-t border-red-900/60 text-[11px] text-red-400/80">
                    <span className="font-semibold text-red-300">Recommended Action:</span> Verify database connectivity and host permissions in CLI using <code>db-backup connect</code>.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Key Execution Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 font-mono text-xs">
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-sans">Database Engine</span>
              <p className="font-bold text-slate-200 mt-0.5">{job.dbType?.toUpperCase()}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-sans">Backup Mode</span>
              <p className="font-bold text-slate-200 mt-0.5">{job.backupType?.toUpperCase()}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-sans">Backup Size</span>
              <p className="font-bold text-slate-200 mt-0.5">{job.formattedSize || '0 B'}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-sans">Duration</span>
              <p className="font-bold text-slate-200 mt-0.5">
                {job.durationSeconds ? `${job.durationSeconds.toFixed(1)}s` : '-'}
              </p>
            </div>
          </div>

          {/* Storage & Destination Information */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-2 text-xs">
            <h4 className="font-bold text-slate-300 text-xs font-sans uppercase tracking-wider">Storage Destination</h4>
            <div className="flex items-center gap-2 text-slate-400 font-mono">
              <HardDrive className="w-4 h-4 text-slate-500 shrink-0" />
              <span>Target: {job.storageName || job.storageType || 'local'}</span>
            </div>
            {job.fileName && (
              <div className="flex items-center gap-2 text-slate-400 font-mono">
                <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                <span>File Name: {job.fileName}</span>
              </div>
            )}
            {job.filePath && (
              <div className="text-[11px] font-mono text-slate-400 bg-slate-900 p-2 rounded border border-slate-800 break-all">
                {job.filePath}
              </div>
            )}
          </div>

          {/* Level 2: Expandable Technical Stack Trace & Raw Error */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowTechnical(!showTechnical)}
              className="w-full px-4 py-3 bg-slate-900/90 hover:bg-slate-800/90 text-slate-300 text-xs font-bold font-sans flex items-center justify-between transition border-b border-slate-800"
            >
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-400" />
                <span>Level 2: Technical Error & Stack Trace</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 font-normal">For Developers / Debugging</span>
                {showTechnical ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
            </button>

            {showTechnical && (
              <div className="p-4 text-xs font-mono space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Raw System Error Output:</span>
                  <button
                    onClick={handleCopyTech}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded border border-slate-700 flex items-center gap-1 transition"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="bg-slate-900 p-3 rounded-lg text-red-300 text-[11px] overflow-x-auto whitespace-pre-wrap border border-slate-800">
                  {job.error || 'No raw technical stack trace recorded.'}
                </pre>

                {job.metadata && (
                  <div>
                    <span className="text-slate-400 text-[11px] block mb-1">Execution Metadata JSON:</span>
                    <pre className="bg-slate-900 p-3 rounded-lg text-slate-300 text-[11px] overflow-x-auto border border-slate-800">
                      {JSON.stringify(job.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400 sticky bottom-0">
          <span>Started: {new Date(job.startedAt).toLocaleString()}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition border border-slate-700"
          >
            Close Panel
          </button>
        </div>

      </div>
    </div>
  );
}
