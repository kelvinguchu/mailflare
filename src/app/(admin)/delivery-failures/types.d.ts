export type DeliveryFailureStatus = "unresolved" | "replaying" | "replayed";

export type DeliveryFailure = {
	id: string;
	sourceQueue: "inbound" | "outbound";
	referenceId: string | null;
	diagnosticCode: string;
	attemptCount: number;
	status: DeliveryFailureStatus;
	replayCount: number;
	messageCreatedAt: string;
	createdAt: string;
	updatedAt: string;
	replayedAt: string | null;
};

export type DeliveryFailuresResponse = {
	events: DeliveryFailure[];
	unresolvedCount: number;
};
