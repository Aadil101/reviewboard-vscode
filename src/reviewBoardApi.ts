import { AuthSession, AuthenticationError, authHeader } from './auth';

export interface ReviewRequest {
	id: number;
	summary: string;
	branch: string;
	submitter: string;
	last_updated: string;
	ship_it_count: number;
	issue_open_count: number;
}

export interface ReviewRequestDetail {
	id: number;
	summary: string;
	description: string;
	testing_done: string;
	branch: string;
	bugs_closed: string[];
	status: string;
	time_added: string;
	last_updated: string;
	ship_it_count: number;
	target_people: Array<{ title: string; href: string }>;
	target_groups: Array<{ title: string; href: string }>;
	submitter: { title: string; href: string };
	repository: { title: string; href: string } | null;
	depends_on: Array<{ title: string; href: string }>;
	changenum: number | null;
	extra_data: Record<string, string>;
}

export interface DiffFile {
	id: number;
	source_file: string;
	dest_file: string;
	source_revision: string;
	status: string;
	extra_data?: {
		patched_sha1?: string;
		insert_count?: number;
		equal_count?: number;
		delete_count?: number;
	};
}

export class ReviewBoardApi {
	constructor(
		private session: AuthSession,
		/** Invoked once per rejected credential so the caller can re-authenticate. */
		private onUnauthorized?: () => void,
	) {}

	private get serverUrl(): string {
		return this.session.serverUrl;
	}

	private get username(): string {
		return this.session.username;
	}

	private async request(url: string, accept: string): Promise<Response> {
		const response = await fetch(url, {
			headers: {
				'Authorization': authHeader(this.session.credential),
				'Accept': accept,
			},
		});

		if (response.status === 401 || response.status === 403) {
			this.onUnauthorized?.();
			throw new AuthenticationError('Review Board rejected your credentials.');
		}
		if (!response.ok) {
			throw new Error(`Review Board API error: ${response.status} ${response.statusText}`);
		}
		return response;
	}

	private async fetchJson<T>(url: string): Promise<T> {
		const response = await this.request(url, 'application/json');
		return response.json() as Promise<T>;
	}

	private async fetchText(url: string): Promise<string> {
		const response = await this.request(url, 'text/plain');
		return response.text();
	}

	private mapReviewRequests(raw: any[]): ReviewRequest[] {
		return raw.map((rr: any) => ({
			id: rr.id,
			summary: rr.summary || '',
			branch: rr.branch || '',
			submitter: rr.links?.submitter?.title || '',
			last_updated: rr.last_updated || '',
			ship_it_count: rr.ship_it_count || 0,
			issue_open_count: rr.issue_open_count || 0,
		}));
	}

	async getOpenReviewRequests(): Promise<ReviewRequest[]> {
		const data = await this.fetchJson<{ review_requests: any[] }>(
			`${this.serverUrl}/api/review-requests/?from-user=${encodeURIComponent(this.username)}&status=pending`
		);
		return this.mapReviewRequests(data.review_requests);
	}

	async getIncomingReviewRequests(): Promise<ReviewRequest[]> {
		const data = await this.fetchJson<{ review_requests: any[] }>(
			`${this.serverUrl}/api/review-requests/?to-users=${encodeURIComponent(this.username)}&status=pending`
		);
		return this.mapReviewRequests(data.review_requests);
	}

	async getReviewRequestDetail(reviewId: number): Promise<ReviewRequestDetail> {
		const data = await this.fetchJson<{ review_request: any }>(
			`${this.serverUrl}/api/review-requests/${reviewId}/`
		);
		const rr = data.review_request;
		return {
			id: rr.id,
			summary: rr.summary || '',
			description: rr.description || '',
			testing_done: rr.testing_done || '',
			branch: rr.branch || '',
			bugs_closed: rr.bugs_closed || [],
			status: rr.status || '',
			time_added: rr.time_added || '',
			last_updated: rr.last_updated || '',
			ship_it_count: rr.ship_it_count || 0,
			target_people: (rr.target_people || []).map((p: any) => ({ title: p.title, href: p.href })),
			target_groups: (rr.target_groups || []).map((g: any) => ({ title: g.title, href: g.href })),
			submitter: { title: rr.links?.submitter?.title || '', href: rr.links?.submitter?.href || '' },
			repository: rr.links?.repository ? { title: rr.links.repository.title || '', href: rr.links.repository.href || '' } : null,
			depends_on: (rr.depends_on || []).map((d: any) => ({ title: d.title || `#${d.id}`, href: d.href })),
			changenum: rr.changenum || null,
			extra_data: rr.extra_data || {},
		};
	}

	async getReviewBranch(reviewId: number): Promise<string | null> {
		const data = await this.fetchJson<{ review_request: { branch: string } }>(
			`${this.serverUrl}/api/review-requests/${reviewId}/`
		);
		return data.review_request.branch || null;
	}

	async getLatestRevisionId(reviewId: number): Promise<number> {
		const data = await this.fetchJson<{ diffs: Array<{ revision: number }> }>(
			`${this.serverUrl}/api/review-requests/${reviewId}/diffs/`
		);
		if (!data.diffs || data.diffs.length === 0) {
			throw new Error('No diffs found for this review request');
		}
		return Math.max(...data.diffs.map(d => d.revision));
	}

	async getFilesInDiff(reviewId: number, revisionId: number): Promise<DiffFile[]> {
		const data = await this.fetchJson<{ files: DiffFile[] }>(
			`${this.serverUrl}/api/review-requests/${reviewId}/diffs/${revisionId}/files/`
		);
		return data.files;
	}

	async getFileContent(reviewId: number, revisionId: number, fileId: number, version: 'original-file' | 'patched-file'): Promise<string> {
		return this.fetchText(
			`${this.serverUrl}/api/review-requests/${reviewId}/diffs/${revisionId}/files/${fileId}/${version}/`
		);
	}

	async getReviews(reviewId: number): Promise<Array<{ ship_it: boolean; body_top: string; user: string; timestamp: string }>> {
		const data = await this.fetchJson<{ reviews: any[] }>(
			`${this.serverUrl}/api/review-requests/${reviewId}/reviews/`
		);
		return (data.reviews || []).map((r: any) => ({
			ship_it: r.ship_it || false,
			body_top: r.body_top || '',
			user: r.links?.user?.title || '',
			timestamp: r.timestamp || '',
		}));
	}

	getServerUrl(): string {
		return this.serverUrl;
	}

	/** The user Review Board authenticated us as, not the configured setting. */
	getUsername(): string {
		return this.username;
	}
}
