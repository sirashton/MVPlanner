import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

const EXTENSION_DEV_VERSION = "0.0.25";
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

    async function updatePlanViewer() {
        if (!planViewerPanel) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const planFilePath = path.join(workspaceFolders[0].uri.fsPath, 'plan.json');

        try {
            const planContent = await fs.readFile(planFilePath, 'utf-8');
            const planJson = JSON.parse(planContent);
            const webviewContent = await getWebviewContent(context, planJson);
            planViewerPanel.webview.html = webviewContent;
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading plan file: ${error}`);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('mvplanner.openPlanViewer', async () => {
            if (planViewerPanel) {
                planViewerPanel.reveal(vscode.ViewColumn.One);
            } else {
                planViewerPanel = vscode.window.createWebviewPanel(
                    'planViewer',
                    'Project Plan Viewer',
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        enableCommandUris: true,
                        retainContextWhenHidden: true
                    }
                );

                planViewerPanel.onDidDispose(() => {
                    planViewerPanel = undefined;
                }, null, context.subscriptions);

                // Set up file watcher for plan.json
                if (!fileWatcher) {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders) {
                        const planFilePath = path.join(workspaceFolders[0].uri.fsPath, 'plan.json');
                        fileWatcher = vscode.workspace.createFileSystemWatcher(planFilePath);
                        fileWatcher.onDidChange(() => {
                            updatePlanViewer();
                        });
                        context.subscriptions.push(fileWatcher);
                    }
                }
            }

            await updatePlanViewer();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mvplanner.refreshPlanViewer', async () => {
            await updatePlanViewer();
        })
    );

    // Set up file watcher
    setupFileWatcher(context, planPath);

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
            // Display message to user on the webview that file has been deleted.
            planViewerPanel.webview.html = 'Plan file not found.';
        }
    });

    context.subscriptions.push(fileWatcher);
    console.log('File watcher for plan.json set up.');
}

async function getWebviewContent(context: vscode.ExtensionContext, plan: any): Promise<string> {
    const htmlPath = vscode.Uri.file(path.join(context.extensionPath, 'webview', 'index.html'));
    const stylesPath = vscode.Uri.file(path.join(context.extensionPath, 'webview', 'styles.css'));
    const scriptPath = vscode.Uri.file(path.join(context.extensionPath, 'webview', 'script.js'));


    console.log('Getting webview content...');
    console.log('Plan:', plan);

    const htmlContent = await fs.readFile(htmlPath.fsPath, 'utf-8');
    if (!planViewerPanel) {
        // If the plan viewer is not open, doesn't matter what we return?
        return htmlContent;
    } else {
        const stylesUri = planViewerPanel.webview.asWebviewUri(stylesPath);
        const scriptUri = planViewerPanel.webview.asWebviewUri(scriptPath);

    
        const nonce = getNonce();

        return htmlContent
            .replace('${stylesUri}', stylesUri.toString())
            .replace('${scriptUri}', scriptUri.toString())
            .replace('${nonce}', nonce)
            .replace('${plan}', JSON.stringify(plan));
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {
    console.log('Deactivating extension "mvplanner"...');
    if (fileWatcher) {
        fileWatcher.dispose();
    }
}
