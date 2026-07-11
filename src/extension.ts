import * as vscode from 'vscode';
import { AuthManager, AuthSession, setAuthState } from './auth';
import { ReviewBoardApi } from './reviewBoardApi';
import { ReviewBoardDocumentProvider } from './documentProvider';
import { ReviewBoardTreeDataProvider, ReviewBoardItem, ReviewBoardFileDecorationProvider } from './treeView';
import { applyToChangelist } from './branchValidation';
import { ReviewDetailPanel } from './reviewDetailPanel';

let api: ReviewBoardApi | undefined;

export async function activate(context: vscode.ExtensionContext) {
	setAuthState('loading');

	const auth = new AuthManager(context.secrets);

	const getApi = () => api;

	/**
	 * Requires an authenticated API client, offering sign-in if there is none.
	 * Commands call this instead of failing with "not authenticated".
	 */
	const requireApi = async (): Promise<ReviewBoardApi | undefined> => {
		if (api) {
			return api;
		}
		await auth.signIn();
		return api;
	};

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

	// The API client is a pure function of the session: rebuilt on sign-in,
	// dropped on sign-out or a rejected credential.
	const onSession = (session: AuthSession | undefined) => {
		api = session
			? new ReviewBoardApi(session, () => void auth.handleUnauthorized())
			: undefined;
		treeDataProvider.refresh();
	};
	context.subscriptions.push(auth.onDidChangeSession(onSession));

	// Validate stored credentials in the background. Activation never blocks on
	// a credential prompt, but the tree does wait on this so it shows a spinner
	// rather than an empty "signed out" state while the check is in flight.
	treeDataProvider.setReady(auth.restore().catch(() => undefined));

	context.subscriptions.push(
		vscode.commands.registerCommand('reviewboard.signIn', async () => {
			await auth.signIn();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('reviewboard.signOut', async () => {
			if (!auth.getSession()) {
				vscode.window.showInformationMessage('Review Board: not signed in.');
				return;
			}
			await auth.signOut();
			vscode.window.showInformationMessage('Review Board: signed out and credentials cleared.');
		})
	);

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
			const client = await requireApi();
			if (!client) {
				return;
			}
			await ReviewDetailPanel.show(client, reviewId);
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
			const client = await requireApi();
			if (!client) {
				return;
			}
			await applyToChangelist(client, reviewItem);
		})
	);
}

export function deactivate() {}
