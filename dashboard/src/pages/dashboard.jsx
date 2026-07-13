import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Database,
  HardDrive,
  Cloud,
  Archive,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
  WifiOff,
} from "lucide-react";

/* ============================================================================
   MOCK DATA LAYER
   ============================================================================ */

const NOW = Date.now();
const minutes = (n) => n * 60 * 1000;
const hours = (n) => n * 60 * minutes(1);

const MOCK_DB = {
  connectionStatus: "connected",

  overview: {
    runningBackups: 1,
    successfulToday: 14,
    failedToday: 1,
    localStorageUsedBytes: 48_300_000_000,
    cloudStorageUsedBytes: 212_400_000_000,
    compressionSavedBytes: 96_800_000_000,
    cloudConfigured: true,
  },

  runningBackups: [
    {
      id: "run_8f2a",
      database: "orders-postgres",
      dbType: "PostgreSQL",
      stage: "Uploading to S3",
      progress: 72,
      startedAt: NOW - minutes(6) - 12_000,
      estimatedRemainingSeconds: 95,
    },
     {
      id: "run_8f5a",
      database: "orders-postgres",
      dbType: "PostgreSQL",
      stage: "Uploading to S3",
      progress: 72,
      startedAt: NOW - minutes(6) - 12_000,
      estimatedRemainingSeconds: 95,
    },
  ],

  history: Array.from({ length: 47 }).map((_, i) => {
    const statuses = ["success", "success", "success", "failed", "success", "running"];
    const dbs = [
      { name: "orders-postgres", type: "PostgreSQL" },
      { name: "analytics-clickhouse", type: "ClickHouse" },
      { name: "sessions-redis", type: "Redis" },
      { name: "billing-mysql", type: "MySQL" },
      { name: "catalog-mongo", type: "MongoDB" },
    ];
    const db = dbs[i % dbs.length];
    const status = i === 0 ? "running" : statuses[i % statuses.length];
    const createdAt = NOW - hours(i * 3 + 1);
    const durationSeconds = 40 + ((i * 37) % 400);
    return {
      id: `bkp_${1000 + i}`,
      database: db.name,
      type: db.type,
      backupType: i % 5 === 0 ? "Full" : "Incremental",
      status,
      sizeBytes: status === "failed" ? null : 200_000_000 + ((i * 53_000_000) % 4_000_000_000),
      durationSeconds: status === "running" ? null : durationSeconds,
      createdAt,
      destination: i % 3 === 0 ? "Local + S3" : "Local",
      checksum: status === "failed" ? null : `sha256:${(i * 9973).toString(16).padStart(16, "0")}`,
      logTail:
        status === "failed"
          ? "pg_dump: error: connection to server was lost\n  while sending COPY data:\nconnection timed out"
          : "Backup completed and verified successfully.\nChecksum matched. Notification sent.",
    };
  }),

  storage: {
    localUsedBytes: 48_300_000_000,
    localTotalBytes: 200_000_000_000,
    cloudUsedBytes: 212_400_000_000,
    cloudProvider: "Amazon S3",
    compressionSavedBytes: 96_800_000_000,
    compressionSavedPercent: 38,
    cloudConfigured: true,
  },

  errors: [
    {
      id: "err_1",
      time: NOW - minutes(42),
      database: "orders-postgres",
      title: "Connection lost during dump",
      description: "pg_dump lost its connection to the server mid-transfer.",
      logTail:
        "pg_dump: error: connection to server was lost\n  while sending COPY data:\nconnection timed out\nRetried 3 times, giving up.",
    },
    {
      id: "err_2",
      time: NOW - hours(9),
      database: "catalog-mongo",
      title: "Insufficient disk space",
      description: "Local backup directory ran out of space before compression finished.",
      logTail:
        "mongodump: write /var/backups/catalog/dump.bson: no space left on device\nCleanup removed partial archive.",
    },
  ],
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const api = {
  async getConnectionStatus() {
    await wait(300);
    return MOCK_DB.connectionStatus;
  },
  async getOverview() {
    await wait(450);
    return MOCK_DB.overview;
  },
  async getRunningBackups() {
    await wait(400);
    return MOCK_DB.runningBackups;
  },
  async getHistory({ page, pageSize, search, status }) {
    await wait(500);
    let rows = MOCK_DB.history;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.database.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
    }
    if (status && status !== "all") {
      rows = rows.filter((r) => r.status === status);
    }
    const total = rows.length;
    const start = (page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);
    return { rows: pageRows, total };
  },
  async getStorage() {
    await wait(400);
    return MOCK_DB.storage;
  },
  async getErrors() {
    await wait(400);
    return MOCK_DB.errors;
  },
};

/* ============================================================================
   MINIMAL QUERY HOOK
   ============================================================================ */

function useQuery(queryFn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ status: "loading", data: undefined, error: undefined });
  const requestId = useRef(0);
  const queryFnRef = useRef(queryFn);
  const [refetchTick, setRefetchTick] = useState(0);
  const depsKey = deps.join("\u0000");

  useEffect(() => {
    queryFnRef.current = queryFn;
  }, [queryFn]);

  const run = useCallback(() => {
    setRefetchTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const id = ++requestId.current;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, status: "loading" }));

      void queryFnRef.current()
        .then((data) => {
          if (id === requestId.current) setState({ status: "success", data, error: undefined });
        })
        .catch((error) => {
          if (id === requestId.current) setState({ status: "error", data: undefined, error });
        });
    }, 0);

    return () => clearTimeout(timer);
  }, [enabled, depsKey, refetchTick]);

  return { ...state, refetch: run };
}

/* ============================================================================
   FORMATTERS
   ============================================================================ */

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatElapsed(startedAt) {
  return formatDuration(Math.floor((Date.now() - startedAt) / 1000));
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ============================================================================
   PRIMITIVES
   ============================================================================ */

function SectionHeader({ title, description, right }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold text-gray-900 tracking-tight">{title}</h2>
        {description && <p className="text-xs text-gray-500 hidden sm:block">{description}</p>}
      </div>
      {right}
    </div>
  );
}

function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      {Icon && (
        <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center mb-2">
          <Icon className="w-3.5 h-3.5 text-gray-400" strokeWidth={1.75} />
        </div>
      )}
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {description && <p className="text-xs text-gray-500 mt-1 max-w-xs">{description}</p>}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <div className="w-8 h-8 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center mb-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red-500" strokeWidth={1.75} />
      </div>
      <p className="text-sm font-medium text-gray-700">Couldn't load this section</p>
      <p className="text-xs text-gray-500 mt-1">{message || "Something went wrong while fetching data."}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-gray-200 hover:border-blue-200 rounded-md px-3 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      )}
    </div>
  );
}

function Skeleton({ className = "" }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

function StatusBadge({ status }) {
  const config = {
    success: { label: "Success", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
    failed: { label: "Failed", dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
    running: { label: "Running", dot: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50" },
  }[status] || { label: status, dot: "bg-gray-400", text: "text-gray-600", bg: "bg-gray-50" };

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${status === "running" ? "animate-pulse" : ""}`} />
      {config.label}
    </span>
  );
}

/* ============================================================================
   HEADER
   ============================================================================ */

function ConnectionIndicator({ status }) {
  const map = {
    connected: { label: "Connected", dot: "bg-emerald-500" },
    degraded: { label: "Degraded", dot: "bg-amber-500" },
    offline: { label: "Offline", dot: "bg-red-500" },
  };
  const s = map[status] || map.offline;
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </div>
  );
}

function Header({ connectionStatus, lastRefresh, onRefresh, refreshing }) {
  return (
    <header className="border-b border-gray-200 bg-white/90 backdrop-blur sticky top-0 z-20">
      <div className="px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center shrink-0">
            <Database className="w-4 h-4 text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 leading-tight truncate">DB-Backup-CLI</h1>
            <p className="text-xs text-gray-500 leading-tight hidden sm:block">Monitoring dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden md:flex flex-col items-end">
            <ConnectionIndicator status={connectionStatus} />
            <span className="text-[11px] text-gray-400 mt-0.5">
              Updated {lastRefresh ? formatRelativeTime(lastRefresh) : "—"}
            </span>
          </div>
          <button
            onClick={onRefresh}
            aria-label="Refresh dashboard"
            className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ============================================================================
   OVERVIEW CARDS
   ============================================================================ */

function OverviewCard({ label, value, icon: Icon, tone = "default" }) {
  const toneMap = {
    default: "text-gray-900",
    good: "text-emerald-600",
    bad: "text-red-600",
  };
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 sm:px-4 py-3 shadow-sm flex items-center justify-between">
      <div className="min-w-0">
        <span className="text-xs font-medium text-gray-500 block truncate">{label}</span>
        <div className={`text-base sm:text-lg font-semibold tabular-nums ${toneMap[tone]}`}>{value}</div>
      </div>
      {Icon && <Icon className="w-4 h-4 text-gray-300 shrink-0 ml-2" strokeWidth={1.75} />}
    </div>
  );
}

function OverviewSection({ query }) {
  if (query.status === "loading") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <Skeleton className="h-3 w-16 mb-2" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>
    );
  }
  if (query.status === "error") {
    return (
      <div className="bg-white border border-gray-200 rounded-lg">
        <ErrorState message={query.error?.message} onRetry={query.refetch} />
      </div>
    );
  }

  const d = query.data;
  const cards = [
    { label: "Running", value: d.runningBackups, icon: Loader2 },
    { label: "Successful Today", value: d.successfulToday, icon: CheckCircle2, tone: "good" },
    { label: "Failed Today", value: d.failedToday, icon: XCircle, tone: d.failedToday > 0 ? "bad" : "default" },
    { label: "Local Storage", value: formatBytes(d.localStorageUsedBytes), icon: HardDrive },
  ];
  if (d.cloudConfigured) {
    cards.push({ label: "Cloud Storage", value: formatBytes(d.cloudStorageUsedBytes), icon: Cloud });
  }
  cards.push({ label: "Compression Saved", value: formatBytes(d.compressionSavedBytes), icon: Archive });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {cards.map((c) => (
        <OverviewCard key={c.label} {...c} />
      ))}
    </div>
  );
}

/* ============================================================================
   RUNNING BACKUPS
   ============================================================================ */

function RunningBackupCard({ backup, className = "" }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-3 shadow-sm ${className}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 truncate">{backup.database}</span>
            <span className="text-[11px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 shrink-0">
              {backup.dbType}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{backup.stage}</p>
        </div>
        <StatusBadge status="running" />
      </div>

      <div className="mb-2">
        <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${backup.progress}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Elapsed {formatElapsed(backup.startedAt)}</span>
        {backup.estimatedRemainingSeconds != null && (
          <span>~{formatDuration(backup.estimatedRemainingSeconds)} remaining</span>
        )}
      </div>
    </div>
  );
}

function RunningBackupsSection({ query }) {
  if (query.status === "loading") {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
        <Skeleton className="h-4 w-40 mb-2" />
        <Skeleton className="h-1 w-full mb-2" />
        <Skeleton className="h-3 w-24" />
      </div>
    );
  }
  if (query.status === "error") {
    return (
      <div className="bg-white border border-gray-200 rounded-lg">
        <ErrorState message={query.error?.message} onRetry={query.refetch} />
      </div>
    );
  }
  if (!query.data || query.data.length === 0) return null;

  const hasOddCount = query.data.length % 2 === 1;

  return (
    <section>
      <SectionHeader title="Running Backups" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {query.data.map((b, index) => {
          const isLastOddCard = hasOddCount && index === query.data.length - 1;
          return <RunningBackupCard key={b.id} backup={b} className={isLastOddCard ? "md:col-span-2" : ""} />;
        })}
      </div>
    </section>
  );
}

/* ============================================================================
   BACKUP HISTORY
   ============================================================================ */

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "running", label: "Running" },
];

function HistoryDrawer({ row, onClose }) {
  if (!row) return null;
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full border-l border-gray-200 shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{row.database}</h3>
            <p className="text-xs text-gray-500 truncate">{row.id}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 shrink-0 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status"><StatusBadge status={row.status} /></Field>
            <Field label="Type" value={row.type} />
            <Field label="Backup Type" value={row.backupType} />
            <Field label="Destination" value={row.destination} />
            <Field label="Size" value={formatBytes(row.sizeBytes)} />
            <Field label="Duration" value={formatDuration(row.durationSeconds)} />
            <Field label="Created" value={formatDateTime(row.createdAt)} />
            <Field label="Checksum" value={row.checksum || "—"} mono />
          </div>
          <div>
            <span className="text-xs font-medium text-gray-500">Log</span>
            <pre className="mt-1.5 bg-gray-900 text-gray-100 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {row.logTail}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, children, mono }) {
  return (
    <div>
      <div className="text-[11px] text-gray-400 mb-0.5">{label}</div>
      {children || <div className={`text-gray-800 ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</div>}
    </div>
  );
}

function HistorySection() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState(null);
  const pageSize = 10;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(timer);
  }, [debouncedSearch, status]);

  const query = useQuery(
    () => api.getHistory({ page, pageSize, search: debouncedSearch, status }),
    [page, debouncedSearch, status]
  );

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / pageSize)) : 1;

  return (
    <section>
      <SectionHeader
        title="Backup History"
        right={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search database..."
                className="w-full sm:w-44 pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 placeholder:text-gray-400"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full sm:w-auto text-xs border border-gray-200 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        {query.status === "loading" && (
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}

        {query.status === "error" && <ErrorState message={query.error?.message} onRetry={query.refetch} />}

        {query.status === "success" && query.data.total === 0 && (
          <EmptyState
            icon={Database}
            title="No backups have been created yet."
            description="Once the CLI runs a backup, it will show up here."
          />
        )}

        {query.status === "success" && query.data.total > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="font-medium px-3 py-2">Database</th>
                    <th className="font-medium px-3 py-2 hidden sm:table-cell">Type</th>
                    <th className="font-medium px-3 py-2 hidden md:table-cell">Backup Type</th>
                    <th className="font-medium px-3 py-2">Status</th>
                    <th className="font-medium px-3 py-2 hidden sm:table-cell">Size</th>
                    <th className="font-medium px-3 py-2 hidden lg:table-cell">Duration</th>
                    <th className="font-medium px-3 py-2 hidden md:table-cell">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedRow(row)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && setSelectedRow(row)}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/30"
                    >
                      <td className="px-3 py-2 font-medium text-gray-900 truncate max-w-30 sm:max-w-none">{row.database}</td>
                      <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{row.type}</td>
                      <td className="px-3 py-2 text-gray-500 hidden md:table-cell">{row.backupType}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-3 py-2 text-gray-500 tabular-nums hidden sm:table-cell">{formatBytes(row.sizeBytes)}</td>
                      <td className="px-3 py-2 text-gray-500 tabular-nums hidden lg:table-cell">{formatDuration(row.durationSeconds)}</td>
                      <td className="px-3 py-2 text-gray-500 hidden md:table-cell">{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between px-3 py-2 border-t border-gray-100 gap-2">
              <span className="text-xs text-gray-500">
                Page {page} of {totalPages} · {query.data.total} runs
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:border-gray-300 hover:enabled:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:border-gray-300 hover:enabled:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <HistoryDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
    </section>
  );
}

/* ============================================================================
   STORAGE USAGE
   ============================================================================ */

function StorageBar({ label, used, total, tone = "blue" }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const toneMap = { blue: "bg-blue-500", gray: "bg-gray-700" };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600 truncate mr-2">{label}</span>
        <span className="text-xs text-gray-400 tabular-nums shrink-0">
          {formatBytes(used)} {total ? `/ ${formatBytes(total)}` : ""}
        </span>
      </div>
      <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${toneMap[tone]} rounded-full transition-all duration-500`} style={{ width: `${total ? pct : 8}%` }} />
      </div>
    </div>
  );
}

function StorageSection({ query }) {
  return (
    <section>
      <SectionHeader title="Storage Usage" />
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        {query.status === "loading" && (
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {query.status === "error" && <ErrorState message={query.error?.message} onRetry={query.refetch} />}
        {query.status === "success" && (
          <div className="space-y-4">
            <StorageBar label="Local Storage" used={query.data.localUsedBytes} total={query.data.localTotalBytes} tone="gray" />
            {query.data.cloudConfigured ? (
              <StorageBar label={`Cloud Storage (${query.data.cloudProvider})`} used={query.data.cloudUsedBytes} tone="blue" />
            ) : (
              <div className="border border-dashed border-gray-200 rounded-lg py-4">
                <EmptyState icon={Cloud} title="Cloud storage is not configured." description="Run `db-backup-cli config storage` to add a provider." />
              </div>
            )}
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600 truncate mr-2">Compression Saved</span>
                <span className="text-xs text-emerald-600 font-medium tabular-nums shrink-0">
                  {formatBytes(query.data.compressionSavedBytes)} ({query.data.compressionSavedPercent}%)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ============================================================================
   RECENT ERRORS
   ============================================================================ */

function ErrorDrawer({ err, onClose }) {
  if (!err) return null;
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full border-l border-gray-200 shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{err.title}</h3>
            <p className="text-xs text-gray-500 truncate">{err.database} · {formatDateTime(err.time)}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close error details"
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 shrink-0 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto text-sm">
          <p className="text-gray-600">{err.description}</p>
          <div>
            <span className="text-xs font-medium text-gray-500">Full Log</span>
            <pre className="mt-1.5 bg-gray-900 text-gray-100 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {err.logTail}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorsSection({ query }) {
  const [selected, setSelected] = useState(null);

  return (
    <section>
      <SectionHeader title="Recent Errors" />
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
        {query.status === "loading" && (
          <div className="p-3 space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}
        {query.status === "error" && <ErrorState message={query.error?.message} onRetry={query.refetch} />}
        {query.status === "success" && query.data.length === 0 && (
          <EmptyState icon={CheckCircle2} title="No recent failures." description="Everything has been running smoothly." />
        )}
        {query.status === "success" && query.data.length > 0 && (
          <ul>
            {query.data.map((err, i) => (
              <li key={err.id}>
                <button
                  onClick={() => setSelected(err)}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/30 ${
                    i !== 0 ? "border-t border-gray-50" : ""
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-red-50 flex items-center justify-center mt-0.5 shrink-0">
                    <XCircle className="w-3.5 h-3.5 text-red-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 truncate">{err.title}</span>
                      <span className="text-[11px] text-gray-400 shrink-0">{formatRelativeTime(err.time)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{err.database}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate hidden sm:block">{err.description}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ErrorDrawer err={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

/* ============================================================================
   APP
   ============================================================================ */

export default function App() {
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const connectionQuery = useQuery(api.getConnectionStatus, [refreshTick]);
  const overviewQuery = useQuery(api.getOverview, [refreshTick]);
  const runningQuery = useQuery(api.getRunningBackups, [refreshTick]);
  const storageQuery = useQuery(api.getStorage, [refreshTick]);
  const errorsQuery = useQuery(api.getErrors, [refreshTick]);

  const anyLoading = [connectionQuery, overviewQuery, runningQuery, storageQuery, errorsQuery].some(
    (q) => q.status === "loading"
  );

  useEffect(() => {
    if (!anyLoading && refreshing) {
      const timer = setTimeout(() => {
        setRefreshing(false);
        setLastRefresh(Date.now());
      }, 0);

      return () => clearTimeout(timer);
    }
  }, [anyLoading, refreshing]);

  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshTick((n) => n + 1);
  };

  if (connectionQuery.status === "success" && connectionQuery.data === "offline") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="max-w-sm w-full bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <WifiOff className="w-4.5 h-4.5 text-gray-400" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900">Backend unreachable</h2>
          <p className="text-xs text-gray-500 mt-1.5">
            The dashboard can't reach the DB-Backup-CLI backend. Make sure the daemon is running.
          </p>
          <button
            onClick={handleRefresh}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md px-3 py-2 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <RefreshCw className="w-3 h-3" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`
        @keyframes slideIn { from { transform: translateX(16px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>

      <Header
        connectionStatus={connectionQuery.data || "offline"}
        lastRefresh={lastRefresh}
        onRefresh={handleRefresh}
        refreshing={refreshing || anyLoading}
      />

      <main className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-6">
        <OverviewSection query={overviewQuery} />
        <RunningBackupsSection query={runningQuery} />
        <HistorySection />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <StorageSection query={storageQuery} />
          <ErrorsSection query={errorsQuery} />
        </div>
      </main>

      <footer className="px-4 sm:px-6 py-4 sm:py-6 text-center">
        <p className="text-[11px] text-gray-400">
          DB-Backup-CLI Dashboard · observability layer for the CLI · not a replacement for it
        </p>
      </footer>
    </div>
  );
}