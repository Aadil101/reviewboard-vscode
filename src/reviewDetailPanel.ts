import * as vscode from 'vscode';
import { marked, Renderer } from 'marked';
import { ReviewBoardApi, ReviewRequestDetail } from './reviewBoardApi';

export class ReviewDetailPanel {
	private static panels = new Map<number, ReviewDetailPanel>();
	private panel: vscode.WebviewPanel;
	private disposed = false;
	private serverUrl = '';

	static async show(api: ReviewBoardApi, reviewId: number) {
		const existing = ReviewDetailPanel.panels.get(reviewId);
		if (existing && !existing.disposed) {
			existing.panel.reveal(vscode.ViewColumn.One);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'reviewDetail',
			`Review #${reviewId}`,
			vscode.ViewColumn.One,
			{ enableScripts: false },
		);

		const instance = new ReviewDetailPanel(panel, api, reviewId);
		ReviewDetailPanel.panels.set(reviewId, instance);
		await instance.load();
	}

	private constructor(panel: vscode.WebviewPanel, private api: ReviewBoardApi, private reviewId: number) {
		this.panel = panel;
		this.panel.onDidDispose(() => {
			this.disposed = true;
			ReviewDetailPanel.panels.delete(this.reviewId);
		});
	}

	private async load() {
		try {
			const [detail, reviews] = await Promise.all([
				this.api.getReviewRequestDetail(this.reviewId),
				this.api.getReviews(this.reviewId),
			]);
			this.panel.title = `#${this.reviewId}: ${detail.summary}`;
			this.panel.webview.html = this.renderHtml(detail, reviews);
		} catch (error) {
			this.panel.webview.html = this.renderError(error);
		}
	}

	private renderHtml(detail: ReviewRequestDetail, reviews: Array<{ ship_it: boolean; body_top: string; user: string; timestamp: string }>): string {
		const serverUrl = this.api.getServerUrl();
		this.serverUrl = serverUrl;
		const reviewUrl = `${serverUrl}/r/${detail.id}/`;
		const shipIts = reviews.filter(r => r.ship_it);

		return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body {
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	color: var(--vscode-foreground);
	padding: 16px 24px;
	line-height: 1.5;
	overflow-wrap: anywhere;
	word-break: break-word;
}
h1 {
	font-size: 1.4em;
	margin: 0 0 4px 0;
	color: var(--vscode-foreground);
	overflow-wrap: anywhere;
}
.review-id {
	color: var(--vscode-descriptionForeground);
	font-size: 0.85em;
	margin-bottom: 16px;
}
.review-id a {
	color: var(--vscode-textLink-foreground);
	text-decoration: none;
}
.review-id a:hover {
	text-decoration: underline;
}
.layout {
	display: grid;
	grid-template-columns: 1fr 280px;
	gap: 24px;
	min-width: 0;
}
@media (max-width: 500px) {
	.layout { grid-template-columns: 1fr; }
}
.main-content {
	min-width: 0;
}
.main-content section {
	margin-bottom: 20px;
}
.section-title {
	font-weight: 600;
	font-size: 0.9em;
	text-transform: uppercase;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 6px;
	border-bottom: 1px solid var(--vscode-widget-border);
	padding-bottom: 4px;
}
.markdown-body {
	word-wrap: break-word;
	padding: 8px 12px;
	border-radius: 3px;
}
.markdown-body p {
	margin: 0 0 8px 0;
}
.markdown-body p:last-child {
	margin-bottom: 0;
}
.markdown-body pre {
	background: var(--vscode-textCodeBlock-background);
	padding: 8px 12px;
	border-radius: 3px;
	overflow-x: auto;
}
.markdown-body code {
	font-family: var(--vscode-editor-font-family);
	font-size: 0.9em;
	background: var(--vscode-textCodeBlock-background);
	padding: 1px 4px;
	border-radius: 3px;
}
.markdown-body pre code {
	background: none;
	padding: 0;
}
.markdown-body ul, .markdown-body ol {
	padding-left: 24px;
	margin: 4px 0;
}
.markdown-body blockquote {
	border-left: 3px solid var(--vscode-textBlockQuote-border);
	background: var(--vscode-textBlockQuote-background);
	margin: 4px 0;
	padding: 4px 12px;
}
.markdown-body a {
	color: var(--vscode-textLink-foreground);
}
.markdown-body h1, .markdown-body h2, .markdown-body h3 {
	margin: 12px 0 6px 0;
	font-size: 1.1em;
}
.markdown-body table {
	border-collapse: collapse;
	width: 100%;
	margin: 8px 0;
}
.markdown-body th, .markdown-body td {
	border: 1px solid var(--vscode-widget-border);
	padding: 4px 8px;
	text-align: left;
}
.markdown-body th {
	background: var(--vscode-sideBar-background);
}
.sidebar {
	background: var(--vscode-sideBar-background);
	border: 1px solid var(--vscode-widget-border);
	border-radius: 4px;
	padding: 12px;
	min-width: 0;
	overflow-wrap: anywhere;
}
.sidebar .field {
	margin-bottom: 12px;
}
.sidebar .field-label {
	font-size: 0.8em;
	text-transform: uppercase;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 2px;
}
.sidebar .field-value {
	font-size: 0.95em;
}
.badge {
	display: inline-block;
	padding: 2px 8px;
	border-radius: 10px;
	font-size: 0.8em;
	font-weight: 600;
}
.badge-shipit {
	background: var(--vscode-testing-iconPassed);
	color: var(--vscode-editor-background);
}
.badge-pending {
	background: var(--vscode-editorWarning-foreground);
	color: var(--vscode-editor-background);
}
.people-list {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}
.person {
	display: inline-block;
	padding: 2px 8px;
	background: var(--vscode-badge-background);
	color: var(--vscode-badge-foreground);
	border-radius: 10px;
	font-size: 0.85em;
}
.ship-it-section {
	margin-top: 8px;
}
.ship-it-entry {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 4px;
	font-size: 0.9em;
}
.ship-it-icon {
	color: var(--vscode-testing-iconPassed);
}
.testing-done .markdown-body {
	font-family: var(--vscode-editor-font-family);
	font-size: 0.9em;
}
</style>
</head>
<body>
<h1>${this.escapeHtml(detail.summary)}</h1>
<div class="review-id">
	<a href="${this.escapeHtml(reviewUrl)}">Review Request #${detail.id}</a>
	&mdash; ${this.formatDate(detail.last_updated)}
	${detail.ship_it_count > 0 ? `<span class="badge badge-shipit">${detail.ship_it_count} Ship It${detail.ship_it_count > 1 ? 's' : ''}</span>` : '<span class="badge badge-pending">Pending</span>'}
</div>

<div class="layout">
<div class="main-content">

${detail.description ? `
<section>
	<div class="section-title">Description</div>
	<div class="markdown-body">${this.renderMarkdown(detail.description)}</div>
</section>
` : ''}

${detail.testing_done ? `
<section>
	<div class="section-title">Testing Done</div>
	<div class="testing-done"><div class="markdown-body">${this.renderMarkdown(detail.testing_done)}</div></div>
</section>
` : ''}

${shipIts.length > 0 ? `
<section>
	<div class="section-title">Approvals</div>
	<div class="ship-it-section">
		${shipIts.map(r => `
		<div class="ship-it-entry">
			<span class="ship-it-icon">&#10003;</span>
			<strong>${this.escapeHtml(r.user)}</strong>
			<span style="color: var(--vscode-descriptionForeground)">${this.formatDate(r.timestamp)}</span>
		</div>`).join('')}
	</div>
</section>
` : ''}

</div>

<div class="sidebar">
	<div class="field">
		<div class="field-label">Owner</div>
		<div class="field-value">${this.escapeHtml(detail.submitter.title)}</div>
	</div>

	${detail.repository ? `
	<div class="field">
		<div class="field-label">Repository</div>
		<div class="field-value">${this.escapeHtml(detail.repository.title)}</div>
	</div>` : ''}

	${detail.branch ? `
	<div class="field">
		<div class="field-label">Branch</div>
		<div class="field-value">${this.escapeHtml(detail.branch)}</div>
	</div>` : ''}

	${detail.bugs_closed.length > 0 ? `
	<div class="field">
		<div class="field-label">Gecks</div>
		<div class="field-value">${detail.bugs_closed.map(b => this.escapeHtml(b)).join(', ')}</div>
	</div>` : ''}

	${detail.changenum ? `
	<div class="field">
		<div class="field-label">Change</div>
		<div class="field-value">${detail.changenum}</div>
	</div>` : ''}

	${detail.depends_on.length > 0 ? `
	<div class="field">
		<div class="field-label">Depends On</div>
		<div class="field-value">${detail.depends_on.map(d => this.escapeHtml(d.title)).join(', ')}</div>
	</div>` : ''}

	<div class="field">
		<div class="field-label">Reviewers</div>
		${detail.target_groups.length > 0 ? `
		<div class="field-value" style="margin-bottom: 4px">
			<span style="font-size: 0.8em; color: var(--vscode-descriptionForeground)">Groups:</span>
			<div class="people-list">${detail.target_groups.map(g => `<span class="person">${this.escapeHtml(g.title)}</span>`).join('')}</div>
		</div>` : ''}
		${detail.target_people.length > 0 ? `
		<div class="field-value">
			<span style="font-size: 0.8em; color: var(--vscode-descriptionForeground)">People:</span>
			<div class="people-list">${detail.target_people.map(p => `<span class="person">${this.escapeHtml(p.title)}</span>`).join('')}</div>
		</div>` : ''}
	</div>

	<div class="field">
		<div class="field-label">Created</div>
		<div class="field-value">${this.formatDate(detail.time_added)}</div>
	</div>

	<div class="field">
		<div class="field-label">Last Updated</div>
		<div class="field-value">${this.formatDate(detail.last_updated)}</div>
	</div>
</div>
</div>
</body>
</html>`;
	}

	private renderError(error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		return `<!DOCTYPE html>
<html><body>
<h2>Failed to load review #${this.reviewId}</h2>
<p>${this.escapeHtml(message)}</p>
</body></html>`;
	}

	private renderMarkdown(text: string): string {
		const renderer = new Renderer();
		const resolve = (url: string | null): string => {
			if (!url) { return ''; }
			// Resolve server-relative URLs (e.g. "/static/...") against the server.
			try {
				return new URL(url, this.serverUrl + '/').toString();
			} catch {
				return url;
			}
		};
		const baseImage = renderer.image.bind(renderer);
		renderer.image = (href, title, alt) => baseImage(resolve(href), title, alt);
		const baseLink = renderer.link.bind(renderer);
		renderer.link = (href, title, text) => baseLink(resolve(href), title, text);
		return marked.parse(text, { async: false, renderer }) as string;
	}

	private escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	private formatDate(isoDate: string): string {
		if (!isoDate) { return ''; }
		try {
			const d = new Date(isoDate);
			return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
		} catch {
			return isoDate;
		}
	}
}
