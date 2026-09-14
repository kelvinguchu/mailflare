"use client";

import { useParams } from "next/navigation";
import { ConversationView } from "@/components/conversation/conversation-view";

export default function MessageDetailPage() {
	const params = useParams<{ messageId: string }>();
	return <ConversationView key={params.messageId} messageId={params.messageId} />;
}
