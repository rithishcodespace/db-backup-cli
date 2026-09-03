// dashboard/src/components/Header.jsx

import React from 'react';
import { Activity, RefreshCw, Cpu, ShieldAlert, CheckCircle2, Sun, Moon } from 'lucide-react';

export default function Header({
  systemStatus,
  activeConcurrencyCount,
  maxConcurrencyLimit,
  pollingInterval,
  setPollingInterval,
  onRefresh,
  isRefreshing,
  isConnected,
  theme,
  setTheme,
}) {
  const isLight = theme === 'light';

  const getStatusBadge = () => {
    if (!isConnected) {
      return (
        <span className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-normal rounded border ${
          isLight ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-slate-800 text-slate-300 border-slate-700'
        }`}>
          <ShieldAlert className="w-3.5 h-3.5" /> Disconnected
        </span>
      );
    }
    return (
      <span className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-normal rounded border ${
        isLight ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-slate-800 text-slate-300 border-slate-700'
      }`}>
        <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" /> All Systems Operational
      </span>
    );
  };

  return (
    <header className={`border-b sticky top-0 z-30 px-4 lg:px-8 py-3 transition-colors ${
      isLight
        ? 'bg-white border-slate-200 text-slate-800 light-card-shadow'
        : 'bg-[#131924] border-slate-800 text-slate-200 dark-card-shadow'
    }`}>
      <div className="w-full flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        
        {/* Brand & Subtitle */}
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded flex items-center justify-center border transition ${
            isLight
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-slate-800 text-slate-200 border-slate-700'
          }`}>
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className={`text-sm font-medium tracking-tight ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                db-backup Monitor
              </h1>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase tracking-wider ${
                isLight
                  ? 'bg-slate-100 text-slate-600 border-slate-200'
                  : 'bg-slate-800/80 text-slate-400 border-slate-700'
              }`}>
                CLI Companion
              </span>
            </div>
            <p className={`text-xs font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Real-time background monitoring for db-backup-cli
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Status Badge */}
          {getStatusBadge()}

          {/* Concurrency Indicator */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 border rounded text-xs font-mono ${
            isLight
              ? 'bg-slate-50 border-slate-200 text-slate-700'
              : 'bg-slate-800/60 border-slate-700 text-slate-300'
          }`}>
            <Cpu className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-400 font-sans">Slots:</span>
            <span className={isLight ? 'text-slate-900 font-medium' : 'text-slate-100 font-medium'}>
              {activeConcurrencyCount} / {maxConcurrencyLimit}
            </span>
          </div>

          {/* Polling Interval Selector */}
          <div className={`flex items-center gap-1 border rounded p-1 text-xs ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/60 border-slate-700'
          }`}>
            <span className={`px-1 text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Poll:</span>
            {[5, 10, 30].map((sec) => (
              <button
                key={sec}
                onClick={() => setPollingInterval(sec * 1000)}
                className={`px-2 py-0.5 rounded font-mono text-[11px] transition ${
                  pollingInterval === sec * 1000
                    ? isLight
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-700 text-slate-100'
                    : isLight
                    ? 'text-slate-600 hover:bg-slate-200/60'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sec}s
              </button>
            ))}
            <button
              onClick={() => setPollingInterval(0)}
              className={`px-2 py-0.5 rounded font-mono text-[11px] transition ${
                pollingInterval === 0
                  ? isLight
                    ? 'bg-slate-200 text-slate-800 border border-slate-300'
                    : 'bg-slate-700 text-slate-200'
                  : isLight
                  ? 'text-slate-600 hover:bg-slate-200/60'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Off
            </button>
          </div>

          {/* Manual Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`p-1.5 border rounded transition ${
              isLight
                ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Refresh now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-slate-400' : ''}`} />
          </button>

          {/* Light / Dark Mode Toggle */}
          <button
            onClick={() => setTheme(isLight ? 'dark' : 'light')}
            className={`px-2.5 py-1 border rounded transition flex items-center gap-1.5 text-xs ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200/70 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title={`Switch to ${isLight ? 'Dark' : 'Light'} mode`}
          >
            {isLight ? (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-600" />
                <span>Dark</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-slate-300" />
                <span>Light</span>
              </>
            )}
          </button>

        </div>
      </div>
    </header>
  );
}
