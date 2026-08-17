// dashboard/src/components/OfflineBanner.jsx

import React from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';

export default function OfflineBanner({ isConnected, lastUpdated, onRetry }) {
  if (isConnected) return null;

  const formattedTime = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : 'No recent update recorded';

  return (
    <div className="bg-red-950/90 border-b border-red-800 text-red-200 px-4 lg:px-8 py-3">
      <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-3">
          <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <span className="font-semibold text-white">Unable to retrieve live system data.</span>
            <span className="ml-2 text-red-300">
              The dashboard cannot reach API Gateway (<code>http://localhost:3000</code>).
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-red-400">Last successful update: {formattedTime}</span>
          <button
            onClick={onRetry}
            className="px-3 py-1 bg-red-900 hover:bg-red-800 text-white font-sans text-xs rounded border border-red-700 flex items-center gap-1.5 transition"
          >
            <RefreshCw className="w-3 h-3" /> Reconnect
          </button>
        </div>
      </div>
    </div>
  );
}
