import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export function getPerforceWorkspaceRoot(): string | null {
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return null;
		}

		const result = execSync('sbroot', {
			encoding: 'utf-8',
			cwd: workspaceFolder.uri.fsPath,
		}).trim();

		return result || null;
	} catch {
		return null;
	}
}

export function getLocalWorkspaceBranch(workspaceRoot: string): string | null {
	try {
		const anchorPath = path.join(workspaceRoot, 'mw_anchor');

		if (!fs.existsSync(anchorPath)) {
			return null;
		}

		const anchorContents = fs.readFileSync(anchorPath, 'utf-8');
		const match = anchorContents.match(/MW_CLUSTER=(\w+)/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

export function normalizeBranchName(branch: string): string {
	let normalized = branch.replace(/^\/\/mw\//, '');
	normalized = normalized.replace(/_\d+$/, '');
	return normalized.toLowerCase();
}
