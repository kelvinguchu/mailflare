export type WranglerEnvironment = Record<string, unknown>;

export function checkEnvironmentIsolation(configPath?: URL): {
	staging: WranglerEnvironment;
	production: WranglerEnvironment;
};
