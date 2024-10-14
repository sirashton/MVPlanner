import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

const EXTENSION_DEV_VERSION = "0.0.18";
let planViewerPanel: vscode.WebviewPanel | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log(`Activating extension "mvplanner" version: ${EXTENSION_DEV_VERSION}...`);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder and try again.');
        return;
    }

    const planPath = path.join(workspaceFolder.uri.fsPath, 'plan.json');
    console.log('Plan path:', planPath);

    let openPlanViewerCommand = vscode.commands.registerCommand('mvplanner.openPlanViewer', async () => {
        if (!(await ensurePlanFileExists(planPath))) {
            return;
        }

        if (planViewerPanel) {
            planViewerPanel.reveal();
        } else {
            planViewerPanel = vscode.window.createWebviewPanel(
                'planViewer',
                'Plan Viewer',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            planViewerPanel.onDidDispose(() => {
                planViewerPanel = undefined;
            });
        }
        vscode.commands.executeCommand('mvplanner.refreshPlanViewer');
    });

    let refreshPlanViewerCommand = vscode.commands.registerCommand('mvplanner.refreshPlanViewer', async () => {
        if (!planViewerPanel) {
            vscode.window.showErrorMessage('Plan Viewer is not open.');
            return;
        }

        if (!(await ensurePlanFileExists(planPath))) {
            return;
        }

        try {
            const planData = await fs.readFile(planPath, 'utf8');
            console.log('Plan data loaded successfully');
            planViewerPanel.webview.html = getWebviewContent(planData);
        } catch (error) {
            console.error('Error reading plan.json:', error);
            vscode.window.showErrorMessage('Error reading plan.json. Please make sure the file exists and is accessible.');
        }
    });

    // Set up file watcher
    setupFileWatcher(context, planPath);

    context.subscriptions.push(openPlanViewerCommand);
    context.subscriptions.push(refreshPlanViewerCommand);
    console.log('mvplanner.openPlanViewer and mvplanner.refreshPlanViewer commands registered');
}

async function ensurePlanFileExists(planPath: string): Promise<boolean> {
    console.log('Checking plan file:', planPath);

    try {
        // Check if the file exists, but must be a case sensitive match
        const files = await fs.readdir(path.dirname(planPath));
        const planFile = files.find(file => file === path.basename(planPath));
        if (!planFile) {
            throw new Error('plan.json not found');
        }

        const fileName = path.basename(planPath);
        if (fileName !== 'plan.json') {
            vscode.window.showErrorMessage('The plan file must be named exactly "plan.json" (all lowercase). Please rename your file and try again.');
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error checking for plan.json:', error);
        vscode.window.showErrorMessage('plan.json not found in the workspace root. Please create a lowercase plan.json file and try again.');
        return false;
    }
}

function setupFileWatcher(context: vscode.ExtensionContext, planPath: string) {

    fileWatcher = vscode.workspace.createFileSystemWatcher(planPath);

    fileWatcher.onDidChange(() => {
        console.log('plan.json changed. Refreshing Plan Viewer.');
        vscode.commands.executeCommand('mvplanner.refreshPlanViewer');
    });

    fileWatcher.onDidDelete(() => {
        console.log('plan.json deleted. Updating Plan Viewer.');
        if (planViewerPanel) {
            planViewerPanel.webview.html = getWebviewContent('Plan file not found.');
        }
    });

    context.subscriptions.push(fileWatcher);
    console.log('File watcher for plan.json set up.');
}

function getWebviewContent(planData: string) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Plan Viewer</title>
    </head>
    <body>
        <h1>Project Plan</h1>
        <pre id="planData">${planData}</pre>
    </body>
    </html>`;
}

export function deactivate() {
    console.log('Deactivating extension "mvplanner"...');
    if (fileWatcher) {
        fileWatcher.dispose();
    }
}
