// dashboard/src/components/ActiveBackups.jsx

import React, { useState, useEffect } from 'react';
import { Play, Clock, Database, HardDrive, Loader2, CheckCircle2, ShieldCheck, Zap, Activity, Radio, Sparkles } from 'lucide-react';

const PIPELINE_STAGES = [
  { id: 'queued', label: 'Queued', minProgress: 0 },
  { id: 'connecting', label: 'Connecting', minProgress: 15 },
  { id: 'dumping', label: 'Dumping DB', minProgress: 35 },
  { id: 'compressing', label: 'Compressing', minProgress: 65 },
  { id: 'uploading', label: 'Writing Storage', minProgress: 85 },
  { id: 'finalizing', label: 'Finalizing', minProgress: 95 },
];

export default function ActiveBackups({ activeBackups = [], onRefresh, theme = 'dark', onTriggerQuickBackup }) {
  const isLight = theme === 'light';
  const [timers, setTimers] = useState({});

  useEffect(() => {
    const interval = setInterval(() => {
      setTimers((prev) => {
        const next = { ...prev };
        activeBackups.forEach((b) => {
          const startedAtMs = new Date(b.startedAt).getTime();
          const nowMs = Date.now();
          next[b.id] = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeBackups]);

  const formatElapsed = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const getDbBadgeStyle = (type) => {
    const t = (type || '').toLowerCase();
    switch (t) {
      case 'postgresql':
      case 'postgres':
        return isLight ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'mysql':
        return isLight ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-sky-500/10 text-sky-400 border-sky-500/30';
      case 'mongodb':
        return isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      default:
        return isLight ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
    }
  };

  return (
    <div className={`border rounded-lg p-5 transition ${
      isLight
        ? 'bg-white border-slate-200 text-slate-800 light-card-shadow'
        : 'bg-[#131924] border-slate-800 text-slate-100 dark-card-shadow'
    }`}>
      
      {/* Top Header Bar */}
      <div className={`flex items-center justify-between pb-4 border-b ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
        <div className="flex items-center gap-3">
          <div className={`relative w-8 h-8 rounded flex items-center justify-center border ${
            activeBackups.length > 0
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
              : isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-800 text-slate-300 border-slate-700'
          }`}>
            {activeBackups.length > 0 ? (
              <Radio className="w-4 h-4 text-blue-400 animate-pulse" />
            ) : (
              <Play className="w-4 h-4 text-slate-400" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className={`text-sm font-medium ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                Live Active Backups
              </h2>
              {activeBackups.length > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-medium rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  <Activity className="w-3 h-3 animate-pulse" /> Telemetry Streaming
                </span>
              )}
            </div>
            <p className={`text-xs font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Currently executing background backup operations and worker pipeline state
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono px-2.5 py-1 rounded border font-normal flex items-center gap-1.5 ${
            activeBackups.length > 0
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
              : isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-800 text-slate-300 border-slate-700'
          }`}>
            <span className={`w-2 h-2 rounded-full ${activeBackups.length > 0 ? 'bg-blue-400 animate-ping' : 'bg-slate-400'}`} />
            {activeBackups.length} Running
          </span>
        </div>
      </div>

      {/* Empty State */}
      {activeBackups.length === 0 ? (
        <div className={`py-10 text-center text-sm ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          <Clock className="w-7 h-7 mx-auto mb-2 opacity-40 text-slate-400" />
          <p className={`font-normal text-sm ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
            No backups are currently running.
          </p>
          <p className={`text-xs mt-1 font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Initiate a backup via CLI or Quick Backup to monitor execution progress in real time.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {activeBackups.map((job) => {
            const elapsed = timers[job.id] !== undefined ? timers[job.id] : job.elapsedSeconds || 0;
            const rawProgress = job.progress !== null && job.progress !== undefined ? job.progress : 30;
            const isCompleted = job.status?.toLowerCase() === 'success' || rawProgress >= 100;
            const progress = isCompleted ? 100 : rawProgress;

            // Calculate active stage index
            let currentStageIdx = 0;
            if (isCompleted || progress >= 100) currentStageIdx = 5;
            else if (progress >= 85) currentStageIdx = 4;
            else if (progress >= 65) currentStageIdx = 3;
            else if (progress >= 35) currentStageIdx = 2;
            else if (progress >= 15) currentStageIdx = 1;

            return (
              <div
                key={job.id}
                className={`border rounded-lg p-4 transition ${
                  isLight
                    ? 'bg-slate-50 border-slate-200'
                    : 'bg-[#0F141E] border-slate-800'
                }`}
              >
                {/* Main Job Metadata Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  
                  {/* Left Column */}
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded flex items-center justify-center font-mono text-xs border shrink-0 mt-0.5 ${getDbBadgeStyle(job.dbType)}`}>
                      <Database className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-mono rounded border uppercase ${getDbBadgeStyle(job.dbType)}`}>
                          {job.dbType}
                        </span>
                        <span className={`font-medium text-sm ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                          {job.dbName}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded border uppercase ${
                          isLight ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {job.backupType || 'full'}
                        </span>
                      </div>

                      <div className={`flex flex-wrap items-center gap-3 mt-1.5 text-xs font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        <span>Job ID: {job.id.substring(0, 10)}...</span>
                        {job.storageLocationName && (
                          <span className="flex items-center gap-1">
                            <HardDrive className="w-3 h-3 text-slate-400" />
                            {job.storageLocationName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Stage & Timer */}
                  <div className="flex items-center gap-4 text-right justify-between sm:justify-end">
                    <div className="text-left sm:text-right">
                      <div className="flex items-center gap-2">
                        {isCompleted ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Completed
                          </span>
                        ) : (
                          <>
                            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                            <span className={`text-xs ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                              {job.stage || PIPELINE_STAGES[currentStageIdx].label}
                            </span>
                          </>
                        )}
                      </div>
                      <div className={`flex items-center gap-1 mt-1 text-xs font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>Elapsed: {formatElapsed(elapsed)}</span>
                      </div>
                    </div>
                  </div>

                </div>

                {/* PIPELINE STEPPER STAGES */}
                <div className="mt-4 pt-3 border-t border-slate-800/60">
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    {PIPELINE_STAGES.map((stg, idx) => {
                      const isPassed = isCompleted || idx < currentStageIdx;
                      const isCurrent = !isCompleted && idx === currentStageIdx;
                      
                      return (
                        <div
                          key={stg.id}
                          className={`flex items-center gap-1.5 p-1.5 px-2 rounded border text-[11px] font-mono transition ${
                            isCurrent
                              ? isLight
                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                : 'bg-blue-500/10 border-blue-500/40 text-blue-300'
                              : isPassed
                              ? isLight
                                ? 'bg-slate-100 border-slate-200 text-slate-700'
                                : 'bg-slate-900 border-slate-800 text-slate-300'
                              : isLight
                              ? 'bg-slate-50 border-slate-100 text-slate-400 opacity-50'
                              : 'bg-slate-950/40 border-slate-900 text-slate-600 opacity-40'
                          }`}
                        >
                          {isPassed ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                          ) : isCurrent ? (
                            <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />
                          ) : (
                            <span className="w-3 h-3 rounded-full border border-slate-600 shrink-0 flex items-center justify-center text-[8px]">
                              {idx + 1}
                            </span>
                          )}
                          <span className="truncate">{stg.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* PROGRESS BAR */}
                <div className="mt-3">
                  <div className={`flex items-center justify-between text-xs font-mono mb-1 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                    <span>Progress</span>
                    <span className={isCompleted ? 'text-emerald-400 font-bold' : isLight ? 'text-slate-700' : 'text-slate-300'}>
                      {progress}% {isCompleted && '✓ Completed'}
                    </span>
                  </div>
                  
                  <div className={`w-full h-2 rounded-full overflow-hidden ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`}>
                    <div
                      className={`h-full transition-all duration-500 ${
                        isCompleted
                          ? 'bg-emerald-500'
                          : isLight ? 'bg-blue-600' : 'bg-blue-500'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
