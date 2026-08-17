// dashboard/src/components/SystemHealth.jsx

import React from 'react';
import { Server, Cpu, CheckCircle2, AlertTriangle, XCircle, HardDrive, Wifi, Activity } from 'lucide-react';

export default function SystemHealth({ health, theme = 'dark' }) {
  const isLight = theme === 'light';
  if (!health) return null;

  const { services = [], workers = [], redisConnected = false, timestamp } = health;

  const getStatusIcon = (status) => {
    if (status === 'healthy' || status === 'running') {
      return <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
    }
    if (status === 'degraded') {
      return <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
    }
    return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />;
  };

  const getStatusBadge = (status) => {
    if (status === 'healthy' || status === 'running') {
      return (
        <span className={`px-2.5 py-0.5 text-xs font-bold rounded border ${
          isLight ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-emerald-950 text-emerald-300 border-emerald-800'
        }`}>
          Healthy
        </span>
      );
    }
    if (status === 'degraded') {
      return (
        <span className={`px-2.5 py-0.5 text-xs font-bold rounded border ${
          isLight ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-amber-950 text-amber-300 border-amber-800'
        }`}>
          Degraded
        </span>
      );
    }
    return (
      <span className={`px-2.5 py-0.5 text-xs font-bold rounded border ${
        isLight ? 'bg-red-50 text-red-800 border-red-200' : 'bg-red-950 text-red-300 border-red-800'
      }`}>
        Offline
      </span>
    );
  };

  return (
    <div className="space-y-6">
      
      {/* 1. Infrastructure Microservices Matrix */}
      <div className={`border rounded-xl p-5 transition ${
        isLight
          ? 'bg-white border-slate-200/90 text-slate-900 light-card-shadow'
          : 'bg-slate-900/80 border-slate-800 text-slate-100'
      }`}>
        <div className={`flex items-center justify-between pb-4 border-b ${
          isLight ? 'border-slate-100' : 'border-slate-800'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isLight ? 'bg-blue-50 text-blue-600 border border-blue-200/80' : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
            }`}>
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Microservices Health Matrix</h2>
              <p className={`text-xs ${isLight ? 'text-slate-600 font-medium' : 'text-slate-400'}`}>
                Live health check telemetry for backend microservices
              </p>
            </div>
          </div>
          <span className={`text-xs font-mono font-semibold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
            Pings active: {services.filter((s) => s.status === 'healthy').length}/{services.length}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {services.map((svc) => (
            <div
              key={svc.name}
              className={`p-3.5 rounded-xl border transition flex items-center justify-between ${
                isLight
                  ? 'bg-slate-50/80 border-slate-200/90 hover:bg-slate-100/70'
                  : 'bg-slate-950/80 border-slate-800/80 hover:border-slate-700/80'
              }`}
            >
              <div className="flex items-center gap-3">
                {getStatusIcon(svc.status)}
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-slate-200">{svc.name}</h3>
                  <div className={`flex items-center gap-2 text-[11px] font-mono mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    <span>Port: {svc.port || 'N/A'}</span>
                    {svc.responseTimeMs !== undefined && (
                      <span className="font-semibold text-blue-700 dark:text-blue-400">{svc.responseTimeMs}ms</span>
                    )}
                  </div>
                </div>
              </div>
              {getStatusBadge(svc.status)}
            </div>
          ))}
        </div>
      </div>

      {/* 2. BullMQ Background Workers & Redis Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Workers Status */}
        <div className={`border rounded-xl p-5 transition ${
          isLight
            ? 'bg-white border-slate-200/90 text-slate-900 light-card-shadow'
            : 'bg-slate-900/80 border-slate-800 text-slate-100'
        }`}>
          <div className={`flex items-center gap-2.5 pb-4 border-b ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isLight ? 'bg-purple-50 text-purple-600 border border-purple-200/80' : 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
            }`}>
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Background Worker Processes</h2>
              <p className={`text-xs ${isLight ? 'text-slate-600 font-medium' : 'text-slate-400'}`}>
                BullMQ queue worker process allocations
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {workers.map((w) => (
              <div
                key={w.name}
                className={`p-3.5 rounded-xl border flex items-center justify-between ${
                  isLight
                    ? 'bg-slate-50/80 border-slate-200/90'
                    : 'bg-slate-950/80 border-slate-800'
                }`}
              >
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-slate-200">{w.name}</h3>
                  <p className={`text-[11px] font-mono mt-0.5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                    Concurrency limit: {w.concurrency} | Active tasks: {w.activeCount}
                  </p>
                </div>
                {getStatusBadge(w.status)}
              </div>
            ))}
          </div>
        </div>

        {/* Redis State & Queue Connection */}
        <div className={`border rounded-xl p-5 transition ${
          isLight
            ? 'bg-white border-slate-200/90 text-slate-900 light-card-shadow'
            : 'bg-slate-900/80 border-slate-800 text-slate-100'
        }`}>
          <div className={`flex items-center gap-2.5 pb-4 border-b ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isLight ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/80' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
            }`}>
              <Wifi className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Queue Transport Health</h2>
              <p className={`text-xs ${isLight ? 'text-slate-600 font-medium' : 'text-slate-400'}`}>
                Redis store & BullMQ connection telemetry
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
              isLight ? 'bg-slate-50/80 border-slate-200/90' : 'bg-slate-950/80 border-slate-800'
            }`}>
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-200">Redis Infrastructure Connection</h3>
                <p className={`text-[11px] font-mono mt-0.5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>Host: 127.0.0.1:6379</p>
              </div>
              {getStatusBadge(redisConnected ? 'healthy' : 'offline')}
            </div>

            <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
              isLight ? 'bg-slate-50/80 border-slate-200/90' : 'bg-slate-950/80 border-slate-800'
            }`}>
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-200">Prisma Database Metadata Connection</h3>
                <p className={`text-[11px] font-mono mt-0.5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>PostgreSQL / SQLite Storage Engine</p>
              </div>
              {getStatusBadge('healthy')}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
