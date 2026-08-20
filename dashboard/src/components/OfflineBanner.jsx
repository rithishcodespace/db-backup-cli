// dashboard/src/components/OfflineBanner.jsx

import React from 'react';
import { AlertOctagon, RefreshCw, AlertTriangle } from 'lucide-react';

export default function OfflineBanner({ isConnected, apiError, lastUpdated, onRetry }) {
  if (isConnected && !apiError) return null;

  const formattedTime = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : 'No recent update recorded';

  const isNetworkOffline = !isConnected;

  return (
    <div className={`border-b px-4 lg:px-8 py-3 ${
      isNetworkOffline
        ? 'bg-red-950/90 border-red-800 text-red-200'
        : 'bg-amber-950/90 border-amber-800 text-amber-200'
    }`}>
      <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-3">
          {isNetworkOffline ? (
            <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          )}
          <div>
            <span className="font-semibold text-white">
              {isNetworkOffline
                ? 'Backend disconnected.'
                : 'Backend reachable, but dashboard data could not be loaded.'}
            </span>
            <span className={`ml-2 ${isNetworkOffline ? 'text-red-300' : 'text-amber-300'}`}>
              {isNetworkOffline
                ? 'The dashboard cannot reach API Gateway (http://localhost:3000).'
                : `API Error: ${apiError}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className={isNetworkOffline ? 'text-red-400' : 'text-amber-400'}>
            Last successful update: {formattedTime}
          </span>
          <button
            onClick={onRetry}
            className={`px-3 py-1 font-sans text-xs rounded border flex items-center gap-1.5 transition ${
              isNetworkOffline
                ? 'bg-red-900 hover:bg-red-800 text-white border-red-700'
                : 'bg-amber-900 hover:bg-amber-800 text-white border-amber-700'
            }`}
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      </div>
    </div>
  );
}

