// dashboard/src/components/MetricCards.jsx

import React from 'react';
import { Cpu, Layers, CheckCircle, AlertTriangle } from 'lucide-react';

export default function MetricCards({ summary, theme = 'dark' }) {
  const isLight = theme === 'light';
  if (!summary) return null;

  const {
    activeConcurrencyCount = 0,
    maxConcurrencyLimit = 3,
    activeBackupsCount = 0,
    queueStats = { backupQueue: { waiting: 0, active: 0, failed: 0 } },
    successRate24h = 100,
    totalBackups24h = 0,
    failedBackups24h = 0,
    alertsCount = 0,
  } = summary;

  const waitingCount = queueStats.backupQueue?.waiting || 0;
  const activeQueueCount = queueStats.backupQueue?.active || 0;

  const cardBase = `p-4 rounded-lg border transition ${
    isLight
      ? 'bg-white border-slate-200 text-slate-800 light-card-shadow'
      : 'bg-[#131924] border-slate-800/80 text-slate-100'
  }`;

  const labelText = isLight ? 'text-slate-500 font-normal' : 'text-slate-400 font-normal';
  const subText = isLight ? 'text-slate-500 font-normal' : 'text-slate-400';
  const divider = isLight ? 'border-slate-100' : 'border-slate-800/80';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      
      {/* 1. Concurrency Load */}
      <div className={cardBase}>
        <div className="flex items-center justify-between">
          <span className={`text-xs uppercase tracking-wider ${labelText}`}>Concurrency Load</span>
          <div className={`w-8 h-8 rounded flex items-center justify-center ${
            isLight ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'
          }`}>
            <Cpu className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-light font-mono ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
              {activeConcurrencyCount}
            </span>
            <span className={`text-xs font-mono ${subText}`}>/ {maxConcurrencyLimit} slots active</span>
          </div>
          <div className={`w-full h-1.5 rounded-full mt-2.5 overflow-hidden ${isLight ? 'bg-slate-100' : 'bg-slate-800'}`}>
            <div
              className={`h-full transition-all duration-300 ${
                activeConcurrencyCount >= maxConcurrencyLimit
                  ? 'bg-slate-500'
                  : activeConcurrencyCount > 0
                  ? isLight ? 'bg-slate-800' : 'bg-slate-400'
                  : 'bg-slate-700'
              }`}
              style={{ width: `${Math.min(100, (activeConcurrencyCount / maxConcurrencyLimit) * 100)}%` }}
            />
          </div>
        </div>
        <div className={`mt-3 pt-2 border-t ${divider} flex items-center justify-between text-xs ${subText}`}>
          <span>Active running: <strong className={isLight ? 'text-slate-800 font-medium' : 'text-slate-200'}>{activeBackupsCount}</strong></span>
          <span>Max: <strong className={isLight ? 'text-slate-800 font-medium' : 'text-slate-200'}>{maxConcurrencyLimit}</strong></span>
        </div>
      </div>

      {/* 2. Queue Saturation */}
      <div className={cardBase}>
        <div className="flex items-center justify-between">
          <span className={`text-xs uppercase tracking-wider ${labelText}`}>Queue Saturation</span>
          <div className={`w-8 h-8 rounded flex items-center justify-center ${
            isLight ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'
          }`}>
            <Layers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-light font-mono ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
              {waitingCount}
            </span>
            <span className={`text-xs ${subText}`}>waiting in queue</span>
          </div>
          <div className="flex items-center gap-2 mt-2 font-mono text-xs">
            <span className={`px-2 py-0.5 rounded border ${
              isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}>
              Active: {activeQueueCount}
            </span>
            <span className={`px-2 py-0.5 rounded border ${
              isLight ? 'bg-slate-50 text-slate-600 border-slate-200' : 'bg-slate-800/60 text-slate-400 border-slate-700/60'
            }`}>
              Waiting: {waitingCount}
            </span>
          </div>
        </div>
        <div className={`mt-3 pt-2 border-t ${divider} text-xs ${subText} flex justify-between`}>
          <span>Storage: <strong className={isLight ? 'text-slate-800 font-medium' : 'text-slate-200'}>{queueStats.storageQueue?.waiting || 0}</strong></span>
          <span>Notify: <strong className={isLight ? 'text-slate-800 font-medium' : 'text-slate-200'}>{queueStats.notificationQueue?.waiting || 0}</strong></span>
        </div>
      </div>

      {/* 3. 24h Success Rate */}
      <div className={cardBase}>
        <div className="flex items-center justify-between">
          <span className={`text-xs uppercase tracking-wider ${labelText}`}>24h Reliability</span>
          <div className={`w-8 h-8 rounded flex items-center justify-center ${
            isLight ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'
          }`}>
            <CheckCircle className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-light font-mono ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
              {successRate24h}%
            </span>
            <span className={`text-xs ${subText}`}>success rate</span>
          </div>
          <p className={`text-xs mt-2 ${subText}`}>
            {totalBackups24h} total executions ({failedBackups24h} failed)
          </p>
        </div>
        <div className={`mt-3 pt-2 border-t ${divider} text-xs ${subText} flex justify-between`}>
          <span className={isLight ? 'text-slate-700' : 'text-slate-300'}>Passed: {totalBackups24h - failedBackups24h}</span>
          <span className={failedBackups24h > 0 ? (isLight ? 'text-slate-900 font-medium' : 'text-slate-200') : subText}>
            Failed: {failedBackups24h}
          </span>
        </div>
      </div>

      {/* 4. Active Alerts */}
      <div className={cardBase}>
        <div className="flex items-center justify-between">
          <span className={`text-xs uppercase tracking-wider ${labelText}`}>System Health</span>
          <div className={`w-8 h-8 rounded flex items-center justify-center ${
            isLight ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}>
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-light font-mono ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
              {alertsCount}
            </span>
            <span className={`text-xs ${subText}`}>active alerts</span>
          </div>
          <p className={`text-xs mt-2 ${subText}`}>
            {alertsCount === 0 ? 'All systems nominal' : 'Attention required'}
          </p>
        </div>
        <div className={`mt-3 pt-2 border-t ${divider} text-xs ${subText} flex justify-between`}>
          <span>Status: <strong className={isLight ? 'text-slate-800 font-medium' : 'text-slate-200'}>{summary.systemStatus?.toUpperCase()}</strong></span>
          <span className={isLight ? 'text-slate-700' : 'text-slate-300'}>
            {alertsCount > 0 ? 'Warning' : 'Nominal'}
          </span>
        </div>
      </div>

    </div>
  );
}
