import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

const EXTENSION_DEV_VERSION = "0.0.9";

export function activate(context: vscode.ExtensionContext) {
    console.log(`Activating extension "mvplanner" version: ${EXTENSION_DEV_VERSION}...`);

    let disposable = vscode.commands.registerCommand('mvplanner.openPlanViewer', async () => {
        console.log('openPlanViewer command triggered');
        
        // Get the first workspace folder (if any)
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder and try again.');
            return;
        }

        const planPath = path.join(workspaceFolder.uri.fsPath, 'plan.json');
        console.log('Plan path:', planPath);

        try {
            // Use fs.promises for asynchronous file operations
            const planData = await fs.readFile(planPath, 'utf8');
            console.log('Plan data loaded successfully');

            const panel = vscode.window.createWebviewPanel(
                'planViewer',
                'Plan Viewer',
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            panel.webview.html = getWebviewContent(planData);
        } catch (error) {
            console.error('Error reading plan.json:', error);
            vscode.window.showErrorMessage('Error reading plan.json. Please make sure the file exists and is accessible.');
        }
    });

    context.subscriptions.push(disposable);
    console.log('mvplanner.openPlanViewer command registered');
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
}
