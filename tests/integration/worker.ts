const worker = {
	async fetch(): Promise<Response> {
		return new Response(null, { status: 204 });
	},
};

export default worker;
