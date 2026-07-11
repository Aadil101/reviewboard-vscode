import * as vscode from 'vscode';
import { ReviewBoardApi } from './reviewBoardApi';
import { getPerforceWorkspaceRoot, getLocalWorkspaceBranch, normalizeBranchName } from './perforce';

export interface BranchValidationResult {
	isValid: boolean;
	localBranch: string | null;
	reviewBranch: string | null;
	workspaceRoot: string | null;
	message: string;
}

export async function validateWorkspaceBranchMatch(api: ReviewBoardApi, reviewId: number): Promise<BranchValidationResult> {
	const workspaceRoot = getPerforceWorkspaceRoot();
	if (!workspaceRoot) {
		return {
			isValid: false,
			localBranch: null,
			reviewBranch: null,
			workspaceRoot: null,
			message: 'Not in a valid Perforce workspace. Run sbroot to verify.',
		};
	}

	const localBranch = getLocalWorkspaceBranch(workspaceRoot);
	if (!localBranch) {
		return {
			isValid: false,
			localBranch: null,
			reviewBranch: null,
			workspaceRoot,
			message: 'Could not determine local workspace branch from mw_anchor file.',
		};
	}

	const reviewBranch = await api.getReviewBranch(reviewId);
	if (!reviewBranch) {
		return {
			isValid: false,
			localBranch,
			reviewBranch: null,
			workspaceRoot,
			message: 'Could not determine review board branch.',
		};
	}

	const normalizedLocal = normalizeBranchName(localBranch);
	const normalizedReview = normalizeBranchName(reviewBranch);
	const isValid = normalizedLocal === normalizedReview;

	return {
		isValid,
		localBranch,
		reviewBranch,
		workspaceRoot,
		message: isValid
			? `Branch match confirmed: ${localBranch} ↔ ${reviewBranch}`
			: `Branch mismatch: Local workspace is on '${localBranch}' but review is for '${reviewBranch}'`,
	};
}

export async function applyToChangelist(api: ReviewBoardApi, reviewItem?: { type: string; reviewId?: number }): Promise<void> {
	let reviewId: number;

	if (reviewItem && reviewItem.type === 'review' && reviewItem.reviewId) {
		reviewId = reviewItem.reviewId;
	} else {
		const reviewIdInput = await vscode.window.showInputBox({
			prompt: 'Enter Review Request ID',
			placeHolder: '1192991',
			validateInput: (value) => {
				const num = parseInt(value);
				if (isNaN(num) || num <= 0) {
					return 'Please enter a valid review request ID';
				}
				return null;
			},
		});

		if (!reviewIdInput) {
			return;
		}
		reviewId = parseInt(reviewIdInput);
	}

	const validation = await validateWorkspaceBranchMatch(api, reviewId);

	if (!validation.isValid) {
		await vscode.window.showWarningMessage(validation.message, { modal: true }, 'Cancel');
		return;
	}

	vscode.window.showInformationMessage(validation.message);
	vscode.window.showInformationMessage(
		`Ready to apply Review Board #${reviewId} to workspace at ${validation.workspaceRoot}`
	);
}
