export type OperationalSeverity = "warning" | "critical";
export type OperationalStatus = "healthy" | OperationalSeverity;

export type QueueHealth = {
	name: "inbound" | "outbound" | "webhook";
	available: boolean;
	backlogCount: number | null;
	backlogBytes: number | null;
	oldestMessageAt: string | null;
};

export type OperationalThresholds = {
	queueBacklogWarning: number;
	queueOldestMinutesWarning: number;
	deliveryFailed24hWarning: number;
	deliveryUnknown24hWarning: number;
	webhookFailed24hWarning: number;
	reminderFailed24hWarning: number;
	deadLetterUnresolvedWarning: number;
	backupStaleHours: number;
	d1GrowthPercentWarning: number;
	r2GrowthPercentWarning: number;
};

export type OperationalAlert = {
	code: string;
	severity: OperationalSeverity;
	message: string;
};

export type StorageSnapshot = {
	id: string;
	capturedAt: string;
	d1Bytes: number;
	r2ObjectCount: number;
	r2Bytes: number;
	r2ScanComplete: boolean;
};

export type StorageGrowth = {
	d1Bytes: number;
	d1Percent: number | null;
	r2Bytes: number;
	r2Percent: number | null;
	since: string | null;
};

export type OperationalHealth = {
	status: OperationalStatus;
	generatedAt: string;
	alerts: OperationalAlert[];
	queues: QueueHealth[];
	delivery: {
		accepted24h: number;
		delivered24h: number;
		failed24h: number;
		suppressed24h: number;
		unknown24h: number;
		pendingJobs: number;
		retryingJobs: number;
	};
	deadLetters: { unresolved: number; replaying: number };
	webhooks: { pending: number; retrying: number; failed24h: number };
	reminders: { scheduled: number; processing: number; retrying: number; failed24h: number };
	storage: {
		latest: StorageSnapshot | null;
		growth: StorageGrowth | null;
	};
	backup: {
		enabled: boolean;
		scheduleType: "daily" | "weekly" | "monthly";
		lastSuccessfulAt: string | null;
		lastFailedAt: string | null;
		staleAfterHours: number;
		isStale: boolean;
	};
	restoreDrill: {
		lastVerifiedAt: string | null;
		environment: "staging" | "production" | null;
		source: "staging-script" | "manual" | null;
	} | null;
	thresholds: OperationalThresholds;
};
