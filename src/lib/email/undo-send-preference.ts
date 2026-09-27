import { DEFAULT_UNDO_SEND_DELAY_SECONDS, UNDO_SEND_DELAY_SECONDS } from "./undo-send";

const STORAGE_KEY = "mailflare:undo-send-delay-seconds";

export type UndoSendDelay = (typeof UNDO_SEND_DELAY_SECONDS)[number];

function isUndoSendDelay(value: number): value is UndoSendDelay {
	return UNDO_SEND_DELAY_SECONDS.some((seconds) => seconds === value);
}

/** The Undo Send window chosen in Settings; storage can be unavailable, so fall back quietly. */
export function getUndoSendDelayPreference(): UndoSendDelay {
	try {
		const stored = Number(window.localStorage.getItem(STORAGE_KEY));
		if (isUndoSendDelay(stored)) return stored;
	} catch {
		// Private windows and blocked storage use the default.
	}
	return DEFAULT_UNDO_SEND_DELAY_SECONDS;
}

export function setUndoSendDelayPreference(seconds: UndoSendDelay): boolean {
	try {
		window.localStorage.setItem(STORAGE_KEY, String(seconds));
		return true;
	} catch {
		return false;
	}
}
