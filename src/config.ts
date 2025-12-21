import * as vscode from 'vscode';

export interface ReviewBoardConfig {
	serverUrl: string;
	username: string;
}

export function getConfig(): ReviewBoardConfig {
	const config = vscode.workspace.getConfiguration('reviewBoard');
	return {
		serverUrl: config.get<string>('serverUrl', ''),
		username: config.get<string>('username', ''),
	};
}

export async function getPassword(secrets: vscode.SecretStorage): Promise<string | undefined> {
	return secrets.get('reviewBoard.password');
}

export async function setPassword(secrets: vscode.SecretStorage, password: string): Promise<void> {
	await secrets.store('reviewBoard.password', password);
}

export async function promptForPassword(secrets: vscode.SecretStorage): Promise<string | undefined> {
	const password = await vscode.window.showInputBox({
		prompt: 'Enter your ReviewBoard password',
		password: true,
	});
	if (password) {
		await setPassword(secrets, password);
	}
	return password;
}

export interface SetupResult {
	serverUrl: string;
	username: string;
	password: string;
}

export async function runSetupWizard(secrets: vscode.SecretStorage): Promise<SetupResult | undefined> {
	const config = vscode.workspace.getConfiguration('reviewBoard');

	const serverUrl = await vscode.window.showInputBox({
		prompt: 'ReviewBoard server URL (must be HTTPS)',
		placeHolder: 'https://reviewboard.example.com',
		value: config.get<string>('serverUrl', ''),
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value.startsWith('https://')) {
				return 'Server URL must use HTTPS';
			}
			return null;
		},
	});
	if (!serverUrl) {
		return undefined;
	}

	const username = await vscode.window.showInputBox({
		prompt: 'ReviewBoard username',
		value: config.get<string>('username', ''),
		ignoreFocusOut: true,
	});
	if (!username) {
		return undefined;
	}

	const password = await vscode.window.showInputBox({
		prompt: 'ReviewBoard password',
		password: true,
		ignoreFocusOut: true,
	});
	if (!password) {
		return undefined;
	}

	await config.update('serverUrl', serverUrl, vscode.ConfigurationTarget.Global);
	await config.update('username', username, vscode.ConfigurationTarget.Global);
	await setPassword(secrets, password);

	return { serverUrl, username, password };
}

export function getAuthHeader(username: string, password: string): string {
	const credentials = `${username}:${password}`;
	return `Basic ${Buffer.from(credentials).toString('base64')}`;
}
