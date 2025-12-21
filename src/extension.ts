import * as vscode from 'vscode';
import { getConfig, getPassword, promptForPassword, runSetupWizard } from './config';
import { ReviewBoardApi } from './reviewBoardApi';
import { ReviewBoardDocumentProvider } from './documentProvider';
import { ReviewBoardTreeDataProvider, ReviewBoardItem, ReviewBoardFileDecorationProvider } from './treeView';
import { applyToChangelist } from './branchValidation';
import { ReviewDetailPanel } from './reviewDetailPanel';

let api: ReviewBoardApi | undefined;

async function initializeApi(secrets: vscode.SecretStorage): Promise<ReviewBoardApi | undefined> {
	const config = getConfig();
	if (!config.serverUrl || !config.username) {
		const result = await runSetupWizard(secrets);
		if (!result) {
			return undefined;
		}
		return new ReviewBoardApi(result.serverUrl, result.username, result.password);
	}

	let password = await getPassword(secrets);
	if (!password) {
		password = await promptForPassword(secrets);
	}
	if (!password) {
		return undefined;
	}

	return new ReviewBoardApi(config.serverUrl, config.username, password);
}

export async function activate(context: vscode.ExtensionContext) {
	api = await initializeApi(context.secrets);

	const getApi = () => api;

	const rbDocProvider = new ReviewBoardDocumentProvider(getApi);
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider('rb-file', rbDocProvider)
	);

	const fileDecorationProvider = new ReviewBoardFileDecorationProvider();
	context.subscriptions.push(vscode.window.registerFileDecorationProvider(fileDecorationProvider));

	const treeDataProvider = new ReviewBoardTreeDataProvider(getApi);
	const treeView = vscode.window.createTreeView('reviewboardExplorer', {
		treeDataProvider,
	});
	context.subscriptions.push(treeView);

	context.subscriptions.push(
		vscode.commands.registerCommand('reviewboard.refresh', () => {
			treeDataProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('reviewboard.openDiff', async (reviewId: number, revisionId: number, fileId: number, fileName: string) => {
			const fileExtension = fileName.split('.').pop() || 'txt';
			const originalUri = vscode.Uri.parse(`rb-file://original/${reviewId}/${revisionId}/${fileId}.${fileExtension}`);
			const patchedUri = vscode.Uri.parse(`rb-file://patched/${reviewId}/${revisionId}/${fileId}.${fileExtension}`);

			await vscode.commands.executeCommand(
				'vscode.diff',
				originalUri,
				patchedUri,
				`${fileName} (Review #${reviewId})`,
				{ preview: true }
			);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('reviewboard.showDetail', async (reviewId: number) => {
			if (!api) {
				vscode.window.showWarningMessage('ReviewBoard: Not authenticated.');
				return;
			}
			await ReviewDetailPanel.show(api, reviewId);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('reviewboard.openReview', async () => {
			const reviewId = await vscode.window.showInputBox({
				prompt: 'Enter Review Request ID',
				placeHolder: '12345',
			});
			if (reviewId) {
				vscode.window.showInformationMessage(`Opening review #${reviewId}`);
				treeDataProvider.refresh();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('reviewboard.applyToChangelist', async (reviewItem?: ReviewBoardItem) => {
			if (!api) {
				vscode.window.showWarningMessage('ReviewBoard: Not authenticated. Set your password first.');
				return;
			}
			await applyToChangelist(api, reviewItem);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('reviewboard.setPassword', async () => {
			await promptForPassword(context.secrets);
			api = await initializeApi(context.secrets);
			treeDataProvider.refresh();
			vscode.window.showInformationMessage('ReviewBoard password updated.');
		})
	);
}

export function deactivate() {}
