import * as vscode from 'vscode';

const CREDENTIAL_KEY = 'reviewBoard.credential';
const LEGACY_PASSWORD_KEY = 'reviewBoard.password';

/**
 * A credential is anything that can produce an Authorization header. Adding
 * OAuth2 later means adding a `{ kind: 'oauth2' }` variant plus a refresh hook
 * in `resolveSession`; nothing outside this module needs to change.
 */
export type Credential =
	| { kind: 'token'; token: string }
	| { kind: 'basic'; username: string; password: string };

export interface AuthSession {
	serverUrl: string;
	credential: Credential;
	/** The user the server says we are, not the one the settings claim. */
	username: string;
}

/**
 * Drives the `reviewboard.authState` context key. `loading` is distinct from
 * `signedOut` so the sign-in welcome view does not flash during the startup
 * credential check.
 */
export type AuthState = 'loading' | 'signedIn' | 'signedOut';

export function setAuthState(state: AuthState): void {
	vscode.commands.executeCommand('setContext', 'reviewboard.authState', state);
}

export class AuthenticationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthenticationError';
	}
}

export function authHeader(credential: Credential): string {
	if (credential.kind === 'token') {
		return `token ${credential.token}`;
	}
	const encoded = Buffer.from(`${credential.username}:${credential.password}`).toString('base64');
	return `Basic ${encoded}`;
}

export function normalizeServerUrl(serverUrl: string): string {
	return serverUrl.trim().replace(/\/+$/, '');
}

function tokenPageUrl(serverUrl: string): string {
	return `${normalizeServerUrl(serverUrl)}/account/preferences/#api-tokens`;
}

/**
 * Verifies a credential against /api/session/ and resolves the authenticated
 * username. Review Board answers this endpoint for anonymous callers too, so a
 * 200 alone does not mean the credential was accepted.
 */
export async function resolveSession(serverUrl: string, credential: Credential): Promise<AuthSession> {
	const base = normalizeServerUrl(serverUrl);

	let response: Response;
	try {
		response = await fetch(`${base}/api/session/`, {
			headers: {
				'Authorization': authHeader(credential),
				'Accept': 'application/json',
			},
		});
	} catch (error) {
		throw new Error(`Could not reach Review Board at ${base}: ${error instanceof Error ? error.message : error}`);
	}

	if (response.status === 401 || response.status === 403) {
		throw new AuthenticationError(
			credential.kind === 'token'
				? 'Review Board rejected the API token. It may have been revoked or expired.'
				: 'Review Board rejected the username or password.'
		);
	}
	if (!response.ok) {
		throw new Error(`Review Board returned ${response.status} ${response.statusText} from /api/session/.`);
	}

	const data = await response.json() as {
		session?: { authenticated?: boolean; links?: { user?: { title?: string } } };
	};

	if (!data.session?.authenticated) {
		throw new AuthenticationError('Review Board treated the request as anonymous. The credential was not accepted.');
	}

	const username = data.session.links?.user?.title;
	if (!username) {
		throw new AuthenticationError('Review Board reported an authenticated session but no user.');
	}

	return { serverUrl: base, credential, username };
}

export class AuthManager {
	private session: AuthSession | undefined;
	private signInFlight: Promise<AuthSession | undefined> | undefined;
	private unauthorizedFlight: Promise<void> | undefined;

	private _onDidChangeSession = new vscode.EventEmitter<AuthSession | undefined>();
	readonly onDidChangeSession = this._onDidChangeSession.event;

	constructor(private secrets: vscode.SecretStorage) {}

	getSession(): AuthSession | undefined {
		return this.session;
	}

	/**
	 * Restores and validates a stored credential without prompting. Returns
	 * undefined when there is nothing stored or the stored credential no longer
	 * works; in the latter case the credential is discarded.
	 */
	async restore(): Promise<AuthSession | undefined> {
		const serverUrl = getServerUrl();
		const credential = await this.loadCredential();
		if (!serverUrl || !credential) {
			this.setSession(undefined);
			return undefined;
		}

		try {
			this.setSession(await resolveSession(serverUrl, credential));
		} catch (error) {
			this.setSession(undefined);
			if (error instanceof AuthenticationError) {
				await this.clearCredential();
				vscode.window.showWarningMessage(`Review Board: ${error.message} Sign in again to reconnect.`);
			} else {
				// Server unreachable, offline, etc. Keep the credential — it is
				// probably still good — but come up signed out.
				vscode.window.showWarningMessage(`Review Board: ${error instanceof Error ? error.message : error}`);
			}
			return undefined;
		}

		return this.session;
	}

	/** Interactive sign-in. Concurrent callers share one prompt. */
	async signIn(): Promise<AuthSession | undefined> {
		if (this.signInFlight) {
			return this.signInFlight;
		}
		this.signInFlight = this.runSignIn().finally(() => {
			this.signInFlight = undefined;
		});
		return this.signInFlight;
	}

	private async runSignIn(): Promise<AuthSession | undefined> {
		const serverUrl = await promptForServerUrl();
		if (!serverUrl) {
			return undefined;
		}

		// Re-prompt on a rejected credential rather than dumping the user back
		// to the tree with no idea what went wrong.
		for (;;) {
			const credential = await promptForCredential(serverUrl);
			if (!credential) {
				return undefined;
			}

			try {
				const session = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Signing in to Review Board…' },
					() => resolveSession(serverUrl, credential),
				);

				await vscode.workspace.getConfiguration('reviewBoard')
					.update('serverUrl', session.serverUrl, vscode.ConfigurationTarget.Global);
				await this.storeCredential(session.credential);
				this.setSession(session);

				vscode.window.showInformationMessage(`Review Board: signed in as ${session.username}.`);
				return session;
			} catch (error) {
				if (!(error instanceof AuthenticationError)) {
					vscode.window.showErrorMessage(`Review Board: ${error instanceof Error ? error.message : error}`);
					return undefined;
				}
				const retry = await vscode.window.showErrorMessage(error.message, 'Try Again', 'Cancel');
				if (retry !== 'Try Again') {
					return undefined;
				}
			}
		}
	}

	async signOut(): Promise<void> {
		await this.clearCredential();
		this.setSession(undefined);
	}

	/**
	 * Called when the API sees a 401. Drops the stored credential immediately so
	 * we stop replaying a bad password against servers that lock accounts out,
	 * then offers a single re-auth prompt no matter how many requests failed.
	 */
	async handleUnauthorized(): Promise<void> {
		if (this.unauthorizedFlight) {
			return this.unauthorizedFlight;
		}
		if (!this.session) {
			return;
		}

		this.unauthorizedFlight = (async () => {
			const wasToken = this.session?.credential.kind === 'token';
			await this.signOut();

			const detail = wasToken
				? 'Your API token was rejected and has been cleared. It may have been revoked or expired.'
				: 'Your password was rejected and has been cleared.';
			const choice = await vscode.window.showErrorMessage(`Review Board: ${detail}`, 'Sign In');
			if (choice === 'Sign In') {
				await this.signIn();
			}
		})().finally(() => {
			this.unauthorizedFlight = undefined;
		});

		return this.unauthorizedFlight;
	}

	private setSession(session: AuthSession | undefined): void {
		this.session = session;
		setAuthState(session ? 'signedIn' : 'signedOut');
		this._onDidChangeSession.fire(session);
	}

	private async loadCredential(): Promise<Credential | undefined> {
		const raw = await this.secrets.get(CREDENTIAL_KEY);
		if (!raw) {
			return undefined;
		}
		try {
			return JSON.parse(raw) as Credential;
		} catch {
			await this.secrets.delete(CREDENTIAL_KEY);
			return undefined;
		}
	}

	private async storeCredential(credential: Credential): Promise<void> {
		await this.secrets.store(CREDENTIAL_KEY, JSON.stringify(credential));
	}

	private async clearCredential(): Promise<void> {
		await this.secrets.delete(CREDENTIAL_KEY);
		await this.secrets.delete(LEGACY_PASSWORD_KEY);
	}
}

function getServerUrl(): string {
	return normalizeServerUrl(
		vscode.workspace.getConfiguration('reviewBoard').get<string>('serverUrl', '')
	);
}

async function promptForServerUrl(): Promise<string | undefined> {
	const serverUrl = await vscode.window.showInputBox({
		title: 'Review Board: Sign In (1 of 2)',
		prompt: 'Review Board server URL',
		placeHolder: 'https://reviewboard.example.com',
		value: getServerUrl(),
		ignoreFocusOut: true,
		validateInput: (value) => {
			const trimmed = value.trim();
			if (!trimmed) {
				return 'A server URL is required';
			}
			if (!trimmed.startsWith('https://')) {
				return 'Server URL must use HTTPS — credentials are sent on every request';
			}
			try {
				new URL(trimmed);
			} catch {
				return 'Not a valid URL';
			}
			return null;
		},
	});
	return serverUrl ? normalizeServerUrl(serverUrl) : undefined;
}

async function promptForCredential(serverUrl: string): Promise<Credential | undefined> {
	const TOKEN = 'API Token';
	const PASSWORD = 'Username & Password';

	const method = await vscode.window.showQuickPick(
		[
			{
				label: TOKEN,
				description: 'Recommended',
				detail: 'Revocable from Review Board, can be scoped read-only, and never exposes your account password.',
			},
			{
				label: PASSWORD,
				detail: 'Sends your Review Board password with every request via HTTP Basic auth.',
			},
		],
		{
			title: 'Review Board: Sign In (2 of 2)',
			placeHolder: 'How do you want to authenticate?',
			ignoreFocusOut: true,
		},
	);
	if (!method) {
		return undefined;
	}

	if (method.label === TOKEN) {
		const token = await promptForToken(serverUrl);
		return token ? { kind: 'token', token } : undefined;
	}

	const username = await vscode.window.showInputBox({
		title: 'Review Board: Sign In',
		prompt: 'Review Board username',
		ignoreFocusOut: true,
	});
	if (!username) {
		return undefined;
	}

	const password = await vscode.window.showInputBox({
		title: 'Review Board: Sign In',
		prompt: `Password for ${username}`,
		password: true,
		ignoreFocusOut: true,
	});
	if (!password) {
		return undefined;
	}

	return { kind: 'basic', username, password };
}

/** Input box with a button that opens the server's API token page. */
function promptForToken(serverUrl: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const input = vscode.window.createInputBox();
		const openTokenPage: vscode.QuickInputButton = {
			iconPath: new vscode.ThemeIcon('link-external'),
			tooltip: 'Generate a token on Review Board',
		};

		input.title = 'Review Board: Sign In';
		input.prompt = 'Paste an API token (Account Settings → API Tokens on your Review Board server)';
		input.password = true;
		input.ignoreFocusOut = true;
		input.buttons = [openTokenPage];

		let accepted: string | undefined;

		input.onDidTriggerButton((button) => {
			if (button === openTokenPage) {
				vscode.env.openExternal(vscode.Uri.parse(tokenPageUrl(serverUrl)));
			}
		});
		input.onDidAccept(() => {
			const value = input.value.trim();
			if (!value) {
				input.validationMessage = 'A token is required';
				return;
			}
			accepted = value;
			input.hide();
		});
		input.onDidHide(() => {
			input.dispose();
			resolve(accepted);
		});

		input.show();
	});
}
