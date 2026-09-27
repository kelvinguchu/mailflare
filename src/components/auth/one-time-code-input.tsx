"use client";

import type { Ref } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@/components/ui/input-otp";

const SLOT_CLASS =
	"size-11 rounded-lg border border-input bg-white text-lg font-medium text-neutral-900 shadow-none first:rounded-lg first:border-l last:rounded-lg data-[active=true]:border-primary data-[active=true]:ring-3 data-[active=true]:ring-primary/15 sm:size-12";

/** A six-digit authenticator code, split 3 + 3 the way authenticator apps display it. */
export function OneTimeCodeInput({
	id,
	name = "code",
	value,
	onChange,
	onComplete,
	invalid = false,
	describedBy,
	disabled,
	inputRef,
}: Readonly<{
	id: string;
	name?: string;
	value: string;
	onChange: (value: string) => void;
	onComplete?: (value: string) => void;
	invalid?: boolean;
	describedBy?: string;
	disabled?: boolean;
	inputRef?: Ref<HTMLInputElement>;
}>) {
	const groups = [
		[0, 1, 2],
		[3, 4, 5],
	];
	return (
		<InputOTP
			ref={inputRef}
			id={id}
			name={name}
			maxLength={6}
			pattern={REGEXP_ONLY_DIGITS}
			// Codes are often copied as "123 456" or "123-456".
			pasteTransformer={(pasted) => pasted.replace(/\D/g, "")}
			pushPasswordManagerStrategy="none"
			inputMode="numeric"
			autoComplete="one-time-code"
			value={value}
			onChange={onChange}
			onComplete={onComplete}
			disabled={disabled}
			aria-invalid={invalid || undefined}
			aria-describedby={describedBy}
			containerClassName="gap-2 sm:gap-3"
		>
			{groups.map((group, index) => (
				<div key={group[0]} className="contents">
					{index > 0 && <InputOTPSeparator />}
					<InputOTPGroup className="gap-2">
						{group.map((slot) => (
							<InputOTPSlot
								key={slot}
								index={slot}
								aria-invalid={invalid || undefined}
								className={SLOT_CLASS}
							/>
						))}
					</InputOTPGroup>
				</div>
			))}
		</InputOTP>
	);
}
