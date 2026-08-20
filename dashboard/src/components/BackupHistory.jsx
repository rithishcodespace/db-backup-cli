// dashboard/src/components/BackupHistory.jsx

import React, { useState, useEffect } from 'react';
import { History, Search, CheckCircle2, XCircle, Clock, ChevronRight, HardDrive, Cloud } from 'lucide-react';
import { dashboardApi } from '../services/api';

export default function BackupHistory({ onSelectJob, theme = 'dark' }) {
  const isLight = theme === 'light';
  const [backups, setBackups] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dbTypeFilter, setDbTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const data = await dashboardApi.getHistory({
        page,
        limit,
        status: statusFilter,
        dbType: dbTypeFilter,
        search: searchQuery,
      });
      setBackups(data.backups || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch backup history', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [page, statusFilter, dbTypeFilter, searchQuery]);

  const getStatusBadge = (status) => {
    switch (status?.toUpperCase()) {
      case 'SUCCESS':
      case 'COMPLETED':
        return (
          <span className={`px-2 py-0.5 text-xs font-normal rounded flex items-center gap-1 border ${
            isLight
              ? 'bg-slate-100 text-slate-700 border-slate-200'
              : 'bg-slate-800 text-slate-300 border-slate-700'
          }`}>
            <CheckCircle2 className="w-3 h-3 text-slate-400" /> Success
          </span>
        );
      case 'FAILED':
        return (
          <span className={`px-2 py-0.5 text-xs font-normal rounded flex items-center gap-1 border ${
            isLight
              ? 'bg-slate-100 text-slate-700 border-slate-200'
              : 'bg-slate-800 text-slate-300 border-slate-700'
          }`}>
            <XCircle className="w-3 h-3 text-slate-400" /> Failed
          </span>
        );
      case 'RUNNING':
      case 'ACTIVE':
        return (
          <span className={`px-2 py-0.5 text-xs font-normal rounded flex items-center gap-1 border ${
            isLight
              ? 'bg-slate-100 text-slate-700 border-slate-200'
              : 'bg-slate-800 text-slate-300 border-slate-700'
          }`}>
            <Clock className="w-3 h-3 text-slate-400 animate-spin" /> Running
          </span>
        );
      default:
        return (
          <span className={`px-2 py-0.5 text-xs font-normal rounded flex items-center gap-1 border ${
            isLight
              ? 'bg-slate-100 text-slate-600 border-slate-200'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}>
            {status}
          </span>
        );
    }
  };

  return (
    <div className={`border rounded-lg p-5 transition ${
      isLight
        ? 'bg-white border-slate-200 text-slate-800 light-card-shadow'
        : 'bg-[#131924] border-slate-800 text-slate-100 dark-card-shadow'
    }`}>
      
      {/* Header & Controls */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b ${
        isLight ? 'border-slate-100' : 'border-slate-800'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded flex items-center justify-center ${
            isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'
          }`}>
            <History className="w-4 h-4" />
          </div>
          <div>
            <h2 className={`text-sm font-medium ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
              Backup Execution History
            </h2>
            <p className={`text-xs font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Total {total} backup records stored in Prisma metadata store
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search ID, DB..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`pl-8 pr-3 py-1.5 text-xs rounded border focus:outline-none ${
                isLight ? 'bg-slate-50 text-slate-800 border-slate-200 focus:border-slate-400' : 'bg-slate-950/60 text-slate-200 border-slate-800 focus:border-slate-600'
              }`}
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`px-3 py-1.5 text-xs rounded border focus:outline-none ${
              isLight ? 'bg-slate-50 text-slate-800 border-slate-200 focus:border-slate-400' : 'bg-slate-950/60 text-slate-300 border-slate-800 focus:border-slate-600'
            }`}
          >
            <option value="all">All Statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* DB Type Filter */}
          <select
            value={dbTypeFilter}
            onChange={(e) => setDbTypeFilter(e.target.value)}
            className={`px-3 py-1.5 text-xs rounded border focus:outline-none ${
              isLight ? 'bg-slate-50 text-slate-800 border-slate-200 focus:border-slate-400' : 'bg-slate-950/60 text-slate-300 border-slate-800 focus:border-slate-600'
            }`}
          >
            <option value="all">All Engines</option>
            <option value="postgresql">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="mongodb">MongoDB</option>
            <option value="sqlite">SQLite</option>
          </select>
        </div>
      </div>

      {/* Table Container */}
      <div className={`mt-4 overflow-x-auto rounded border ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
        <table className="w-full text-left text-xs">
          <thead className={`uppercase text-[10px] font-mono tracking-wider border-b ${
            isLight ? 'bg-slate-50 text-slate-600 border-slate-200' : 'bg-slate-950/60 text-slate-400 border-slate-800'
          }`}>
            <tr>
              <th className="py-3 px-4 font-normal">Status</th>
              <th className="py-3 px-4 font-normal">Engine / DB</th>
              <th className="py-3 px-4 font-normal">Type</th>
              <th className="py-3 px-4 font-normal">Size</th>
              <th className="py-3 px-4 font-normal">Duration</th>
              <th className="py-3 px-4 font-normal">Storage Target</th>
              <th className="py-3 px-4 font-normal">Started At</th>
              <th className="py-3 px-4 text-right font-normal">Details</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${isLight ? 'divide-slate-100 bg-white' : 'divide-slate-800/60 bg-slate-950/20'}`}>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center font-mono text-slate-500">
                  Loading backup history records...
                </td>
              </tr>
            ) : backups.length === 0 ? (
              <tr>
                <td colSpan={8} className={`py-8 text-center font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  No backup execution records match your search query.
                </td>
              </tr>
            ) : (
              backups.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onSelectJob(row)}
                  className={`cursor-pointer transition ${
                    isLight ? 'hover:bg-slate-50 text-slate-800' : 'hover:bg-slate-900/60 text-slate-200'
                  }`}
                >
                  <td className="py-3 px-4 font-mono">{getStatusBadge(row.status)}</td>
                  <td className="py-3 px-4 font-mono">
                    <div className={`font-normal ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>{row.dbName}</div>
                    <div className="text-[10px] uppercase text-slate-400">{row.dbType}</div>
                  </td>
                  <td className={`py-3 px-4 font-mono uppercase ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                    {row.backupType || 'full'}
                  </td>
                  <td className={`py-3 px-4 font-mono ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                    {row.formattedSize || '0 B'}
                  </td>
                  <td className={`py-3 px-4 font-mono ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                    {row.durationSeconds ? `${row.durationSeconds.toFixed(1)}s` : '-'}
                  </td>
                  <td className={`py-3 px-4 font-mono ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                    <div className="flex items-center gap-1.5">
                      {row.storageType === 's3' ? (
                        <Cloud className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span>{row.storageName || row.storageType || 'local'}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                    {new Date(row.startedAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectJob(row);
                      }}
                      className={`p-1.5 rounded border transition ${
                        isLight
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                      }`}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className={`mt-4 pt-3 flex items-center justify-between text-xs border-t ${
        isLight ? 'border-slate-100 text-slate-600' : 'border-slate-800 text-slate-400'
      }`}>
        <span className="font-mono text-[11px]">
          Showing page {page} of {Math.ceil(total / limit) || 1} ({total} items)
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className={`px-3 py-1 rounded border transition ${
              page === 1
                ? 'opacity-40 cursor-not-allowed'
                : isLight
                ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => (p * limit < total ? p + 1 : p))}
            disabled={page * limit >= total}
            className={`px-3 py-1 rounded border transition ${
              page * limit >= total
                ? 'opacity-40 cursor-not-allowed'
                : isLight
                ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            Next
          </button>
        </div>
      </div>

    </div>
  );
}
