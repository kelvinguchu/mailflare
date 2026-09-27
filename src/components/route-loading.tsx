import { Spinner } from "@/components/ui/spinner";

/**
 * Page-to-page loading state. It fills only the content area it replaces, so the sidebar and
 * header stay put and the spinner sits centred in the space that is actually loading.
 */
export function RouteLoading() {
	return (
		<div data-route-loading className="flex h-full min-h-[50vh] w-full items-center justify-center">
			<Spinner className="size-7 text-primary/70 motion-reduce:animate-none" />
		</div>
	);
}
