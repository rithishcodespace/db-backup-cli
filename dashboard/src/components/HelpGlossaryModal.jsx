// dashboard/src/components/HelpGlossaryModal.jsx

import React from 'react';
import { X, HelpCircle, ShieldCheck, Cpu, Layers, Terminal, BookOpen } from 'lucide-react';

export default function HelpGlossaryModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Operational Monitoring Guide</h2>
              <p className="text-xs text-slate-400">Understanding db-backup companion metrics & concepts</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sections */}
        <div className="space-y-4 text-xs text-slate-300">
          
          {/* Section 1: Product Boundary */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span>Why is this dashboard monitoring-only?</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              The <strong>db-backup-cli</strong> binary is the single primary interface for configuring databases, setting encryption credentials, and triggering backup tasks. The Web Dashboard is designed exclusively for high-visibility monitoring, tracking execution queues, and troubleshooting failures without risking accidental data loss or misconfigurations.
            </p>
          </div>

          {/* Section 2: Concurrency Slots */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <Cpu className="w-4 h-4 text-amber-400" />
              <span>What is Concurrency Limit?</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              To protect database servers from performance degradation, the backup system limits how many database exports can execute at the exact same time (configured via <code>MAX_CONCURRENT_BACKUPS</code>, default 3). Additional requests wait safely in the BullMQ Redis queue.
            </p>
          </div>

          {/* Section 3: Queue States */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <Layers className="w-4 h-4 text-purple-400" />
              <span>Understanding Queue States</span>
            </div>
            <ul className="space-y-1.5 text-slate-400">
              <li><strong className="text-amber-400">Waiting:</strong> Job received and waiting for an available concurrency slot.</li>
              <li><strong className="text-blue-400">Active:</strong> Backup worker process is currently dumping data from the database.</li>
              <li><strong className="text-emerald-400">Completed:</strong> Backup dumped, compressed, and stored successfully.</li>
              <li><strong className="text-red-400">Failed:</strong> Job encountered an error (inspect with Level 1 & Level 2 diagnostics).</li>
            </ul>
          </div>

          {/* Section 4: CLI Commands */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>Key CLI Commands</span>
            </div>
            <div className="font-mono text-[11px] bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1.5 text-slate-300">
              <div><code>db-backup run --db postgres-prod</code> <span className="text-slate-500 font-sans">- Trigger immediate backup</span></div>
              <div><code>db-backup list</code> <span className="text-slate-500 font-sans">- List configured databases</span></div>
              <div><code>db-backup schedule list</code> <span className="text-slate-500 font-sans">- View automated backup cron jobs</span></div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 pt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-xs transition shadow-md"
          >
            Got it
          </button>
        </div>

      </div>
    </div>
  );
}
