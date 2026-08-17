// dashboard/src/components/ActiveBackups.jsx

import React, { useState, useEffect } from 'react';
import { Play, Clock, Database, HardDrive, Loader2 } from 'lucide-react';
import { dashboardApi } from '../services/api';

export default function ActiveBackups({ activeBackups = [], onRefresh, theme = 'dark' }) {
  const isLight = theme === 'light';
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelMessage, setCancelMessage] = useState(null);
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

  return (
    <div className={`border rounded-lg p-5 transition ${
      isLight
        ? 'bg-white border-slate-200 text-slate-800 light-card-shadow'
        : 'bg-[#131924] border-slate-800 text-slate-100 dark-card-shadow'
    }`}>
      <div className={`flex items-center justify-between pb-4 border-b ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded flex items-center justify-center ${
            isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'
          }`}>
            <Play className="w-4 h-4" />
          </div>
          <div>
            <h2 className={`text-sm font-medium ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
              Live Active Backups
            </h2>
            <p className={`text-xs font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Currently executing background backup operations
            </p>
          </div>
        </div>
        <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
          isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-800 text-slate-300 border-slate-700'
        }`}>
          {activeBackups.length} Running
        </span>
      </div>

      {cancelMessage && (
        <div
          className={`mt-4 p-3 rounded text-xs flex items-center justify-between border ${
            isLight ? 'bg-slate-100 text-slate-800 border-slate-300' : 'bg-slate-800 text-slate-200 border-slate-700'
          }`}
        >
          <span>{cancelMessage.text}</span>
          <button onClick={() => setCancelMessage(null)} className="text-slate-400 hover:text-slate-200 ml-2">
            ✕
          </button>
        </div>
      )}

      {activeBackups.length === 0 ? (
        <div className={`py-10 text-center text-sm ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          <Clock className="w-7 h-7 mx-auto mb-2 opacity-40 text-slate-400" />
          <p className={`font-normal text-sm ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
            No backups are currently running.
          </p>
          <p className={`text-xs mt-1 font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Initiate a backup via CLI to monitor execution progress in real time.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {activeBackups.map((job) => {
            const elapsed = timers[job.id] !== undefined ? timers[job.id] : job.elapsedSeconds || 0;
            const progress = job.progress;

            return (
              <div
                key={job.id}
                className={`border rounded-lg p-4 transition ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 hover:bg-slate-100/60'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  
                  {/* Info Column */}
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded flex items-center justify-center font-mono text-xs border shrink-0 mt-0.5 ${
                      isLight ? 'bg-white text-slate-700 border-slate-200' : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}>
                      <Database className="w-4 h-4 text-slate-500" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-mono rounded border uppercase ${
                          isLight ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}>
                          {job.dbType}
                        </span>
                        <span className={`font-medium text-sm ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>{job.dbName}</span>
                        <span className={`text-xs px-2 py-0.5 rounded border uppercase ${
                          isLight ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-slate-800/80 text-slate-400 border-slate-700/60'
                        }`}>
                          {job.backupType}
                        </span>
                      </div>
                      <div className={`flex items-center gap-3 mt-1 text-xs font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        <span>Job ID: {job.id.substring(0, 12)}...</span>
                        {job.storageLocationName && (
                          <span className="flex items-center gap-1">
                            <HardDrive className="w-3 h-3 text-slate-400" />
                            {job.storageLocationName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stage & Timer */}
                  <div className="flex items-center gap-4 text-right">
                    <div className="text-left sm:text-right">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-slate-400 animate-ping" />
                        <span className={`text-xs ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                          {job.stage || 'Processing'}
                        </span>
                      </div>
                      <div className={`flex items-center gap-1 mt-1 text-xs font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>Elapsed: {formatElapsed(elapsed)}</span>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Progress Bar */}
                {progress !== null && progress >= 0 ? (
                  <div className="mt-3">
                    <div className={`flex items-center justify-between text-xs font-mono mb-1 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                      <span>Progress</span>
                      <span className={isLight ? 'text-slate-700' : 'text-slate-300'}>{progress}%</span>
                    </div>
                    <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`}>
                      <div
                        className={`h-full transition-all duration-300 ${isLight ? 'bg-slate-700' : 'bg-slate-400'}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-1.5 rounded border ${
                    isLight
                      ? 'bg-slate-100 text-slate-600 border-slate-200'
                      : 'bg-slate-900/60 text-slate-400 border-slate-800'
                  }`}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    <span>Executing database export process in background worker...</span>
                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
