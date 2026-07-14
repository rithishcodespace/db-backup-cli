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
      backupId: "bkp_20481",
      database: "orders-postgres",
      dbType: "PostgreSQL",
      stage: "Uploading to Amazon S3",
      currentOperation: "Encrypting archive",
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
    const originalSizeBytes = 280_000_000 + ((i * 61_000_000) % 4_500_000_000);
    const compressedSizeBytes = status === "failed" ? null : Math.round(originalSizeBytes * 0.62);
    return {
      id: `bkp_${1000 + i}`,
      backupId: `bkp_${1000 + i}`,
      database: db.name,
      type: db.type,
      backupType: i % 5 === 0 ? "Full" : "Incremental",
      status,
      sizeBytes: compressedSizeBytes,
      originalSizeBytes,
      compressedSizeBytes,
      compressionEnabled: i % 7 !== 3,
      encryptionEnabled: i % 4 !== 0,
      encryptionAlgorithm: i % 4 !== 0 ? "AES-256-GCM" : null,
      storageProvider: i % 3 === 0 ? "Amazon S3" : "Local Storage",
      storageLocation: i % 3 === 0 ? "s3://prod-db-backups/orders" : "/var/lib/db-backups",
      durationSeconds: status === "running" ? null : durationSeconds,
      startedAt: createdAt - minutes(2 + (i % 4)),
      completedAt: status === "running" ? null : createdAt - minutes(1),
      createdAt,
      destination: i % 3 === 0 ? "Local + S3" : "Local",
      checksum: status === "failed" ? null : `sha256:${(i * 9973).toString(16).padStart(16, "0")}`,
      slackNotificationStatus: status === "running" ? "pending" : "sent",
      emailNotificationStatus: status === "failed" ? "failed" : "sent",
      failureReason: status === "failed" ? "Connection lost during dump" : null,
      logTail:
        status === "failed"
          ? "pg_dump: error: connection to server was lost\n  while sending COPY data:\nconnection timed out"
          : "Backup completed and verified successfully.\nChecksum matched. Notification sent.",
      logPreview:
        status === "failed"
          ? "pg_dump: error: connection to server was lost"
          : "Backup completed and verified successfully.",
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
      severity: "high",
      description: "pg_dump lost its connection to the server mid-transfer.",
      logTail:
        "pg_dump: error: connection to server was lost\n  while sending COPY data:\nconnection timed out\nRetried 3 times, giving up.",
    },
    {
      id: "err_2",
      time: NOW - hours(9),
      database: "catalog-mongo",
      title: "Insufficient disk space",
      severity: "medium",
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

function formatMaybeDateTime(ts) {
  return ts ? formatDateTime(ts) : null;
}

function formatPercent(n) {
  if (n === null || n === undefined) return null;
  return `${Math.round(n)}%`;
}

function formatRatio(value) {
  if (value === null || value === undefined) return null;
  return `${value.toFixed(2)}x`;
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

function OverviewCard({ label, value, subtitle, icon: Icon, tone = "default" }) {
  const toneMap = {
    default: "text-gray-900",
    good: "text-emerald-600",
    bad: "text-red-600",
  };
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 sm:px-4 py-3 shadow-sm flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 block truncate">{label}</span>
        <div className={`mt-1 text-base sm:text-lg font-semibold tabular-nums leading-tight ${toneMap[tone]}`}>{value}</div>
        {subtitle && <p className="mt-1 text-[11px] text-gray-500 truncate">{subtitle}</p>}
      </div>
      {Icon && <Icon className="w-4 h-4 text-gray-300 shrink-0 ml-2" strokeWidth={1.75} />}
    </div>
  );
}

function OverviewSection({ query, runningQuery, storageQuery }) {
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
  const runningBackup = runningQuery?.status === "success" ? runningQuery.data?.[0] : null;
  const storage = storageQuery?.status === "success" ? storageQuery.data : null;
  const localStoragePercent = storage?.localTotalBytes ? Math.round((storage.localUsedBytes / storage.localTotalBytes) * 100) : null;
  const cards = [
    { label: "Running Backups", value: d.runningBackups, subtitle: runningBackup?.currentOperation || runningBackup?.stage, icon: Loader2 },
    { label: "Successful Today", value: d.successfulToday, icon: CheckCircle2, tone: "good" },
    { label: "Failed Today", value: d.failedToday, icon: XCircle, tone: d.failedToday > 0 ? "bad" : "default" },
    { label: "Storage Used", value: formatBytes(d.localStorageUsedBytes), subtitle: localStoragePercent != null ? `${formatPercent(localStoragePercent)} of local storage` : undefined, icon: HardDrive },
  ];
  if (d.cloudConfigured) {
    cards.push({ label: "Cloud Storage", value: formatBytes(d.cloudStorageUsedBytes), subtitle: storage?.cloudProvider, icon: Cloud });
  }
  cards.push({ label: "Compression Saved", value: formatBytes(d.compressionSavedBytes), subtitle: `${formatPercent(d.compressionSavedPercent)} reduction`, icon: Archive });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {cards.map((c) => (
        <OverviewCard key={c.label} {...c} />
      ))}
    </div>
  );
}


function RunningBackupCard({ backup, className = "" }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-3 shadow-sm transition-colors duration-200 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{backup.database}</span>
            <span className="text-[11px] font-medium text-gray-500 border border-gray-200 rounded-full px-2 py-0.5 shrink-0 bg-gray-50">
              {backup.dbType}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1 truncate">{backup.stage}</p>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-gray-500">
        <div className="space-y-0.5">
          <div className="text-gray-400 uppercase tracking-widest">Current operation</div>
          <div className="text-gray-700 truncate">{backup.currentOperation || backup.stage}</div>
        </div>
        <div className="space-y-0.5 sm:text-right">
            <div className="text-gray-400 uppercase tracking-widest">Timing</div>
          <div className="text-gray-700 tabular-nums">
            Elapsed {formatElapsed(backup.startedAt)}
            {backup.estimatedRemainingSeconds != null ? ` · ~${formatDuration(backup.estimatedRemainingSeconds)} left` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunningBackupsSection({ query }) {
  if (query.status === "loading") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
            <Skeleton className="h-4 w-40 mb-2" />
            <Skeleton className="h-3 w-24 mb-3" />
            <Skeleton className="h-1 w-full mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
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
  if (!query.data || query.data.length === 0) {
    return (
      <section>
        <SectionHeader title="Running Backups" />
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <EmptyState
            icon={Loader2}
            title="No backups currently running."
            description="Active backup jobs will appear here while the CLI is working."
          />
        </div>
      </section>
    );
  }

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


const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "running", label: "Running" },
];

function MetadataField({ label, value, children, mono = false }) {
  if (value === null || value === undefined || value === "") return null;

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.08em] text-gray-400 mb-0.5">{label}</div>
      {children || <div className={`text-gray-800 ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</div>}
    </div>
  );
}

function BackupDetailsDrawer({ row, onClose }) {
  if (!row) return null;

  const items = [
    { label: "Backup ID", value: row.backupId || row.id, mono: true },
    { label: "Database Name", value: row.database },
    { label: "Database Type", value: row.type },
    { label: "Backup Type", value: row.backupType },
    {
      label: "Status",
      children: <StatusBadge status={row.status} />,
    },
    { label: "Started At", value: formatMaybeDateTime(row.startedAt || row.createdAt) },
    { label: "Completed At", value: formatMaybeDateTime(row.completedAt) },
    { label: "Duration", value: formatDuration(row.durationSeconds) },
    { label: "Original Size", value: formatBytes(row.originalSizeBytes) },
    { label: "Compressed Size", value: formatBytes(row.compressedSizeBytes || row.sizeBytes) },
    {
      label: "Compression Enabled",
      value: row.compressionEnabled === undefined ? null : row.compressionEnabled ? "Enabled" : "Disabled",
    },
    {
      label: "Encryption Enabled",
      value: row.encryptionEnabled === undefined ? null : row.encryptionEnabled ? "Enabled" : "Disabled",
    },
    { label: "Encryption Algorithm", value: row.encryptionAlgorithm },
    { label: "Storage Provider", value: row.storageProvider || row.destination },
    { label: "Storage Location", value: row.storageLocation },
    { label: "Checksum", value: row.checksum, mono: true },
    { label: "Slack Notification", value: row.slackNotificationStatus },
    { label: "Email Notification", value: row.emailNotificationStatus },
    { label: "Failure Reason", value: row.failureReason },
  ].filter((item) => item.value !== null && item.value !== undefined && item.value !== "" || item.children);

  const logPreview = row.logPreview || row.logTail;

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl animate-[slideIn_0.2s_ease-out]">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900">{row.database}</h3>
            <p className="truncate text-xs text-gray-500">{row.backupId || row.id}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <MetadataField key={item.label} label={item.label} value={item.value} mono={item.mono}>
                {item.children}
              </MetadataField>
            ))}
          </div>

          {logPreview && (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-[0.08em] text-gray-400">Log Preview</div>
              <pre className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 whitespace-pre-wrap">
                {logPreview}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ row, onSelect, index }) {
  return (
    <tr
      onClick={() => onSelect(row)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect(row)}
      className={`cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/30 ${
        index % 2 === 1 ? "bg-gray-50/40" : "bg-white"
      }`}
    >
      <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-32 sm:max-w-none">{row.database}</td>
      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{row.type}</td>
      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{row.backupType}</td>
      <td className="px-4 py-3">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-4 py-3 text-gray-500 tabular-nums hidden sm:table-cell">{formatBytes(row.sizeBytes)}</td>
      <td className="px-4 py-3 text-gray-500 tabular-nums hidden lg:table-cell">{formatDuration(row.durationSeconds)}</td>
      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{formatDateTime(row.createdAt)}</td>
    </tr>
  );
}

function HistoryTable({ rows, onSelect }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-208 text-sm">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-gray-100 text-left text-xs text-gray-500 shadow-[0_1px_0_0_rgba(0,0,0,0.02)]">
            <th className="px-4 py-3 font-semibold tracking-[0.08em] uppercase">Database</th>
            <th className="hidden px-4 py-3 font-semibold tracking-[0.08em] uppercase sm:table-cell">Type</th>
            <th className="hidden px-4 py-3 font-semibold tracking-[0.08em] uppercase md:table-cell">Backup Type</th>
            <th className="px-4 py-3 font-semibold tracking-[0.08em] uppercase">Status</th>
            <th className="hidden px-4 py-3 font-semibold tracking-[0.08em] uppercase sm:table-cell">Size</th>
            <th className="hidden px-4 py-3 font-semibold tracking-[0.08em] uppercase lg:table-cell">Duration</th>
            <th className="hidden px-4 py-3 font-semibold tracking-[0.08em] uppercase md:table-cell">Created At</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <HistoryRow key={row.id} row={row} index={index} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
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
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-7 gap-3 rounded-md border border-gray-100 px-4 py-3">
                <Skeleton className="h-4 w-32 col-span-2" />
                <Skeleton className="h-4 w-20 hidden sm:block" />
                <Skeleton className="h-4 w-16 hidden md:block" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-20 hidden sm:block" />
                <Skeleton className="h-4 w-16 hidden lg:block" />
                <Skeleton className="h-4 w-24 hidden md:block" />
              </div>
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
            <HistoryTable rows={query.data.rows} onSelect={setSelectedRow} />

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

      <BackupDetailsDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
    </section>
  );
}


function StorageBar({ label, used, total, tone = "blue", subtitle }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const toneMap = { blue: "bg-blue-500", gray: "bg-gray-700" };
  const available = total != null ? Math.max(0, total - used) : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block truncate text-xs font-semibold text-gray-700">{label}</span>
          {subtitle && <p className="truncate text-[11px] text-gray-500">{subtitle}</p>}
        </div>
        <span className="shrink-0 text-[11px] text-gray-400 tabular-nums">{pct}% used</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${toneMap[tone]} transition-all duration-500`} style={{ width: `${total ? pct : 8}%` }} />
      </div>
      <div className="flex items-center justify-between text-[11px] text-gray-500 tabular-nums">
        <span>Used {formatBytes(used)}</span>
        {available !== null ? <span>Available {formatBytes(available)}</span> : <span>Available data unavailable</span>}
      </div>
    </div>
  );
}

function StorageSection({ query }) {
  return (
    <section className="h-full flex flex-col min-h-0">
      <SectionHeader title="Storage Usage" />
      <div className="flex flex-1 min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {query.status === "loading" && (
          <div className="flex flex-1 min-h-0 flex-col justify-start space-y-5">
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-1.5 w-full" />
              <div className="flex justify-between gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-1.5 w-full" />
              <div className="flex justify-between gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        )}
        {query.status === "error" && (
          <div className="flex flex-1 min-h-0 items-start p-3">
            <ErrorState message={query.error?.message} onRetry={query.refetch} />
          </div>
        )}
        {query.status === "success" && query.data && (
          <div className="flex flex-1 min-h-0 flex-col justify-start space-y-4">
            <StorageBar
              label="Local Storage"
              used={query.data.localUsedBytes}
              total={query.data.localTotalBytes}
              tone="gray"
              subtitle={query.data.localTotalBytes ? `${Math.round((query.data.localUsedBytes / query.data.localTotalBytes) * 100)}% of local capacity` : undefined}
            />
            {query.data.cloudConfigured ? (
              <StorageBar label="Cloud Storage" used={query.data.cloudUsedBytes} tone="blue" subtitle={query.data.cloudProvider} />
            ) : (
              <div className="border border-dashed border-gray-200 rounded-lg py-4">
                <EmptyState icon={Cloud} title="Cloud storage is not configured." description="Run `db-backup-cli config storage` to add a provider." />
              </div>
            )}
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs font-semibold text-gray-700">Compression Saved</span>
                <span className="shrink-0 text-[11px] font-medium tabular-nums text-emerald-700">{query.data.compressionSavedPercent}% reduction</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.min(100, query.data.compressionSavedPercent)}%` }} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-gray-500 tabular-nums">
                <span>Saved {formatBytes(query.data.compressionSavedBytes)}</span>
                <span>Compression ratio {formatRatio(1 - query.data.compressionSavedPercent / 100) || "—"}</span>
              </div>
            </div>
          </div>
        )}
        {query.status === "success" && !query.data && (
          <div className="flex flex-1 min-h-0 items-start p-3">
            <EmptyState icon={HardDrive} title="No storage metrics available." description="Storage usage will appear once the CLI writes backup data." />
          </div>
        )}
      </div>
    </section>
  );
}

function ErrorSeverityBadge({ severity }) {
  const config = {
    high: { label: "High", bg: "bg-red-50", text: "text-red-700", border: "border-red-100" },
    medium: { label: "Medium", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-100" },
    low: { label: "Low", bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
  }[severity] || { label: severity || "Info", bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" };

  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${config.bg} ${config.text} ${config.border}`}>{config.label}</span>;
}

function ErrorDetailsDrawer({ err, onClose }) {
  if (!err) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl animate-[slideIn_0.2s_ease-out]">
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="truncate text-sm font-semibold text-gray-900">{err.title}</h3>
              <ErrorSeverityBadge severity={err.severity} />
            </div>
            <p className="truncate text-xs text-gray-500">{err.database} · {formatDateTime(err.time)}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close error details"
            className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          <MetadataField label="Database Name" value={err.database} />
          <MetadataField label="Timestamp" value={formatDateTime(err.time)} />
          <MetadataField label="Severity" children={<ErrorSeverityBadge severity={err.severity} />} />
          <MetadataField label="Short Description" value={err.description} />

          {err.logTail && (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-[0.08em] text-gray-400">Log Preview</div>
              <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
                {err.logTail}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorRow({ err, onSelect, index }) {
  return (
    <li className="flex min-h-0 flex-1">
      <button
        onClick={() => onSelect(err)}
        className={`flex h-full w-full items-start border-b border-gray-50 px-3 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/30 ${index % 2 === 1 ? "bg-gray-50/40" : "bg-white"}`}
      >
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50">
              <XCircle className="h-3.5 w-3.5 text-red-500" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="truncate text-sm font-medium text-gray-900">{err.title}</span>
                    <ErrorSeverityBadge severity={err.severity} />
                  </div>
                  <p className="truncate text-xs text-gray-500">{err.database}</p>
                </div>
                <span className="shrink-0 text-[11px] text-gray-400">{formatRelativeTime(err.time)}</span>
              </div>
            </div>
          </div>
          <p className="mt-auto hidden truncate text-xs text-gray-400 sm:block">{err.description}</p>
          </div>
      </button>
    </li>
  );
}

function ErrorsSection({ query }) {
  const [selected, setSelected] = useState(null);

  return (
    <section className="h-full flex flex-col min-h-0">
      <SectionHeader title="Recent Errors" />
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {query.status === "loading" && (
          <div className="flex flex-1 min-h-0 flex-col justify-start space-y-2 p-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-md border border-gray-100 px-3 py-3">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {query.status === "error" && (
          <div className="flex flex-1 min-h-0 items-start p-3">
            <ErrorState message={query.error?.message} onRetry={query.refetch} />
          </div>
        )}
        {query.status === "success" && query.data.length === 0 && (
          <div className="flex flex-1 min-h-0 items-start p-3">
            <EmptyState icon={CheckCircle2} title="No recent failures." description="Everything has been running smoothly." />
          </div>
        )}
        {query.status === "success" && query.data.length > 0 && (
          <div className="flex flex-1 min-h-0 overflow-y-auto">
            <ul className="flex h-full min-h-full flex-1 flex-col">
              {query.data.map((err, index) => (
                <ErrorRow key={err.id} err={err} index={index} onSelect={setSelected} />
              ))}
            </ul>
          </div>
        )}
      </div>
      <ErrorDetailsDrawer err={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
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
        <OverviewSection query={overviewQuery} runningQuery={runningQuery} storageQuery={storageQuery} />
        <RunningBackupsSection query={runningQuery} />
        <HistorySection />

        <div className="flex flex-row items-stretch gap-4 sm:gap-6 min-h-75">
          <div className="flex-1 min-h-0">
            <StorageSection query={storageQuery} />
          </div>
          <div className="flex-1 min-h-0">
            <ErrorsSection query={errorsQuery} />
          </div>
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