import { Fragment } from "react";
import { formatThreadParticipants } from "@/components/conversation/conversation-utils";
import type { Message, MessageFolder } from "@/hooks/types";
import { cn } from "@/lib/utils";

/**
 * The sender cell of a list row. Conversations list their participants with unread
 * senders in bold and a message count; single messages show one party.
 */
export function MessageRowParty({
	message,
	folder,
	fallback,
	className,
}: {
	message: Message;
	folder: MessageFolder;
	fallback: string;
	className: string;
}) {
	const thread = message.thread;
	if (folder === "drafts") {
		return <span className={className}>{fallback}</span>;
	}
	if (!thread || thread.participants.length === 0) return null;
	// A locally marked-read row should not keep bold names until the list refreshes.
	const participants = message.read
		? thread.participants.map((participant) => ({ ...participant, unread: false }))
		: thread.participants;
	const tokens = formatThreadParticipants(participants);
	const label = participants
		.map((participant) => (participant.isMe ? "me" : participant.name))
		.join(", ");

	return (
		<span
			className={cn(className, "flex min-w-0 items-baseline gap-1.5 font-normal text-neutral-700")}
			title={label}
		>
			<span className="truncate">
				{folder === "sent" && <span className="text-neutral-500">To: </span>}
				{tokens.map((token, index) => (
					<Fragment key={index}>
						{index > 0 && token.kind === "name" && tokens[index - 1]?.kind !== "gap" && ", "}
						{token.kind === "gap" ? (
							<span className="text-neutral-400"> .. </span>
						) : (
							<span className={token.unread ? "font-bold text-neutral-900" : undefined}>
								{token.label}
							</span>
						)}
					</Fragment>
				))}
			</span>
			{thread.messageCount > 1 && (
				<span className="shrink-0 text-xs text-neutral-500 tabular-nums">
					{thread.messageCount}
				</span>
			)}
		</span>
	);
}
