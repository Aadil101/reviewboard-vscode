import * as vscode from 'vscode';
import { ReviewBoardApi } from './reviewBoardApi';

export class ReviewBoardDocumentProvider implements vscode.TextDocumentContentProvider {
	private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this._onDidChange.event;

	constructor(private getApi: () => ReviewBoardApi | undefined) {}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const api = this.getApi();
		if (!api) {
			return '// Review Board credentials not configured. Use "Review Board: Set Password" command.';
		}

		const version = uri.authority === 'original' ? 'original-file' : 'patched-file';
		const pathParts = uri.path.split('/').filter(Boolean);

		const fileIdWithExt = pathParts[2];
		const fileId = parseInt(fileIdWithExt.split('.')[0]);
		const reviewId = parseInt(pathParts[0]);
		const revisionId = parseInt(pathParts[1]);

		try {
			return await api.getFileContent(reviewId, revisionId, fileId, version);
		} catch (error) {
			vscode.window.showErrorMessage(`Error fetching Review Board file: ${error}`);
			return `// Error loading file: ${error}`;
		}
	}

	refresh(uri: vscode.Uri) {
		this._onDidChange.fire(uri);
	}
}
