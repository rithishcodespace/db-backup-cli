// dashboard/src/components/QueueVisibility.jsx

import React, { useState } from 'react';
import { Layers, Clock, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

export default function QueueVisibility({ queueStats, theme = 'dark' }) {
  const isLight = theme === 'light';
  const [activeTab, setActiveTab] = useState('backup');

  if (!queueStats) return null;

  const { backupQueue = {}, storageQueue = {}, notificationQueue = {} } = queueStats;

  const currentQueue =
    activeTab === 'backup'
      ? { name: 'Backup Queue', data: backupQueue, desc: 'Handles database export & dump execution' }
      : activeTab === 'storage'
      ? { name: 'Storage Queue', data: storageQueue, desc: 'Handles compression, S3 upload & retention pruning' }
      : { name: 'Notification Queue', data: notificationQueue, desc: 'Handles Email & Slack alert delivery' };

  const { waiting = 0, active = 0, completed = 0, failed = 0, delayed = 0, total = 0 } = currentQueue.data;

  return (
    <div className={`border rounded-lg p-5 transition ${
      isLight
        ? 'bg-white border-slate-200 text-slate-800 light-card-shadow'
        : 'bg-[#131924] border-slate-800 text-slate-100 dark-card-shadow'
    }`}>
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b ${
        isLight ? 'border-slate-100' : 'border-slate-800'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded flex items-center justify-center ${
            isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'
          }`}>
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h2 className={`text-sm font-medium ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
              Queue State Visibility
            </h2>
            <p className={`text-xs font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              BullMQ Redis task state monitor
            </p>
          </div>
        </div>

        {/* Queue Switcher */}
        <div className={`flex items-center p-1 rounded border text-xs ${
          isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
        }`}>
          {[
            { id: 'backup', label: 'Backup' },
            { id: 'storage', label: 'Storage' },
            { id: 'notification', label: 'Notification' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 rounded transition ${
                activeTab === tab.id
                  ? isLight
                    ? 'bg-slate-900 text-white font-normal'
                    : 'bg-slate-800 text-slate-100 font-normal border border-slate-700'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className={isLight ? 'text-slate-600' : 'text-slate-400'}>{currentQueue.desc}</span>
        <span className={`font-mono text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          Total Processed: {total}
        </span>
      </div>

      {/* State Metric Counters Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
        
        {/* Waiting */}
        <div className={`p-3.5 rounded border transition ${
          isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-900/60 border-slate-800 text-slate-200'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-slate-400">Waiting</span>
            <Clock className="w-3.5 h-3.5 opacity-60" />
          </div>
          <p className="text-xl font-light font-mono mt-1">{waiting}</p>
          <span className="text-[10px] text-slate-400 mt-0.5 block">Queued in Redis</span>
        </div>

        {/* Active */}
        <div className={`p-3.5 rounded border transition ${
          isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-900/60 border-slate-800 text-slate-200'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-slate-400">Active</span>
            <RefreshCw className="w-3.5 h-3.5 opacity-60 animate-spin" />
          </div>
          <p className="text-xl font-light font-mono mt-1">{active}</p>
          <span className="text-[10px] text-slate-400 mt-0.5 block">Worker executing</span>
        </div>

        {/* Completed */}
        <div className={`p-3.5 rounded border transition ${
          isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-900/60 border-slate-800 text-slate-200'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-slate-400">Completed</span>
            <CheckCircle2 className="w-3.5 h-3.5 opacity-60" />
          </div>
          <p className="text-xl font-light font-mono mt-1">{completed}</p>
          <span className="text-[10px] text-slate-400 mt-0.5 block">Success jobs</span>
        </div>

        {/* Failed */}
        <div className={`p-3.5 rounded border transition ${
          isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-900/60 border-slate-800 text-slate-200'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-slate-400">Failed</span>
            <AlertCircle className="w-3.5 h-3.5 opacity-60" />
          </div>
          <p className="text-xl font-light font-mono mt-1">{failed}</p>
          <span className="text-[10px] text-slate-400 mt-0.5 block">Error state</span>
        </div>

        {/* Delayed */}
        <div className={`p-3.5 rounded border transition ${
          isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-900/60 border-slate-800 text-slate-200'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-slate-400">Delayed</span>
            <Clock className="w-3.5 h-3.5 opacity-60" />
          </div>
          <p className="text-xl font-light font-mono mt-1">{delayed}</p>
          <span className="text-[10px] text-slate-400 mt-0.5 block">Scheduled retry</span>
        </div>

      </div>

    </div>
  );
}
