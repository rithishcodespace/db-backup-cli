// dashboard/src/components/ErrorDiagnosticsDrawer.jsx

import React, { useState } from 'react';
import { X, AlertTriangle, Terminal, HardDrive, FileText, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

export default function ErrorDiagnosticsDrawer({ job, onClose, theme = 'dark' }) {
  const isLight = theme === 'light';
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
    <div className={`fixed inset-0 z-50 overflow-hidden backdrop-blur-sm flex justify-end ${
      isLight ? 'bg-slate-900/30' : 'bg-slate-950/70'
    }`}>
      <div className={`w-full max-w-2xl border-l h-full overflow-y-auto flex flex-col shadow-2xl animate-in slide-in-from-right duration-200 ${
        isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-800 text-slate-100'
      }`}>
        
        {/* Header */}
        <div className={`p-6 border-b flex items-start justify-between sticky top-0 z-10 ${
          isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-950/60 border-slate-800'
        }`}>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-full uppercase tracking-wider ${
                  isFailed
                    ? isLight
                      ? 'bg-red-100 text-red-700 border border-red-300'
                      : 'bg-red-950 text-red-400 border border-red-800'
                    : isLight
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                }`}
              >
                {job.status}
              </span>
              <span className={`text-xs font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>ID: {job.id}</span>
            </div>
            <h2 className={`text-lg font-bold mt-2 ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
              {job.dbName} ({job.dbType?.toUpperCase()}) Execution Details
            </h2>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg border transition ${
              isLight
                ? 'text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border-slate-300'
                : 'text-slate-400 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 border-slate-700'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 flex-1">
          
          {/* Level 1: Non-IT Friendly Root Cause Summary (For Failed Jobs) */}
          {isFailed && (
            <div className={`rounded-xl p-4 border ${
              isLight ? 'bg-red-50 border-red-200' : 'bg-red-950/50 border-red-800/80'
            }`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${isLight ? 'text-red-600' : 'text-red-400'}`} />
                <div>
                  <h3 className={`text-sm font-bold ${isLight ? 'text-red-900' : 'text-red-200'}`}>
                    Operational Root Cause Explanation
                  </h3>
                  <p className={`text-xs mt-1 leading-relaxed ${isLight ? 'text-red-800' : 'text-red-300/90'}`}>
                    {job.humanError || 'The backup operation encountered an error during execution.'}
                  </p>
                  <div className={`mt-3 pt-3 border-t text-[11px] ${
                    isLight ? 'border-red-200 text-red-700' : 'border-red-900/60 text-red-400/80'
                  }`}>
                    <span className={`font-semibold ${isLight ? 'text-red-900' : 'text-red-300'}`}>Recommended Action:</span> Verify database connectivity and host permissions in CLI using <code>db-backup connect</code>.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Key Execution Metrics Grid */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl border font-mono text-xs ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800/80'
          }`}>
            <div>
              <span className={`text-[10px] uppercase font-sans ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>Database Engine</span>
              <p className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{job.dbType?.toUpperCase()}</p>
            </div>
            <div>
              <span className={`text-[10px] uppercase font-sans ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>Backup Mode</span>
              <p className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{job.backupType?.toUpperCase()}</p>
            </div>
            <div>
              <span className={`text-[10px] uppercase font-sans ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>Backup Size</span>
              <p className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{job.formattedSize || '0 B'}</p>
            </div>
            <div>
              <span className={`text-[10px] uppercase font-sans ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>Duration</span>
              <p className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                {job.durationSeconds ? `${job.durationSeconds.toFixed(1)}s` : '-'}
              </p>
            </div>
          </div>

          {/* Storage & Destination Information */}
          <div className={`p-4 rounded-xl border space-y-2 text-xs ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800/80'
          }`}>
            <h4 className={`font-bold text-xs font-sans uppercase tracking-wider ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
              Storage Destination
            </h4>
            <div className={`flex items-center gap-2 font-mono ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              <HardDrive className="w-4 h-4 text-slate-500 shrink-0" />
              <span>Target: {job.storageName || job.storageType || 'local'}</span>
            </div>
            {job.fileName && (
              <div className={`flex items-center gap-2 font-mono ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                <span>File Name: {job.fileName}</span>
              </div>
            )}
            {job.filePath && (
              <div className={`text-[11px] font-mono p-2 rounded border break-all ${
                isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}>
                {job.filePath}
              </div>
            )}
          </div>

          {/* Level 2: Expandable Technical Stack Trace & Raw Error */}
          <div className={`border rounded-xl overflow-hidden ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-950 border-slate-800'
          }`}>
            <button
              onClick={() => setShowTechnical(!showTechnical)}
              className={`w-full px-4 py-3 text-xs font-bold font-sans flex items-center justify-between transition border-b ${
                isLight
                  ? 'bg-slate-100/90 hover:bg-slate-200/90 text-slate-800 border-slate-200'
                  : 'bg-slate-900/90 hover:bg-slate-800/90 text-slate-300 border-slate-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <Terminal className={`w-4 h-4 ${isLight ? 'text-blue-600' : 'text-blue-400'}`} />
                <span>Level 2: Technical Error & Stack Trace</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>For Developers / Debugging</span>
                {showTechnical ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
            </button>

            {showTechnical && (
              <div className="p-4 text-xs font-mono space-y-4">
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Raw System Error Output:</span>
                  <button
                    onClick={handleCopyTech}
                    className={`px-2 py-1 text-[11px] rounded border flex items-center gap-1 transition ${
                      isLight
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    }`}
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className={`p-3 rounded-lg text-[11px] overflow-x-auto whitespace-pre-wrap border font-mono ${
                  isLight
                    ? 'bg-red-50 text-red-900 border-red-200'
                    : 'bg-slate-900 text-red-300 border-slate-800'
                }`}>
                  {job.error || 'No raw technical stack trace recorded.'}
                </pre>

                {job.metadata && (
                  <div>
                    <span className={`text-[11px] block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Execution Metadata JSON:</span>
                    <pre className={`p-3 rounded-lg text-[11px] overflow-x-auto border font-mono ${
                      isLight
                        ? 'bg-slate-50 text-slate-800 border-slate-200'
                        : 'bg-slate-900 text-slate-300 border-slate-800'
                    }`}>
                      {JSON.stringify(job.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className={`p-4 border-t flex items-center justify-between text-xs sticky bottom-0 ${
          isLight
            ? 'bg-slate-50/90 border-slate-200 text-slate-600'
            : 'bg-slate-950/60 border-slate-800 text-slate-400'
        }`}>
          <span>Started: {new Date(job.startedAt).toLocaleString()}</span>
          <button
            onClick={onClose}
            className={`px-4 py-1.5 rounded font-medium transition border ${
              isLight
                ? 'bg-slate-200 hover:bg-slate-300 text-slate-800 border-slate-300'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            Close Panel
          </button>
        </div>

      </div>
    </div>
  );
}

