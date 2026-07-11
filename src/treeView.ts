import * as vscode from 'vscode';
import { AuthenticationError } from './auth';
import { ReviewBoardApi, DiffFile } from './reviewBoardApi';

const RB_TREE_SCHEME = 'rb-tree';

export class ReviewBoardFileDecorationProvider implements vscode.FileDecorationProvider {
	private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
	readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (uri.scheme !== RB_TREE_SCHEME) {
			return undefined;
		}

		const status = uri.query;
		switch (status) {
			case 'added':
				return { badge: 'A', color: new vscode.ThemeColor('gitDecoration.addedResourceForeground'), tooltip: 'Added' };
			case 'modified':
				return { badge: 'E', color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'), tooltip: 'Edited' };
			case 'deleted':
				return { badge: 'D', color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'), tooltip: 'Deleted' };
			case 'moved':
				return { badge: 'M', color: new vscode.ThemeColor('gitDecoration.renamedResourceForeground'), tooltip: 'Moved' };
			default:
				return undefined;
		}
	}
}

export function getFileStatus(file: DiffFile): 'added' | 'modified' | 'deleted' | 'moved' {
	const EMPTY_SHA1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
	if (file.extra_data?.patched_sha1 === EMPTY_SHA1 ||
		(file.extra_data?.insert_count === 0 && file.extra_data?.equal_count === 0 && (file.extra_data?.delete_count ?? 0) > 0)) {
		return 'deleted';
	}

	if (file.status === 'moved' ||
		(file.source_file && file.dest_file && file.source_file !== file.dest_file)) {
		return 'moved';
	}

	if (file.source_revision === 'PRE-CREATION' && file.status === 'modified') {
		return 'added';
	}

	if (file.source_revision !== 'PRE-CREATION' && file.status === 'modified') {
		return 'modified';
	}

	return 'modified';
}

export class ReviewBoardTreeDataProvider implements vscode.TreeDataProvider<ReviewBoardItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<ReviewBoardItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private revisionCache = new Map<number, number>();
	private ready: Promise<unknown> = Promise.resolve();

	constructor(private getApi: () => ReviewBoardApi | undefined) {}

	// Blocks the tree until the startup credential check settles.
	setReady(ready: Promise<unknown>): void {
		this.ready = ready;
	}

	refresh(): void {
		this.revisionCache.clear();
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ReviewBoardItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ReviewBoardItem): Promise<ReviewBoardItem[]> {
		await this.ready;

		const api = this.getApi();
		if (!api) {
			// Empty, not a message item — an empty tree is what lets the
			// sign-in welcome view render.
			return [];
		}

		if (!element) {
			return [
				new ReviewBoardItem('My Reviews', 'category', vscode.TreeItemCollapsibleState.Expanded, undefined, undefined, undefined, undefined, undefined, undefined, 'outgoing'),
				new ReviewBoardItem('Incoming Reviews', 'category', vscode.TreeItemCollapsibleState.Expanded, undefined, undefined, undefined, undefined, undefined, undefined, 'incoming'),
			];
		}

		if (element.type === 'category') {
			return this.getReviewRequests(api, element.category!);
		}

		if (element.type === 'review') {
			return this.getFilesInReview(api, element.reviewId!);
		}

		return [];
	}

	private async getReviewRequests(api: ReviewBoardApi, category: 'outgoing' | 'incoming'): Promise<ReviewBoardItem[]> {
		try {
			const reviews = category === 'outgoing'
				? await api.getOpenReviewRequests()
				: await api.getIncomingReviewRequests();

			if (reviews.length === 0) {
				return [new ReviewBoardItem('No reviews found', 'message', vscode.TreeItemCollapsibleState.None)];
			}

			return reviews.map((rr) =>
				new ReviewBoardItem(
					`#${rr.id}: ${rr.summary}`,
					'review',
					vscode.TreeItemCollapsibleState.Collapsed,
					rr.id,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					rr.submitter,
					rr.last_updated,
					rr.ship_it_count,
					rr.issue_open_count,
				)
			);
		} catch (error) {
			if (error instanceof AuthenticationError) {
				// AuthManager already cleared the credential and prompted.
				return [];
			}
			vscode.window.showErrorMessage(`Error fetching review requests: ${error}`);
			return [];
		}
	}

	private async getFilesInReview(api: ReviewBoardApi, reviewId: number): Promise<ReviewBoardItem[]> {
		try {
			let latestRevision = this.revisionCache.get(reviewId);
			if (latestRevision === undefined) {
				latestRevision = await api.getLatestRevisionId(reviewId);
				this.revisionCache.set(reviewId, latestRevision);
			}

			const files = await api.getFilesInDiff(reviewId, latestRevision);
			files.sort((a, b) => (a.dest_file || a.source_file).localeCompare(b.dest_file || b.source_file));

			return files.map((file) => {
				const fullPath = file.dest_file || file.source_file;
				const basename = fullPath.split('/').pop() || fullPath;
				const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
				const fileStatus = getFileStatus(file);

				return new ReviewBoardItem(
					basename,
					'file',
					vscode.TreeItemCollapsibleState.None,
					reviewId,
					file.id,
					fullPath,
					latestRevision,
					dirPath,
					fileStatus,
				);
			});
		} catch (error) {
			if (error instanceof AuthenticationError) {
				return [];
			}
			vscode.window.showErrorMessage(`Error fetching files: ${error}`);
			return [];
		}
	}
}

export class ReviewBoardItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly type: 'review' | 'file' | 'message' | 'category',
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly reviewId?: number,
		public readonly fileId?: number,
		public readonly fullPath?: string,
		public readonly revisionId?: number,
		public readonly dirPath?: string,
		public readonly fileStatus?: 'added' | 'modified' | 'deleted' | 'moved',
		public readonly category?: 'outgoing' | 'incoming',
		public readonly submitter?: string,
		public readonly lastUpdated?: string,
		public readonly shipItCount?: number,
		public readonly issueOpenCount?: number,
	) {
		super(label, collapsibleState);

		if (type === 'category') {
			this.iconPath = category === 'incoming'
				? new vscode.ThemeIcon('inbox')
				: new vscode.ThemeIcon('git-pull-request');
			this.contextValue = `category-${category}`;
		} else if (type === 'review') {
			this.contextValue = type;
			this.command = {
				command: 'reviewboard.showDetail',
				title: 'Show Review Details',
				arguments: [this.reviewId],
			};

			const meta: string[] = [];
			if (submitter) { meta.push(submitter); }
			if (lastUpdated) { meta.push(formatRelativeDate(lastUpdated)); }
			this.description = meta.join(' • ');

			if (shipItCount && shipItCount > 0) {
				this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
			} else if (issueOpenCount && issueOpenCount > 0) {
				this.iconPath = new vscode.ThemeIcon('issues', new vscode.ThemeColor('editorWarning.foreground'));
			} else {
				this.iconPath = new vscode.ThemeIcon('git-pull-request');
			}

			const tooltipParts = [label as string];
			if (submitter) { tooltipParts.push(`Owner: ${submitter}`); }
			if (shipItCount) { tooltipParts.push(`Ship Its: ${shipItCount}`); }
			if (issueOpenCount) { tooltipParts.push(`Open Issues: ${issueOpenCount}`); }
			if (lastUpdated) { tooltipParts.push(`Updated: ${formatRelativeDate(lastUpdated)}`); }
			this.tooltip = tooltipParts.join('\n');
		} else if (type === 'file') {
			const filePath = (fullPath || label).replace(/^\/+/, '');
			this.resourceUri = vscode.Uri.from({
				scheme: RB_TREE_SCHEME,
				path: `/${filePath}`,
				query: fileStatus || 'modified',
			});
			this.command = {
				command: 'reviewboard.openDiff',
				title: 'Open Diff',
				arguments: [this.reviewId, this.revisionId, this.fileId, this.fullPath || this.label],
			};
			this.tooltip = this.fullPath;
			this.description = dirPath;
			this.contextValue = type;
		} else {
			this.contextValue = type;
		}
	}
}

function formatRelativeDate(isoDate: string): string {
	try {
		const then = new Date(isoDate).getTime();
		const now = Date.now();
		const diffMs = now - then;
		if (diffMs < 0) { return 'just now'; }

		const minutes = Math.floor(diffMs / 60000);
		if (minutes < 1) { return 'just now'; }
		if (minutes < 60) { return `${minutes} minute${minutes > 1 ? 's' : ''} ago`; }

		const hours = Math.floor(minutes / 60);
		if (hours < 24) { return `${hours} hour${hours > 1 ? 's' : ''} ago`; }

		const days = Math.floor(hours / 24);
		if (days < 7) { return `${days} day${days > 1 ? 's' : ''} ago`; }

		const weeks = Math.floor(days / 7);
		if (weeks < 5) { return `${weeks} week${weeks > 1 ? 's' : ''} ago`; }

		const months = Math.floor(days / 30);
		if (months < 12) { return `${months} month${months > 1 ? 's' : ''} ago`; }

		const years = Math.floor(days / 365);
		return `${years} year${years > 1 ? 's' : ''} ago`;
	} catch {
		return isoDate;
	}
}
