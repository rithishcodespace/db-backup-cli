import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import OfflineBanner from '../components/OfflineBanner';
import MetricCards from '../components/MetricCards';
import ActiveBackups from '../components/ActiveBackups';
import BackupHistory from '../components/BackupHistory';
import ErrorDiagnosticsDrawer from '../components/ErrorDiagnosticsDrawer';
import LogsViewer from '../components/LogsViewer';
import SystemHealth from '../components/SystemHealth';
import { dashboardApi, isBackendConnected, lastSuccessfulUpdate } from '../services/api';
import { Activity, Terminal, AlertTriangle, Server } from 'lucide-react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [pollingInterval, setPollingInterval] = useState(5000);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('db_backup_theme') || 'dark';
  });

  const isLight = theme === 'light';

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    localStorage.setItem('db_backup_theme', theme);
  }, [theme]);

  // Live Backend State
  const [summary, setSummary] = useState(null);
  const [activeBackups, setActiveBackups] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [health, setHealth] = useState(null);
  const [connected, setConnected] = useState(true);
  const [apiError, setApiError] = useState(null);

  const fetchDashboardData = useCallback(async (signal) => {
    setIsRefreshing(true);
    try {
      const [sumRes, activeRes, alertsRes, healthRes] = await Promise.all([
        dashboardApi.getSummary({ signal }),
        dashboardApi.getActiveBackups({ signal }),
        dashboardApi.getAlerts({ signal }),
        dashboardApi.getHealth({ signal }),
      ]);

      if (sumRes) {
        setSummary(sumRes);
      }
      setActiveBackups(activeRes || []);
      setAlerts(alertsRes || []);
      setHealth(healthRes || null);
      setConnected(true);
      setApiError(null);
    } catch (err) {
      if (err.name === 'AbortError') {
        return;
      }
      setConnected(isBackendConnected);
      setApiError(err.message);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchDashboardData(controller.signal);

    if (pollingInterval <= 0) {
      return () => controller.abort();
    }

    const timer = setInterval(() => {
      const pollController = new AbortController();
      fetchDashboardData(pollController.signal);
    }, pollingInterval);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [fetchDashboardData, pollingInterval]);

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors ${
      isLight ? 'bg-slate-100 text-slate-900' : 'bg-[#0B0F17] text-slate-100'
    }`}>
      
      {/* Top Header */}
      <Header
        systemStatus={summary?.systemStatus}
        activeConcurrencyCount={summary?.activeConcurrencyCount}
        maxConcurrencyLimit={summary?.maxConcurrencyLimit}
        pollingInterval={pollingInterval}
        setPollingInterval={setPollingInterval}
        onRefresh={() => fetchDashboardData()}
        isRefreshing={isRefreshing}
        isConnected={connected}
        theme={theme}
        setTheme={setTheme}
      />

      {/* Disconnection / API Error Banner */}
      <OfflineBanner
        isConnected={connected}
        apiError={apiError}
        lastUpdated={lastSuccessfulUpdate}
        onRetry={() => fetchDashboardData()}
      />

      {/* Main Body */}
      <main className="flex-1 w-full px-4 lg:px-8 py-6 space-y-6">
        
        {/* Metric Cards Summary Grid */}
        <MetricCards summary={summary} theme={theme} />

        {/* Operational Tab Navigation */}
        <div className={`flex items-center justify-between border-b pb-1 ${isLight ? 'border-slate-300' : 'border-slate-800'}`}>
          <div className="flex items-center gap-1 sm:gap-2">
            {[
              { id: 'overview', label: 'Monitoring Overview', icon: Activity },
              { id: 'health', label: 'Live System Health', icon: Server },
              { id: 'logs', label: 'Log Inspector', icon: Terminal },
            ].map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition border-b-2 ${
                    isSelected
                      ? isLight
                        ? 'border-slate-900 text-slate-900 bg-white shadow-xs'
                        : 'border-slate-400 text-slate-100 bg-slate-900/60'
                      : isLight
                      ? 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Operational Alerts Indicator */}
          {alerts.length > 0 && (
            <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1 border rounded-lg text-xs ${
              isLight ? 'bg-slate-100 text-slate-800 border-slate-300' : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}>
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{alerts.length} Operational Alerts</span>
            </div>
          )}
        </div>

        {/* Tab 1: Overview View */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            
            {/* Live Active Backups Card */}
            <ActiveBackups
              activeBackups={activeBackups}
              onRefresh={fetchDashboardData}
              theme={theme}
            />

            {/* Backup Execution History */}
            <BackupHistory onSelectJob={(job) => setSelectedJob(job)} theme={theme} />

          </div>
        )}

        {/* Tab 2: Live System Health Matrix */}
        {activeTab === 'health' && (
          <SystemHealth health={health} theme={theme} />
        )}

        {/* Tab 3: Terminal Logs Inspector View */}
        {activeTab === 'logs' && (
          <LogsViewer selectedJobId={selectedJob?.id} theme={theme} />
        )}

      </main>

      {/* Footer */}
      <footer className={`border-t py-4 px-4 lg:px-8 text-center text-xs ${
        isLight ? 'border-slate-300 bg-white text-slate-600' : 'border-slate-800 bg-slate-950 text-slate-500'
      }`}>
        <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>db-backup companion monitoring web app • read-only operational dashboard</span>
          <span className="font-mono text-[11px]">Primary execution CLI: db-backup-cli</span>
        </div>
      </footer>

      {/* Error Diagnostics Drawer */}
      <ErrorDiagnosticsDrawer
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        theme={theme}
      />

    </div>
  );
}
