// dashboard/src/components/QuickBackupModal.jsx

import React, { useState } from 'react';
import { X, Play, Database, HardDrive, ShieldCheck, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { dashboardApi } from '../services/api';

export default function QuickBackupModal({ isOpen, onClose, onSuccess, theme = 'dark' }) {
  const isLight = theme === 'light';

  const [dbType, setDbType] = useState('postgresql');
  const [dbName, setDbName] = useState('appdb');
  const [backupType, setBackupType] = useState('full');
  const [storageType, setStorageType] = useState('local');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  if (!isOpen) return null;

  const handleTrigger = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await dashboardApi.triggerBackup({
        dbType,
        dbName,
        backupType,
        storageType,
      });

      setSuccessMsg(res.message || `Backup #${res.backupId || ''} queued successfully!`);
      setTimeout(() => {
        if (onSuccess) onSuccess(res);
        onClose();
        setSuccessMsg(null);
      }, 1200);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to trigger quick backup operation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className={`w-full max-w-lg border rounded-xl shadow-2xl transition-all overflow-hidden ${
        isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-[#131924] border-slate-800 text-slate-100'
      }`}>
        
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${
          isLight ? 'border-slate-100 bg-slate-50/80' : 'border-slate-800 bg-slate-900/50'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isLight ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
            }`}>
              <Play className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Trigger Quick Backup</h2>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Queue a database backup job directly from the monitoring dashboard
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg border transition ${
              isLight
                ? 'hover:bg-slate-200/70 border-transparent text-slate-500'
                : 'hover:bg-slate-800 border-transparent text-slate-400'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleTrigger} className="p-6 space-y-5">
          
          {/* Notifications / Alerts */}
          {errorMsg && (
            <div className="p-3 rounded-lg border text-xs flex items-start gap-2.5 bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-lg border text-xs flex items-start gap-2.5 bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Database Engine Selector */}
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${
              isLight ? 'text-slate-600' : 'text-slate-400'
            }`}>
              Target Database Engine
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'postgresql', label: 'PostgreSQL', icon: '🐘' },
                { id: 'mysql', label: 'MySQL', icon: '🐬' },
                { id: 'mongodb', label: 'MongoDB', icon: '🍃' },
                { id: 'sqlite', label: 'SQLite', icon: '📦' },
              ].map((db) => {
                const isSelected = dbType === db.id;
                return (
                  <button
                    key={db.id}
                    type="button"
                    onClick={() => setDbType(db.id)}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs transition ${
                      isSelected
                        ? isLight
                          ? 'bg-blue-50 border-blue-500 text-blue-700 font-semibold ring-1 ring-blue-500'
                          : 'bg-blue-500/10 border-blue-500 text-blue-400 font-semibold ring-1 ring-blue-500/50'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-900'
                    }`}
                  >
                    <span className="text-base mb-1">{db.icon}</span>
                    <span>{db.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Database Name Input */}
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wider mb-1.5 ${
              isLight ? 'text-slate-600' : 'text-slate-400'
            }`}>
              Database Name
            </label>
            <div className="relative">
              <Database className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                required
                value={dbName}
                onChange={(e) => setDbName(e.target.value)}
                placeholder="e.g. appdb, production_db"
                className={`w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-900'
                    : 'bg-slate-950/80 border-slate-800 text-slate-100'
                }`}
              />
            </div>
          </div>

          {/* Backup Type & Storage Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Backup Mode */}
            <div>
              <label className={`block text-xs font-semibold uppercase tracking-wider mb-1.5 ${
                isLight ? 'text-slate-600' : 'text-slate-400'
              }`}>
                Backup Mode
              </label>
              <select
                value={backupType}
                onChange={(e) => setBackupType(e.target.value)}
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:outline-none ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-900'
                    : 'bg-slate-950/80 border-slate-800 text-slate-100'
                }`}
              >
                <option value="full">Full Database Dump</option>
                <option value="incremental">Incremental (WAL/Oplog)</option>
              </select>
            </div>

            {/* Storage Target */}
            <div>
              <label className={`block text-xs font-semibold uppercase tracking-wider mb-1.5 ${
                isLight ? 'text-slate-600' : 'text-slate-400'
              }`}>
                Storage Provider
              </label>
              <select
                value={storageType}
                onChange={(e) => setStorageType(e.target.value)}
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:outline-none ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-900'
                    : 'bg-slate-950/80 border-slate-800 text-slate-100'
                }`}
              >
                <option value="local">Local Storage Directory</option>
                <option value="s3">AWS S3 Storage Bucket</option>
                <option value="gcs">Google Cloud Storage</option>
                <option value="azure">Azure Blob Storage</option>
              </select>
            </div>

          </div>

          {/* Action Footer */}
          <div className={`pt-4 border-t flex items-center justify-end gap-3 ${
            isLight ? 'border-slate-100' : 'border-slate-800'
          }`}>
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 text-xs font-medium rounded-lg border transition ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-lg shadow-sm transition ${
                isLight
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              } ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Dispatching...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Execute Backup Now</span>
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
