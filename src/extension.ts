import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating extension "mvplanner"...');

    let disposable = vscode.commands.registerCommand('mvplanner.openPlanViewer', () => {
        console.log('openPlanViewer command triggered');
        const panel = vscode.window.createWebviewPanel(
            'planViewer',
            'Plan Viewer',
            vscode.ViewColumn.One,
            {
                enableScripts: true
            }
        );

        const planPath = path.join(context.extensionPath, 'plan.json');
        const planData = fs.readFileSync(planPath, 'utf8');

        panel.webview.html = getWebviewContent(planData);
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