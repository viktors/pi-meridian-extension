const assert = require("node:assert/strict");
const test = require("node:test");
const { createJiti } = require("@mariozechner/jiti");

const jiti = createJiti(__filename);

async function loadExtension() {
	const mod = await jiti.import("../extensions/index.ts");
	return mod.default;
}

function createMockPi() {
	const pi = {
		providers: new Map(),
		commands: new Map(),
		handlers: new Map(),
		registerProvider(name, config) {
			this.providers.set(name, config);
		},
		registerCommand(name, config) {
			this.commands.set(name, config);
		},
		on(event, handler) {
			this.handlers.set(event, handler);
		},
	};
	return pi;
}

async function registerWithEnv(env = {}) {
	const previous = {
		MERIDIAN_API_KEY: process.env.MERIDIAN_API_KEY,
		MERIDIAN_PROFILE: process.env.MERIDIAN_PROFILE,
		MERIDIAN_BASE_URL: process.env.MERIDIAN_BASE_URL,
	};
	for (const key of Object.keys(previous)) delete process.env[key];
	Object.assign(process.env, env);
	try {
		const extension = await loadExtension();
		const pi = createMockPi();
		await extension(pi);
		return pi;
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("provider uses MERIDIAN_API_KEY and MERIDIAN_PROFILE when configured", async () => {
	const pi = await registerWithEnv({
		MERIDIAN_API_KEY: "secret-key",
		MERIDIAN_PROFILE: "work",
		MERIDIAN_BASE_URL: "http://127.0.0.1:1",
	});

	const provider = pi.providers.get("meridian");
	assert.equal(provider.apiKey, "secret-key");
	assert.equal(provider.authHeader, true);
	assert.deepEqual(provider.headers, {
		"x-meridian-agent": "pi",
		"x-meridian-profile": "work",
	});
});

test("provider defaults to placeholder api key and omits blank profile", async () => {
	const pi = await registerWithEnv({
		MERIDIAN_PROFILE: "   ",
		MERIDIAN_BASE_URL: "http://127.0.0.1:1",
	});

	const provider = pi.providers.get("meridian");
	assert.equal(provider.apiKey, "meridian");
	assert.deepEqual(provider.headers, { "x-meridian-agent": "pi" });
});

test("provider discovers models from /v1/models and maps capabilities", async (t) => {
	const originalFetch = global.fetch;
	t.after(() => {
		global.fetch = originalFetch;
	});

	global.fetch = async (url) => {
		const u = String(url);
		if (u.endsWith("/v1/models")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					object: "list",
					data: [
						{
							id: "claude-fable-5",
							display_name: "Claude Fable 5",
							context_window: 200000,
							capabilities: {
								thinking: { supported: true },
								image_input: { supported: true },
								pdf_input: { supported: true },
							},
						},
						{
							id: "claude-opus-4-8",
							display_name: "Claude Opus 4.8",
							context_window: 200000,
							capabilities: {
								thinking: { supported: true },
								image_input: { supported: true },
							},
						},
					],
				}),
			};
		}
		throw new Error(`unexpected fetch ${u}`);
	};

	const pi = await registerWithEnv();
	const provider = pi.providers.get("meridian");
	const ids = provider.models.map((m) => m.id);

	// Discovered entries come first; static-floor gaps append after.
	assert.equal(ids[0], "claude-fable-5");
	assert.equal(ids[1], "claude-opus-4-8");
	assert.ok(ids.includes("claude-opus-5"));

	const fable = provider.models.find((m) => m.id === "claude-fable-5");
	assert.equal(fable.name, "Claude Fable 5 (Meridian)");
	assert.equal(fable.reasoning, true);
	assert.deepEqual(fable.input, ["text", "image"]);
	assert.equal(fable.contextWindow, 200000);
	assert.equal(fable.maxTokens, 128000); // fable family fallback
	assert.deepEqual(fable.cost, {
		input: 10,
		output: 50,
		cacheRead: 1,
		cacheWrite: 12.5,
	});

	const opus48 = provider.models.find((m) => m.id === "claude-opus-4-8");
	assert.equal(opus48.maxTokens, 32768); // opus family fallback
	assert.deepEqual(opus48.cost, {
		input: 15,
		output: 75,
		cacheRead: 1.5,
		cacheWrite: 18.75,
	});
});

test("provider maps discovered claude-opus-5 with id overrides", async (t) => {
	const originalFetch = global.fetch;
	t.after(() => {
		global.fetch = originalFetch;
	});

	global.fetch = async (url) => {
		const u = String(url);
		if (u.endsWith("/v1/models")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					object: "list",
					data: [
						{
							id: "claude-opus-5",
							display_name: "Claude Opus 5",
							context_window: 1000000,
							capabilities: {
								thinking: { supported: true },
								image_input: { supported: true },
							},
						},
					],
				}),
			};
		}
		throw new Error(`unexpected fetch ${u}`);
	};

	const pi = await registerWithEnv();
	const opus5 = pi.providers
		.get("meridian")
		.models.find((m) => m.id === "claude-opus-5");
	assert.equal(opus5.name, "Claude Opus 5 (Meridian)");
	assert.equal(opus5.reasoning, true);
	assert.equal(opus5.contextWindow, 1000000);
	assert.equal(opus5.maxTokens, 128000);
	assert.deepEqual(opus5.cost, {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
	});
});

test("provider falls back to static catalog when Meridian is unreachable", async (t) => {
	const originalFetch = global.fetch;
	t.after(() => {
		global.fetch = originalFetch;
	});

	global.fetch = async () => {
		throw new Error("connection refused");
	};

	const pi = await registerWithEnv({
		MERIDIAN_BASE_URL: "http://127.0.0.1:1",
	});
	const provider = pi.providers.get("meridian");

	assert.deepEqual(
		provider.models.map((m) => m.id).sort(),
		[
			"claude-fable-5",
			"claude-haiku-4-5",
			"claude-opus-4-6",
			"claude-opus-4-7",
			"claude-opus-4-8",
			"claude-opus-5",
			"claude-sonnet-4-6",
			"claude-sonnet-5",
		],
	);

	const opus5 = provider.models.find((m) => m.id === "claude-opus-5");
	assert.equal(opus5.maxTokens, 128000);
	assert.deepEqual(opus5.cost, {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
	});
});

test("provider keeps static floor models missing from /v1/models", async (t) => {
	const originalFetch = global.fetch;
	t.after(() => {
		global.fetch = originalFetch;
	});

	// Live Meridian (as of 1.56.x) still omits claude-opus-5 from /v1/models
	// even though explicitModelPin routes it. Discovery must union the static floor.
	global.fetch = async (url) => {
		const u = String(url);
		if (u.endsWith("/v1/models")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					object: "list",
					data: [
						{
							id: "claude-opus-4-8",
							display_name: "Claude Opus 4.8",
							context_window: 200000,
							capabilities: {
								thinking: { supported: true },
								image_input: { supported: true },
							},
						},
					],
				}),
			};
		}
		throw new Error(`unexpected fetch ${u}`);
	};

	const pi = await registerWithEnv();
	const ids = pi.providers.get("meridian").models.map((m) => m.id);
	assert.ok(ids.includes("claude-opus-4-8"));
	assert.ok(ids.includes("claude-opus-5"));

	const opus5 = pi.providers
		.get("meridian")
		.models.find((m) => m.id === "claude-opus-5");
	assert.equal(opus5.name, "Claude Opus 5 (Meridian)");
	assert.equal(opus5.maxTokens, 128000);
	assert.deepEqual(opus5.cost, {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
	});
});

test("/meridian health sends configured auth and profile headers", async (t) => {
	const originalFetch = global.fetch;
	const requests = [];
	t.after(() => {
		global.fetch = originalFetch;
	});

	global.fetch = async (url, init) => {
		requests.push({ url, init });
		return {
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({
					status: "healthy",
					mode: "sdk",
					auth: { loggedIn: false },
				}),
		};
	};

	const pi = await registerWithEnv({
		MERIDIAN_API_KEY: "secret-key",
		MERIDIAN_PROFILE: "work",
	});
	const command = pi.commands.get("meridian");
	await command.handler("", {
		signal: new AbortController().signal,
		ui: { notify() {} },
	});

	// The factory also fetches /v1/models during discovery; isolate the
	// /meridian health request (the command under test) for header assertions.
	const healthRequests = requests.filter((r) =>
		String(r.url).endsWith("/health"),
	);
	const healthRequest = healthRequests[healthRequests.length - 1];
	assert.ok(healthRequest, "expected a /health request");
	assert.equal(healthRequest.init.headers.Authorization, "Bearer secret-key");
	assert.equal(healthRequest.init.headers["x-meridian-agent"], "pi");
	assert.equal(healthRequest.init.headers["x-meridian-profile"], "work");
});

test("/meridian health displays runtime version even when not logged in", async (t) => {
	const originalFetch = global.fetch;
	t.after(() => {
		global.fetch = originalFetch;
	});

	global.fetch = async () => ({
		ok: true,
		status: 200,
		text: async () =>
			JSON.stringify({
				status: "healthy",
				version: "1.41.1",
				mode: "sdk",
				auth: { loggedIn: false },
			}),
	});

	const pi = await registerWithEnv();
	const command = pi.commands.get("meridian");
	const notifications = [];
	await command.handler("", {
		signal: new AbortController().signal,
		ui: {
			notify(message, level) {
				notifications.push({ message, level });
			},
		},
	});

	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].level, "warning");
	assert.match(notifications[0].message, /Version: 1\.41\.1/);
	assert.match(notifications[0].message, /Mode: sdk/);
});

test("/meridian health displays runtime version when available", async (t) => {
	const originalFetch = global.fetch;
	t.after(() => {
		global.fetch = originalFetch;
	});

	global.fetch = async () => ({
		ok: true,
		status: 200,
		text: async () =>
			JSON.stringify({
				status: "healthy",
				version: "1.41.1",
				mode: "sdk",
				auth: {
					loggedIn: true,
					email: "user@example.com",
					subscriptionType: "max",
				},
			}),
	});

	const pi = await registerWithEnv();
	const command = pi.commands.get("meridian");
	const notifications = [];
	await command.handler("", {
		signal: new AbortController().signal,
		ui: {
			notify(message, level) {
				notifications.push({ message, level });
			},
		},
	});

	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].level, "info");
	assert.match(notifications[0].message, /Version: 1\.41\.1/);
});
