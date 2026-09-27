import { addressParser, type Address, type Mailbox } from "postal-mime";
import { formatEmailAddress } from "@/lib/email/address";
import { parseAddress } from "@/lib/utils";

export const MAX_EMAIL_RECIPIENTS = 50;

export type NormalizedRecipient = {
	address: string;
	name: string | null;
	formatted: string;
};

export type NormalizedRecipients = {
	to: NormalizedRecipient[];
	cc: NormalizedRecipient[];
	toHeader: string;
	ccHeader: string;
};

export class RecipientValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RecipientValidationError";
	}
}

export function parseRecipientList(value: string | null | undefined): NormalizedRecipient[] {
	const input = value?.trim();
	if (!input) return [];

	let parsed: Address[];
	try {
		parsed = addressParser(input.replace(/;/g, ","), { flatten: true });
	} catch {
		throw new RecipientValidationError("Recipients contain an invalid email address");
	}

	const mailboxes = flattenAddresses(parsed);
	if (mailboxes.length === 0) {
		throw new RecipientValidationError("Recipients contain an invalid email address");
	}

	return mailboxes.map((mailbox) => {
		const address = mailbox.address.trim();
		if (
			address.length > 320 ||
			/[\r\n\0]/.test(address) ||
			!parseAddress(address) ||
			!address.includes(".", address.lastIndexOf("@"))
		) {
			throw new RecipientValidationError(`Invalid recipient: ${address || "empty address"}`);
		}
		const name = mailbox.name?.trim() || null;
		return {
			address: address.toLowerCase(),
			name,
			formatted: formatEmailAddress(address.toLowerCase(), name),
		};
	});
}

export function normalizeRecipients(input: {
	to: string;
	cc?: string | null;
}): NormalizedRecipients {
	const seen = new Set<string>();
	const dedupe = (recipients: NormalizedRecipient[]) =>
		recipients.filter((recipient) => {
			const key = recipient.address.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

	const to = dedupe(parseRecipientList(input.to));
	if (to.length === 0) throw new RecipientValidationError("Add at least one To recipient");
	const cc = dedupe(parseRecipientList(input.cc));
	if (to.length + cc.length > MAX_EMAIL_RECIPIENTS) {
		throw new RecipientValidationError(
			`To and Cc can contain at most ${MAX_EMAIL_RECIPIENTS} recipients combined`,
		);
	}

	return {
		to,
		cc,
		toHeader: formatRecipientList(to),
		ccHeader: formatRecipientList(cc),
	};
}

export function formatRecipientList(recipients: NormalizedRecipient[]): string {
	return recipients.map((recipient) => recipient.formatted).join(", ");
}

export function flattenAddresses(addresses: Address[] | undefined): Mailbox[] {
	return (addresses ?? []).flatMap((address) =>
		"address" in address ? (address.address ? [address] : []) : (address.group ?? []),
	);
}
